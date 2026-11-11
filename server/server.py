#!/usr/bin/env python3
"""Streaming computer server: static UI, event stream, app launching, mpv control, phone-remote input.

Pure standard library (Python 3.8+), so it runs on a stock Linux Mint install.
Run:  python3 server/server.py [--port 8080]
"""
import argparse, json, mimetypes, os, queue, shutil, signal, socket, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playerui import PlayerUI

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'
DATA = Path(os.environ.get('STREAM_DATA', Path.home() / '.local/share/streamingcomputer'))
RUNTIME = Path(os.environ.get('XDG_RUNTIME_DIR', '/tmp'))
DRY_POWER = bool(os.environ.get('STREAM_DRY_POWER'))
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('text/javascript', '.js')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- config
def load_config():
    cfg = json.loads((ROOT / 'config/config.json').read_text())
    user = Path(os.environ.get('STREAM_CONFIG', Path.home() / '.config/streamingcomputer/config.json'))
    if user.exists():
        try:
            u = json.loads(user.read_text())
            for k, v in u.items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        except Exception as e:  # a typo in the user's file must never stop the TV booting
            log('ignoring bad user config:', e)
    return cfg


CFG = load_config()


# ---------------------------------------------------------------- event hub (server -> launcher/remote, SSE)
class Hub:
    def __init__(self):
        self.subs, self.lock = [], threading.Lock()
        self.ui = {}   # last UI hints from the launcher (e.g. a focused text field) replayed to new subscribers

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            self.subs.append(q)
        if self.ui:
            q.put({'type': 'ui', **self.ui})
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subs:
                self.subs.remove(q)

    def publish(self, ev):
        with self.lock:
            subs = list(self.subs)
        for q in subs:
            try:
                q.put_nowait(ev)
            except queue.Full:
                pass


HUB = Hub()


# ---------------------------------------------------------------- input injection (X11 via xdotool, Wayland via wtype)
XDO_KEYS = {'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'Enter': 'Return', 'Escape': 'Escape',
            'Backspace': 'BackSpace', ' ': 'space', 'Tab': 'Tab', 'Home': 'Home', 'End': 'End', 'PageUp': 'Prior', 'PageDown': 'Next',
            'Delete': 'Delete'}


def run(*cmd, **kw):
    try:
        return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=kw.get('timeout', 5)).returncode == 0
    except Exception:
        return False


def inject_key(key):
    if shutil.which('xdotool') and os.environ.get('DISPLAY'):
        return run('xdotool', 'key', '--clearmodifiers', XDO_KEYS.get(key, key))
    if shutil.which('wtype'):
        wmap = {'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'Enter': 'Return', 'Escape': 'Escape', 'Backspace': 'BackSpace', ' ': 'space'}
        return run('wtype', '-k', wmap.get(key, key))
    return False


def inject_text(text):
    if shutil.which('xdotool') and os.environ.get('DISPLAY'):
        return run('xdotool', 'type', '--clearmodifiers', '--delay', '12', '--', text)
    if shutil.which('wtype'):
        return run('wtype', '--', text)
    return False


def inject_mouse(dx=0, dy=0, click=None, scroll=0):
    if not (shutil.which('xdotool') and os.environ.get('DISPLAY')):
        return False
    if dx or dy:
        run('xdotool', 'mousemove_relative', '--', str(int(dx)), str(int(dy)))
    if click:
        run('xdotool', 'click', {'left': '1', 'middle': '2', 'right': '3'}.get(click, '1'))
    if scroll:
        run('xdotool', 'click', '--repeat', str(min(abs(int(scroll)), 10)), '4' if scroll < 0 else '5')
    return True


def system_volume(action):
    if shutil.which('wpctl'):
        sink = '@DEFAULT_AUDIO_SINK@'
        if action == 'mute':
            return run('wpctl', 'set-mute', sink, 'toggle')
        return run('wpctl', 'set-volume', '-l', '1.0', sink, '5%+' if action == 'up' else '5%-')
    if shutil.which('pactl'):
        sink = '@DEFAULT_SINK@'
        if action == 'mute':
            return run('pactl', 'set-sink-mute', sink, 'toggle')
        return run('pactl', 'set-sink-volume', sink, '+5%' if action == 'up' else '-5%')
    return False


# ---------------------------------------------------------------- mpv
PREFS_FILE = DATA / 'player_prefs.json'


def load_prefs():
    try:
        return json.loads(PREFS_FILE.read_text())
    except Exception:
        return {}


def save_pref(kind, lang):
    """Remember the viewer's language choices: audio language, subtitle language or subtitles off."""
    p = load_prefs()
    if kind == 'audio' and lang:
        p['alang'] = lang
    elif kind == 'sub':
        if lang:
            p['slang'], p['subs'] = lang, 'on'
        else:
            p['subs'] = 'off'
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        PREFS_FILE.write_text(json.dumps(p))
    except OSError:
        pass


# Keyboard on the TV itself: mpv has focus while playing, so it must forward keys to us (it ignores them otherwise).
MPV_BINDINGS = {'LEFT': 'ArrowLeft', 'RIGHT': 'ArrowRight', 'UP': 'ArrowUp', 'DOWN': 'ArrowDown', 'ENTER': 'Enter', 'KP_ENTER': 'Enter',
                'SPACE': 'Space', 'ESC': 'Escape', 'BS': 'Backspace', 'MENU': 'Escape'}


class Mpv:
    """Runs mpv, talks to it over its JSON IPC socket, and republishes playback state as events."""

    def __init__(self):
        self.proc = None
        self.sock = None
        self.lock = threading.Lock()
        self.state = {'running': False, 'time': 0, 'duration': 0, 'paused': False, 'eof': False}
        self.sock_path = str(RUNTIME / f'streamingcomputer-mpv-{os.getpid()}.sock')
        self.conf_path = str(RUNTIME / f'streamingcomputer-mpv-{os.getpid()}.input.conf')
        self._last_pub = 0
        self._seeking = False
        self.ui = PlayerUI(self.cmd, lambda: self.stop(), save_pref)

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self, url, title='', start=0, subs=None, headers=None, subtitle=''):
        self.stop()
        prefs = load_prefs()
        slang = ','.join(dict.fromkeys([prefs['slang'], 'en', 'eng'])) if prefs.get('slang') else 'en,eng'
        alang = ','.join(dict.fromkeys([prefs['alang'], 'en', 'eng', 'original'])) if prefs.get('alang') else 'en,eng,original'
        binary = os.environ.get('STREAM_MPV') or CFG['playback'].get('mpv', 'mpv')
        cmd = binary.split() + [
            '--fs', '--no-terminal', '--force-window=yes', '--keep-open=no', '--idle=no',
            f'--input-ipc-server={self.sock_path}', f'--force-media-title={title or "Stremio"}',
            '--hwdec=auto-safe', f'--slang={slang}', f'--alang={alang}', '--sub-auto=fuzzy', '--subs-with-matching-audio=no',
            '--cache=yes', f'--demuxer-max-bytes={CFG["playback"].get("cacheMiB", 96)}MiB', '--network-timeout=30',
            '--osd-level=0', '--osd-bar=no', '--no-input-default-bindings', f'--input-conf={self._write_bindings()}',
        ]
        if prefs.get('subs') == 'off':
            cmd.append('--sid=no')
        if start and start > 2:
            cmd.append(f'--start={float(start):.1f}')
        for s in subs or []:
            cmd.append(f'--sub-file={s}')
        if headers:
            cmd.append('--http-header-fields=' + ','.join(str(h).replace(',', ' ') for h in headers))
        cmd += ['--', url]
        try:
            os.unlink(self.sock_path)
        except OSError:
            pass
        log('mpv:', ' '.join(cmd[:3]), '… start=%s' % start)
        self.state = {'running': True, 'time': float(start or 0), 'duration': 0, 'paused': False, 'eof': False}
        self.ui.reset(title, subtitle)
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except OSError as e:           # mpv not installed / not executable
            log('cannot start mpv:', e)
            self.proc = None
            self.state['running'] = False
            return False
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        STATE.set_active('mpv')
        HUB.publish({'type': 'player', 'event': 'start'})
        return True

    def _write_bindings(self):
        lines = [f'{k} script-message sc-key {v}' if v in ('Enter', 'Space', 'Escape', 'Backspace') else f'{k} repeatable script-message sc-key {v}'
                 for k, v in MPV_BINDINGS.items()]
        try:
            Path(self.conf_path).write_text('\n'.join(lines) + '\n')
            return self.conf_path
        except OSError:
            return '/dev/null'

    def stop(self):
        p = self.proc
        if p and p.poll() is None:
            self.cmd('quit')
            try:
                p.wait(1.5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                    p.wait(2)
                except Exception:
                    try:
                        os.killpg(p.pid, signal.SIGKILL)
                    except Exception:
                        pass

    def cmd(self, *args):
        with self.lock:
            s = self.sock
            if not s:
                return False
            try:
                s.sendall((json.dumps({'command': list(args)}) + '\n').encode())
                return True
            except OSError:
                return False

    def _reader(self, proc):
        s = None
        for _ in range(120):                       # wait up to ~12 s for the IPC socket
            if proc.poll() is not None:
                break
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                s.connect(self.sock_path)
                break
            except OSError:
                s.close()
                s = None
                time.sleep(0.1)
        ended = False
        if s:
            with self.lock:
                self.sock = s
            for i, prop in enumerate(['time-pos', 'duration', 'pause', 'eof-reached', 'track-list'], 1):
                self.cmd('observe_property', i, prop)
            buf = b''
            s.settimeout(1.0)
            while proc.poll() is None or buf:
                try:
                    chunk = s.recv(8192)
                except socket.timeout:
                    continue
                except OSError:
                    break
                if not chunk:
                    break
                buf += chunk
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    try:
                        ended = self._handle(json.loads(line)) or ended
                    except Exception:
                        pass
        try:
            code = proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            code = None
        with self.lock:
            self.sock = None
        if self.proc is proc:
            ended = ended or self.state.get('eof')
            self.state['running'] = False
            self.ui.close()
            if STATE.active == 'mpv':
                STATE.set_active('launcher')
            HUB.publish({'type': 'player', 'event': 'exit', 'code': code, 'ended': bool(ended),
                         'time': self.state['time'], 'duration': self.state['duration']})
            log('mpv exited', code, 'ended' if ended else '')

    def _handle(self, m):
        ev = m.get('event')
        st = self.state
        if ev == 'property-change':
            name, val = m.get('name'), m.get('data')
            self.ui.prop(name, val)
            if name == 'time-pos' and val is not None:
                st['time'] = float(val)
                now = time.time()
                if now - self._last_pub >= 1.0 or self._seeking:
                    self._last_pub = now
                    HUB.publish({'type': 'player', 'event': 'time', 'time': st['time'], 'duration': st['duration'],
                                 'paused': st['paused'], 'seeked': self._seeking})
                    self._seeking = False
            elif name == 'duration' and val:
                st['duration'] = float(val)
            elif name == 'pause' and val is not None:
                st['paused'] = bool(val)
                HUB.publish({'type': 'player', 'event': 'pause', 'paused': st['paused'], 'time': st['time'], 'duration': st['duration']})
            elif name == 'eof-reached' and val:
                st['eof'] = True
        elif ev == 'client-message':
            a = m.get('args') or []
            if len(a) == 2 and a[0] == 'sc-key' and STATE.active == 'mpv':
                handle_key(' ' if a[1] == 'Space' else a[1])
        elif ev == 'seek':
            self._seeking = True
        elif ev == 'end-file' and m.get('reason') == 'eof':
            st['eof'] = True
        return st['eof']


# ---------------------------------------------------------------- external apps
def find_browser():
    pref = CFG.get('browser', 'auto')
    order = [pref] if pref != 'auto' else ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave-browser', 'firefox']
    for b in order:
        if shutil.which(b):
            return b
    return None


def browser_cmd(app):
    b = find_browser()
    if not b:
        return None
    url, ua = app['url'], app.get('userAgent')
    prof = DATA / 'profiles' / app['id']
    prof.mkdir(parents=True, exist_ok=True)
    if 'firefox' in b:
        prefs = ['user_pref("media.autoplay.default", 0);', 'user_pref("browser.shell.checkDefaultBrowser", false);',
                 'user_pref("browser.sessionstore.resume_from_crash", false);']
        if ua:
            prefs.append('user_pref("general.useragent.override", %s);' % json.dumps(ua))
        (prof / 'user.js').write_text('\n'.join(prefs) + '\n')
        return [b, '--kiosk', '--no-remote', '--profile', str(prof), url]
    cmd = [b, '--kiosk', f'--user-data-dir={prof}', '--no-first-run', '--no-default-browser-check', '--password-store=basic',
           '--autoplay-policy=no-user-gesture-required', '--enable-features=VaapiVideoDecoder,VaapiVideoEncoder',
           '--disable-session-crashed-bubble', '--noerrdialogs', '--disable-infobars']
    if ua:
        cmd.append(f'--user-agent={ua}')
    return cmd + [f'--app={url}']


class Apps:
    def __init__(self):
        self.proc = None
        self.id = None

    def launch(self, app_id):
        app = next((a for a in CFG['apps'] if a['id'] == app_id), None)
        if not app:
            return False, 'unknown app'
        self.close()
        cmd = browser_cmd(app) if app.get('kind', 'web') == 'web' else app.get('cmd')
        if app.get('kind', 'web') == 'web' and not cmd:
            return False, 'no browser found'
        if isinstance(cmd, str):
            cmd = cmd.split()
        if os.environ.get('STREAM_DRY_APPS'):
            log('dry launch:', cmd)
            self.id = app_id
            STATE.set_active('app')
            return True, 'dry'
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception as e:
            return False, str(e)
        self.id = app_id
        STATE.set_active('app')
        threading.Thread(target=self._watch, args=(self.proc,), daemon=True).start()
        return True, 'ok'

    def _watch(self, proc):
        proc.wait()
        if self.proc is proc:
            self.proc = None
            self.id = None
            if STATE.active == 'app':
                STATE.set_active('launcher')
                HUB.publish({'type': 'home', 'reason': 'app-exit'})

    def close(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGTERM)
                p.wait(3)
            except Exception:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except Exception:
                    pass
        self.id = None


class State:
    """Which thing currently owns the screen: the launcher, mpv, or an external app."""

    def __init__(self):
        self.active = 'launcher'
        self.lock = threading.Lock()

    def set_active(self, a):
        self.active = a
        HUB.publish({'type': 'active', 'active': a})


STATE = State()
MPV = Mpv()
APPS = Apps()


def go_home():
    MPV.stop()
    APPS.close()
    STATE.set_active('launcher')
    HUB.publish({'type': 'home', 'reason': 'user'})


# ---------------------------------------------------------------- routing of remote input
def handle_key(key):
    a = STATE.active
    if a == 'launcher':
        HUB.publish({'type': 'key', 'key': key})
        return True
    if a == 'mpv':
        return MPV.ui.key(key)                  # tvOS-style on-screen controls (server/playerui.py)
    return inject_key(key)           # external app: real keystroke


def handle_media(action, value=None):
    if action in ('volume_up', 'volume_down', 'mute'):
        return system_volume({'volume_up': 'up', 'volume_down': 'down', 'mute': 'mute'}[action])
    if STATE.active == 'mpv':
        m = {'play_pause': ('cycle', 'pause'), 'seek': ('seek', value or 10, 'relative'), 'subs': ('cycle', 'sub'), 'audio': ('cycle', 'audio'),
             'stop': ('quit',)}.get(action)
        ok = bool(m) and MPV.cmd(*m)
        if ok:
            MPV.ui.poke()
        return ok
    if STATE.active == 'app':
        k = {'play_pause': 'space', 'seek': 'Right' if (value or 10) > 0 else 'Left', 'stop': 'Escape'}.get(action)
        return bool(k) and inject_key(k)
    if action == 'play_pause' and shutil.which('playerctl'):
        return run('playerctl', 'play-pause')
    return False


def power(action):
    cmds = {'suspend': ['systemctl', 'suspend'], 'reboot': ['systemctl', 'reboot'], 'poweroff': ['systemctl', 'poweroff']}
    if action not in cmds:
        return False
    log('power:', action, '(dry)' if DRY_POWER else '')
    if DRY_POWER:
        return True
    go_home()
    return run(*cmds[action], timeout=10)


# ---------------------------------------------------------------- http
def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return ips or ['127.0.0.1']


PORT = 8080


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'streamingcomputer'

    def log_message(self, fmt, *a):
        pass

    # --- helpers
    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            return {}

    def local(self):
        return self.client_address[0] in ('127.0.0.1', '::1')

    def authorized(self):
        pin = str(CFG.get('pin') or '')
        if not pin or self.local():
            return True
        return self.headers.get('X-Pin') == pin or ('pin=' + pin) in (self.headers.get('Cookie') or '') or ('pin=' + pin) in (self.path or '')

    def static(self, rel):
        rel = rel.lstrip('/') or 'index.html'
        for base in self.bases:
            p = (base / rel).resolve()
            if base.resolve() in p.parents and p.is_file():
                data = p.read_bytes()
                ctype = mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text/') or 'javascript' in ctype or 'json' in ctype else ''))
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
                return True
        return False

    # --- routing
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            return self.api_get(path)
        if path in ('/remote', '/remote/'):
            self.bases = [WEB / 'remote']
            return self.static('index.html') or self.send_error(404)
        if path.startswith('/remote/'):
            self.bases = [WEB / 'remote']
            return self.static(path[len('/remote/'):]) or self.send_error(404)
        self.bases = [WEB / 'launcher', WEB / 'dist']
        if path.startswith('/dist/'):
            path = path[len('/dist/'):]
        if not self.static(path):
            self.send_error(404)

    def do_POST(self):
        if not self.path.startswith('/api/'):
            return self.send_error(404)
        if not self.authorized():
            return self.send_json({'ok': False, 'error': 'pin required'}, 401)
        self.api_post(urlparse(self.path).path, self.body())

    def api_get(self, path):
        if path == '/api/events':
            return self.sse()
        if not self.authorized():
            return self.send_json({'ok': False, 'error': 'pin required'}, 401)
        if path == '/api/apps':
            return self.send_json({'apps': CFG['apps'], 'lite': CFG.get('lite', False), 'playback': CFG['playback'],
                                   'active': STATE.active, 'features': {'pin': bool(CFG.get('pin'))}})
        if path == '/api/info':
            host = socket.gethostname()
            urls = [f'http://{ip}:{PORT}/remote' for ip in lan_ips()]
            return self.send_json({'urls': urls, 'hostname': host, 'mdns': f'http://{host}.local:{PORT}/remote', 'active': STATE.active,
                                   'pin': bool(CFG.get('pin'))})
        if path == '/api/player':
            return self.send_json(MPV.state)
        if path == '/api/state':
            return self.send_json({'active': STATE.active, 'app': APPS.id, 'player': MPV.state})
        self.send_json({'error': 'not found'}, 404)

    def api_post(self, path, b):
        ok = False
        extra = {}
        if path == '/api/key':
            ok = handle_key(str(b.get('key', '')))
        elif path == '/api/text':
            if STATE.active == 'launcher':
                HUB.publish({'type': 'text', 'value': b.get('value', ''), 'submit': bool(b.get('submit'))})
                ok = True
            else:
                ok = inject_text(str(b.get('value', '')))
        elif path == '/api/mouse':
            ok = inject_mouse(b.get('dx', 0), b.get('dy', 0), b.get('click'), b.get('scroll', 0))
        elif path == '/api/media':
            ok = handle_media(b.get('action', ''), b.get('value'))
        elif path == '/api/home':
            go_home()
            ok = True
        elif path == '/api/launch':
            ok, msg = APPS.launch(b.get('id', ''))
            extra['message'] = msg
        elif path == '/api/power':
            ok = power(b.get('action', ''))
        elif path == '/api/ui':
            HUB.ui = {k: v for k, v in b.items() if k in ('text',)}
            HUB.publish({'type': 'ui', **HUB.ui})
            ok = True
        elif path == '/api/player/start':
            if not b.get('url'):
                return self.send_json({'ok': False, 'error': 'url required'}, 400)
            APPS.close()
            ok = MPV.start(b['url'], b.get('title', ''), b.get('start', 0), b.get('subs'), b.get('headers'), b.get('subtitle', ''))
        elif path == '/api/player/subs':
            ok = bool(MPV.running)
            for i, u in enumerate(b.get('urls') or []):
                MPV.cmd('sub-add', str(u), 'auto', 'Subtitles %d' % (i + 1), 'eng')
            for i, u in enumerate(b.get('subs') or []):          # {url, lang}: shown in the on-screen Subtitles menu
                if u.get('url'):
                    MPV.cmd('sub-add', str(u['url']), 'auto', str(u.get('title') or ''), str(u.get('lang') or 'und'))
        elif path == '/api/player/stop':
            MPV.stop()
            ok = True
        else:
            return self.send_json({'error': 'not found'}, 404)
        self.send_json({'ok': bool(ok), **extra})

    def sse(self):
        q = HUB.subscribe()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        try:
            self.wfile.write(b'retry: 1000\n\n')
            self.wfile.write(('data: ' + json.dumps({'type': 'active', 'active': STATE.active}) + '\n\n').encode())
            self.wfile.flush()
            while True:
                try:
                    ev = q.get(timeout=12)
                    self.wfile.write(('data: ' + json.dumps(ev) + '\n\n').encode())
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            HUB.unsubscribe(q)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global PORT
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=int(CFG.get('port', 8080)))
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()
    PORT = args.port
    DATA.mkdir(parents=True, exist_ok=True)
    srv = Server((args.host, PORT), Handler)
    log(f'listening on http://{lan_ips()[0]}:{PORT}  (remote: /remote)')

    def bye(*_):
        MPV.stop()
        APPS.close()
        os._exit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    srv.serve_forever()


if __name__ == '__main__':
    main()
