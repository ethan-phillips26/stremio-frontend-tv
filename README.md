# Streaming computer

A smart-TV-style front end for a Linux laptop connected to a TV, controlled from your phone.

- **Home screen** in the style of the Apple TV interface: app tiles, a cinematic top shelf, Continue Watching, catalogs.
- **Stremio built in**, powered by the official `stremio-core` engine. Sign in with your Stremio account and your library,
  watch progress, watched episodes and the addons you have set up come with you and stay in sync with the official apps.
- **mpv** plays the streams (hardware decoding where available). Position and "watched" are reported back to your account.
- **Phone remote**: D-pad, touchpad/swipes, keyboard (types into whatever field the TV is showing), volume, apps, power.
  Open `http://<tv-ip>:8080/remote` on your phone and add it to the home screen.

```
 phone ──HTTP/SSE──▶ server.py ──┬─ launcher UI (browser, kiosk)  ◀── stremio-core (WASM, in the page)
                                 ├─ mpv  (JSON IPC: position, pause, seek)
                                 └─ external apps (own kiosk window)
```

## Install on the TV computer (Linux Mint)

On the dev machine: `npm install && npm run pack` → copy `streamingcomputer.tar.gz` over, then on the TV computer:

```bash
tar xzf streamingcomputer.tar.gz && cd streamingcomputer
./install/install.sh --dry-run     # see exactly what it will do
./install/install.sh               # install (sudo only for apt packages + autologin)
sudo reboot
```

It installs mpv, xdotool, the Intel video-decode drivers and a font, writes `~/.config/streamingcomputer/config.json`,
sets up automatic login and an autostart entry, and turns off screen lock and sleep. Options: `--user-only`, `--lite`,
`--no-autologin`, `--uninstall`.

**First run:** the TV shows a Stremio sign-in. On your phone open the Keyboard tab and type; the email and password go
straight into the TV's fields. (Your password is only used to sign in; it is never stored or logged.)

## Using it

| | |
|---|---|
| Move / select / back | arrow keys, Enter, Esc on a keyboard, or the phone remote |
| Home | the Home button on the remote: closes whatever is open and returns to the TV menu |
| Quality | **System ▸ Quality** sets the preferred maximum (720p / 1080p / 4K). "Recommended" in the stream list picks the best cached stream under it |
| Play | open a title ▸ Play ▸ pick a stream (the first one is the recommendation) |
| While playing | remote: ◀▶ seek 10 s, ▲▼ ±1 min, OK pause, Back stops, Subtitles / Audio cycle tracks |

## Configuration

`~/.config/streamingcomputer/config.json` overrides `config/config.json` (keys are merged):

```json
{
  "lite": false,
  "pin": "",
  "browser": "auto",
  "playback": { "maxResolution": 1080, "cacheMiB": 96 },
  "apps": [ { "id": "kodi", "name": "Kodi", "kind": "cmd", "cmd": ["kodi"], "a1": "#17b2e7", "a2": "#0b4a66", "glyph": "letter" } ]
}
```

- `lite` – simpler visuals for old hardware (no animated wallpaper, blur, shine or tilt). The installer turns it on automatically for ≤2 cores or <3.5 GB RAM.
- `pin` – if set, anything other than the TV itself must send the PIN (the phone remote asks for it once). Worth setting if others share your Wi-Fi.
- App tiles can use `"icon": "/path/to/art.png"` instead of the built-in glyphs.

## Develop and test (on any machine with Node and Python)

```bash
npm install
npm run dev                          # rebuild web/dist (unminified)
python3 server/server.py --port 8080 # then open http://localhost:8080  (phone remote: /remote)
npm test                             # real-browser regression suite (Firefox + fake mpv + mock addon)
```

`npm test` drives the actual UI with keypresses and a phone-sized second page, against the real server and the real
stremio-core, using a fake mpv and a mock addon, and asserts on screens and on the data in the core. It needs Firefox.
`?static` on the URL turns animations off (screenshots); `?lite` forces lite mode.

Layout: `server/` (stdlib-only Python), `src/` (UI), `web/launcher` (HTML/CSS), `web/remote` (phone app),
`web/dist` (built, committed), `bin/` (session script), `install/`, `tools/` (tests, pack script).

## Troubleshooting

- **Logs:** `~/.local/share/streamingcomputer/{session,server}.log`
- **Leave kiosk mode for maintenance:** `touch ~/.cache/streamingcomputer/stop` and close the browser (Ctrl+Alt+T opens a terminal).
- **"That stream would not play":** pick another; remux/4K files may be too heavy. Lower **System ▸ Quality**.
- **Stutter on video:** check hardware decoding: `vainfo` should list H264 (and HEVC on newer chips). mpv uses `--hwdec=auto-safe`.
- **Phone can't connect:** same Wi-Fi? Firewall (`sudo ufw allow from 192.168.0.0/16 to any port 8080 proto tcp`)? The Phone Remote tile shows the address.
- **Mouse/keyboard control of external apps** uses `xdotool` (X11). On Wayland sessions it falls back to `wtype` for keys only.

## Notes

Unofficial project, not affiliated with or endorsed by Stremio or Apple. It ships with no addons or content sources: it only
shows and plays what is already configured on your own Stremio account, and you are responsible for what you add there.
The interface is an original design inspired by tvOS and uses no Apple assets.

## License

MIT, see `LICENSE`. Uses `@stremio/stremio-core-web` (MIT).
