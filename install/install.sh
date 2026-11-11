#!/usr/bin/env bash
# Installs the TV experience on Linux Mint (or any Debian/Ubuntu-based system running LightDM).
#
#   ./install/install.sh              full install (asks for sudo for apt + autologin)
#   ./install/install.sh --dry-run    print everything it would do, change nothing
#   ./install/install.sh --user-only  only per-user files (config + autostart); no apt/sudo
#   ./install/install.sh --lite       force lite mode (simpler visuals for old hardware)
#   ./install/install.sh --no-autologin
#   ./install/install.sh --uninstall
set -euo pipefail

ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)
DRY=0; USER_ONLY=0; AUTOLOGIN=1; UNINSTALL=0; LITE=auto
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --user-only) USER_ONLY=1 ;;
    --no-autologin) AUTOLOGIN=0 ;;
    --lite) LITE=true ;;
    --no-lite) LITE=false ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*" >&2; }
run()  { if [ "$DRY" = 1 ]; then printf '    [dry-run] %s\n' "$*"; else "$@"; fi; }
# write a file (stdin) to a path, with sudo when asked
put() { # put <path> [sudo]
  local path=$1 use_sudo=${2:-}
  if [ "$DRY" = 1 ]; then printf '    [dry-run] write %s:\n' "$path"; sed 's/^/        | /'; return; fi
  if [ -n "$use_sudo" ]; then sudo mkdir -p "$(dirname "$path")" && sudo tee "$path" >/dev/null
  else mkdir -p "$(dirname "$path")" && cat > "$path"; fi
}

CONF_DIR=${XDG_CONFIG_HOME:-$HOME/.config}
USER_CONF=${STREAM_CONFIG:-$CONF_DIR/streamingcomputer/config.json}
AUTOSTART=$CONF_DIR/autostart/streamingcomputer.desktop
LIGHTDM=/etc/lightdm/lightdm.conf.d/50-streamingcomputer.conf
ME=${SUDO_USER:-$(id -un)}

if [ "$(id -u)" = 0 ] && [ -z "${SUDO_USER:-}" ]; then
  echo "Run this as your normal user (it uses sudo only where needed), not as root." >&2; exit 1
fi

# ------------------------------------------------------------------ uninstall
if [ "$UNINSTALL" = 1 ]; then
  say "Removing the TV session"
  run rm -f "$AUTOSTART" && note "removed autostart entry"
  if [ -f "$LIGHTDM" ] && [ "$USER_ONLY" = 0 ]; then run sudo rm -f "$LIGHTDM" && note "removed autologin (you will see the login screen again)"; fi
  note "kept your settings in $USER_CONF and your data in ~/.local/share/streamingcomputer"
  note "to stop it right now:  touch ~/.cache/streamingcomputer/stop  and close the browser"
  exit 0
fi

# ------------------------------------------------------------------ checks
say "Checking this computer"
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
python3 - <<'PY' || { echo "Python 3.8 or newer is required" >&2; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)
PY
[ -f "$ROOT/web/dist/app.js" ] || { echo "web/dist/app.js is missing. Build it first on the dev machine:  npm install && npm run build" >&2; exit 1; }
HAVE_APT=1; command -v apt-get >/dev/null || HAVE_APT=0
[ "$HAVE_APT" = 1 ] || warn "apt-get not found: skipping package installation (fine for --dry-run on another distro)"
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
CORES=$(nproc 2>/dev/null || echo 1)
note "RAM ${MEM_MB} MB, ${CORES} CPU cores"
if [ "$LITE" = auto ]; then
  if [ "$MEM_MB" -gt 0 ] && { [ "$MEM_MB" -lt 3500 ] || [ "$CORES" -le 2 ]; }; then LITE=true; else LITE=false; fi
  note "lite mode: $LITE (automatic; override with --lite / --no-lite)"
fi

# ------------------------------------------------------------------ packages
if [ "$USER_ONLY" = 0 ] && [ "$HAVE_APT" = 1 ]; then
  say "Installing packages"
  PKGS=(mpv xdotool playerctl pulseaudio-utils x11-xserver-utils unclutter avahi-daemon curl)
  # Fonts: Inter is what the interface is designed around; fall back silently if this release lacks it.
  apt-cache show fonts-inter >/dev/null 2>&1 && PKGS+=(fonts-inter) || warn "fonts-inter not available; using the system font"
  # Intel video decoding. Newer GPUs use intel-media-va-driver, older ones i965; having both is harmless.
  if lspci 2>/dev/null | grep -qiE 'vga.*intel'; then
    for p in intel-media-va-driver i965-va-driver vainfo; do apt-cache show "$p" >/dev/null 2>&1 && PKGS+=("$p"); done
    note "Intel graphics detected: adding VA-API drivers for hardware video decoding"
  fi
  if ! command -v firefox >/dev/null && ! command -v chromium >/dev/null && ! command -v google-chrome-stable >/dev/null; then PKGS+=(firefox); fi
  run sudo apt-get update -qq
  run sudo apt-get install -y "${PKGS[@]}"
fi

# ------------------------------------------------------------------ user config
say "Writing your settings"
if [ -f "$USER_CONF" ]; then
  note "keeping existing $USER_CONF"
else
  put "$USER_CONF" <<EOF
{
  "lite": $LITE,
  "playback": { "maxResolution": 1080 }
}
EOF
  note "created $USER_CONF  (edit to add apps, set a PIN, change the quality cap)"
fi

# ------------------------------------------------------------------ autostart
say "Starting the TV session at login"
put "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Streaming Computer
Comment=Full-screen TV launcher
Exec=$ROOT/bin/streamingcomputer-session
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
run chmod +x "$ROOT/bin/streamingcomputer-session" "$ROOT/server/server.py"

if [ "$USER_ONLY" = 0 ]; then
  # ---------------------------------------------------------------- autologin (LightDM is Mint's default)
  if [ "$AUTOLOGIN" = 1 ]; then
    if [ -d /etc/lightdm ] || [ "$DRY" = 1 ]; then
      say "Logging in automatically at boot as '$ME'"
      put "$LIGHTDM" sudo <<EOF
[Seat:*]
autologin-user=$ME
autologin-user-timeout=0
EOF
    else warn "LightDM not found: set up automatic login in your display manager yourself"; fi
  fi
  # ---------------------------------------------------------------- never sleep / lock while being a TV (Cinnamon)
  if command -v gsettings >/dev/null 2>&1 && gsettings list-schemas 2>/dev/null | grep -q '^org.cinnamon.desktop.screensaver$'; then
    say "Turning off screen lock and automatic sleep"
    run gsettings set org.cinnamon.desktop.screensaver lock-enabled false || true
    run gsettings set org.cinnamon.desktop.session idle-delay 0 || true
    for k in sleep-display-ac sleep-inactive-ac-timeout sleep-display-battery sleep-inactive-battery-timeout; do
      run gsettings set org.cinnamon.settings-daemon.plugins.power "$k" 0 || true
    done
    run gsettings set org.cinnamon.settings-daemon.plugins.power lid-close-ac-action nothing || true
    run gsettings set org.cinnamon.settings-daemon.plugins.power lid-close-battery-action nothing || true
  fi
  # ---------------------------------------------------------------- phone access through the firewall, LAN only
  if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q 'Status: active'; then
    say "Allowing your phone to reach the remote (local network only)"
    run sudo ufw allow from 192.168.0.0/16 to any port 8080 proto tcp
    run sudo ufw allow from 10.0.0.0/8 to any port 8080 proto tcp
  fi
fi

# ------------------------------------------------------------------ done
IP=$(python3 - <<'PY'
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("10.255.255.255", 1)); print(s.getsockname()[0])
except OSError: print("<this-computer>")
PY
)
say "Done"
note "Reboot to start. On your phone (same Wi-Fi) open:  http://$IP:8080/remote   (or http://$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo tv).local:8080/remote)"
note "Add it to your phone's home screen to use it like an app."
note "Sign in to Stremio from the TV screen the first time (type with the phone's Keyboard tab)."
note "Maintenance: touch ~/.cache/streamingcomputer/stop  then close the browser. Logs: ~/.local/share/streamingcomputer/"
[ "$DRY" = 1 ] && note "(dry run: nothing was changed)"
exit 0
