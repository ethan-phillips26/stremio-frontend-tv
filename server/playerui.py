"""tvOS-style playback controls drawn inside mpv (ASS vector overlay via the `osd-overlay` IPC command).

mpv owns the screen while a video plays, so the launcher page cannot draw over it. Instead this module keeps a tiny
UI state machine (hidden / controls / menu), receives the remote's keys, and re-renders the overlay.
Stdlib only. `send(*args)` sends one mpv IPC command; `stop()` quits playback; `on_pref(kind, value)` persists choices.
"""
import threading
import time

W, H = 1920, 1080
OVERLAY_STATIC, OVERLAY_LIVE, OVERLAY_MENU = 7, 8, 9      # back to front: background+title+buttons / scrubber+times / menu
HIDE_AFTER = 5.0

LANGS = {
    'eng': 'English', 'en': 'English', 'spa': 'Spanish', 'es': 'Spanish', 'fre': 'French', 'fra': 'French', 'fr': 'French',
    'ger': 'German', 'deu': 'German', 'de': 'German', 'ita': 'Italian', 'it': 'Italian', 'por': 'Portuguese', 'pt': 'Portuguese',
    'rus': 'Russian', 'ru': 'Russian', 'jpn': 'Japanese', 'ja': 'Japanese', 'kor': 'Korean', 'ko': 'Korean',
    'chi': 'Chinese', 'zho': 'Chinese', 'zh': 'Chinese', 'ara': 'Arabic', 'ar': 'Arabic', 'hin': 'Hindi', 'hi': 'Hindi',
    'dut': 'Dutch', 'nld': 'Dutch', 'nl': 'Dutch', 'swe': 'Swedish', 'sv': 'Swedish', 'nor': 'Norwegian', 'no': 'Norwegian',
    'dan': 'Danish', 'da': 'Danish', 'fin': 'Finnish', 'fi': 'Finnish', 'pol': 'Polish', 'pl': 'Polish', 'tur': 'Turkish', 'tr': 'Turkish',
    'gre': 'Greek', 'ell': 'Greek', 'el': 'Greek', 'heb': 'Hebrew', 'he': 'Hebrew', 'cze': 'Czech', 'ces': 'Czech', 'cs': 'Czech',
    'hun': 'Hungarian', 'hu': 'Hungarian', 'rum': 'Romanian', 'ron': 'Romanian', 'ro': 'Romanian', 'tha': 'Thai', 'th': 'Thai',
    'vie': 'Vietnamese', 'vi': 'Vietnamese', 'ind': 'Indonesian', 'id': 'Indonesian', 'ukr': 'Ukrainian', 'uk': 'Ukrainian',
    'bul': 'Bulgarian', 'bg': 'Bulgarian', 'hrv': 'Croatian', 'hr': 'Croatian', 'srp': 'Serbian', 'sr': 'Serbian',
    'und': 'Unknown', 'mul': 'Multiple',
}


def lang_name(code):
    c = (code or '').lower()
    return LANGS.get(c) or LANGS.get(c[:2]) or (c.upper() if c else 'Unknown')


def clock(sec):
    sec = max(0, int(sec))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def esc(s):
    """Make text safe inside an ASS event (no override blocks, no hard newlines)."""
    return str(s).replace('\\', '⧵').replace('{', '(').replace('}', ')').replace('\n', ' ').replace('\r', ' ')


def col(rgb):
    r, g, b = rgb
    return f'&H{b:02X}{g:02X}{r:02X}&'


def alpha(a):
    """a = opacity 0..1 -> ASS alpha (00 opaque .. FF transparent)."""
    return f'&H{int(round((1 - max(0, min(1, a))) * 255)):02X}&'


def rrect(x, y, w, h, r):
    r = max(0, min(r, w / 2, h / 2))
    k = 0.5523 * r
    f = lambda v: f'{v:.1f}'
    return (f'm {f(x + r)} {f(y)} l {f(x + w - r)} {f(y)} b {f(x + w - r + k)} {f(y)} {f(x + w)} {f(y + r - k)} {f(x + w)} {f(y + r)} '
            f'l {f(x + w)} {f(y + h - r)} b {f(x + w)} {f(y + h - r + k)} {f(x + w - r + k)} {f(y + h)} {f(x + w - r)} {f(y + h)} '
            f'l {f(x + r)} {f(y + h)} b {f(x + r - k)} {f(y + h)} {f(x)} {f(y + h - r + k)} {f(x)} {f(y + h - r)} '
            f'l {f(x)} {f(y + r)} b {f(x)} {f(y + r - k)} {f(x + r - k)} {f(y)} {f(x + r)} {f(y)}')


WHITE, INK = (255, 255, 255), (12, 14, 20)


class Scene:
    """Builds ASS event lines (one per shape / text), back to front."""

    def __init__(self):
        self.lines = []

    def shape(self, path, fill=WHITE, a=1.0, rim=None, rim_a=0.5, rim_w=2.0, blur=0.0):
        tag = '{\\an7\\pos(0,0)\\shad0\\1c%s\\1a%s' % (col(fill), alpha(a))
        if rim:
            tag += '\\bord%.1f\\3c%s\\3a%s' % (rim_w, col(rim), alpha(rim_a))
        else:
            tag += '\\bord0'
        if blur:
            tag += '\\blur%.1f' % blur
        self.lines.append(tag + '\\p1}' + path)

    def box(self, x, y, w, h, r, fill=WHITE, a=1.0, **kw):
        self.shape(rrect(x, y, w, h, r), fill, a, **kw)

    def text(self, x, y, s, size=34, an=7, bold=False, fill=WHITE, a=1.0, shadow=True):
        tag = '{\\an%d\\pos(%.1f,%.1f)\\fnInter\\fs%d\\b%d\\bord0\\1c%s\\1a%s' % (an, x, y, size, 1 if bold else 0, col(fill), alpha(a))
        tag += '\\shad2\\4c&H000000&\\4a&HA0&' if shadow else '\\shad0'
        self.lines.append(tag + '}' + esc(s))

    def data(self):
        return '\n'.join(self.lines)


class PlayerUI:
    def __init__(self, send, stop, on_pref=None):
        self.send, self.stop, self.on_pref = send, stop, on_pref or (lambda k, v: None)
        self.lock = threading.RLock()
        self.title, self.subtitle = '', ''
        self.reset()

    # ---- lifecycle ---------------------------------------------------------------------------------------------
    def reset(self, title='', subtitle=''):
        with self.lock:
            self.title, self.subtitle = title or self.title, subtitle
            self.mode = 'hidden'            # hidden | controls | menu
            self.focus = 'scrub'            # scrub | cc | audio
            self.menu_kind, self.menu_items, self.menu_idx = None, [], 0
            self.tracks = []
            self.time, self.dur, self.paused = 0.0, 0.0, False
            self.last_input = 0.0
            self._gen = getattr(self, '_gen', 0) + 1
            self._ov = {}                   # last data sent per overlay id: identical redraws are skipped

    def close(self):
        with self.lock:
            self._gen += 1
            self.mode = 'hidden'
            self._clear()

    # ---- state from mpv ----------------------------------------------------------------------------------------
    def prop(self, name, val):
        with self.lock:
            if name == 'time-pos' and val is not None:
                self.time = float(val)
            elif name == 'duration' and val:
                self.dur = float(val)
            elif name == 'pause' and val is not None:
                self.paused = bool(val)
                if self.mode == 'hidden' and self.paused:
                    self._show()
                elif self.mode != 'hidden':
                    self._render()
            elif name == 'track-list' and isinstance(val, list):
                self.tracks = val
                if self.mode == 'menu':
                    self._render()

    # ---- keys --------------------------------------------------------------------------------------------------
    def poke(self):
        with self.lock:
            self._show()

    def key(self, k):
        """Returns True if handled."""
        with self.lock:
            self.last_input = time.time()
            if self.mode == 'hidden':
                return self._key_hidden(k)
            if self.mode == 'menu':
                return self._key_menu(k)
            return self._key_controls(k)

    def _key_hidden(self, k):
        if k in ('Escape', 'Backspace'):
            self.stop()
        elif k in ('Enter', ' '):
            self.send('cycle', 'pause')
            self._show()
        elif k in ('ArrowLeft', 'ArrowRight'):
            self._seek(-10 if k == 'ArrowLeft' else 10)
            self._show()
        else:                               # up / down: just reveal the controls
            self._show()
        return True

    def _key_controls(self, k):
        if k in ('Escape', 'Backspace'):
            self._hide()
        elif self.focus == 'scrub':
            if k == 'ArrowLeft':
                self._seek(-10)
            elif k == 'ArrowRight':
                self._seek(10)
            elif k in ('Enter', ' '):
                self.send('cycle', 'pause')
            elif k == 'ArrowUp':                 # the buttons sit above the scrubber
                self.focus = 'cc'
            self._render()
        else:
            order = ['cc', 'audio']
            if k == 'ArrowLeft':
                self.focus = order[max(0, order.index(self.focus) - 1)]
            elif k == 'ArrowRight':
                self.focus = order[min(len(order) - 1, order.index(self.focus) + 1)]
            elif k == 'ArrowDown':
                self.focus = 'scrub'
            elif k in ('Enter', ' '):
                self._open_menu('sub' if self.focus == 'cc' else 'audio')
                return True
            self._render()
        return True

    def _key_menu(self, k):
        n = len(self.menu_items)
        if k == 'ArrowDown':
            self.menu_idx = min(n - 1, self.menu_idx + 1)
        elif k == 'ArrowUp':
            self.menu_idx = max(0, self.menu_idx - 1)
        elif k in ('Escape', 'Backspace', 'ArrowLeft', 'ArrowRight'):
            self.mode = 'controls'
        elif k in ('Enter', ' '):
            self._choose(self.menu_items[self.menu_idx])
            self.mode = 'controls'
        self._render()
        return True

    # ---- actions -----------------------------------------------------------------------------------------------
    def _seek(self, d):
        self.send('seek', d, 'relative')
        self.time = max(0.0, min(self.dur or 1e9, self.time + d))      # optimistic, so the bar moves at once

    def _show(self):
        self.last_input = time.time()
        if self.mode == 'hidden':
            self.mode, self.focus = 'controls', 'scrub'
            self._gen += 1
            threading.Thread(target=self._loop, args=(self._gen,), daemon=True).start()
        self._render()

    def _hide(self):
        self.mode = 'hidden'
        self._gen += 1
        self._clear()

    def _open_menu(self, kind):
        items = []
        subs = [t for t in self.tracks if t.get('type') == 'sub']
        auds = [t for t in self.tracks if t.get('type') == 'audio']
        if kind == 'sub':
            items.append({'label': 'Off', 'id': None, 'selected': not any(t.get('selected') for t in subs), 'kind': 'sub', 'lang': None})
            pool = subs
        else:
            pool = auds
        seen = {}
        for t in pool:
            base = lang_name(t.get('lang')) if t.get('lang') else (t.get('title') or 'Track %s' % t.get('id'))
            seen[base] = seen.get(base, 0) + 1
        count = {}
        for t in pool:
            base = lang_name(t.get('lang')) if t.get('lang') else (t.get('title') or 'Track %s' % t.get('id'))
            label = base
            bits = []
            if kind == 'audio':
                ch = t.get('demux-channel-count')
                bits.append({1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1'}.get(ch, '%sch' % ch if ch else ''))
                if t.get('codec'):
                    bits.append(str(t['codec']).upper().replace('EAC3', 'Dolby Digital+').replace('AC3', 'Dolby Digital'))
            else:
                if t.get('forced'):
                    bits.append('Forced')
                if t.get('external'):
                    bits.append('Addon' if not t.get('title') else '')
            title = t.get('title')
            if title and title.lower() != base.lower() and kind == 'sub' and not t.get('external'):
                bits.append(title)
            bits = [b for b in bits if b]
            if seen[base] > 1 and not bits:
                count[base] = count.get(base, 0) + 1
                bits.append(str(count[base]))
            if bits:
                label += '  ·  ' + ' · '.join(bits)
            items.append({'label': label, 'id': t.get('id'), 'selected': bool(t.get('selected')), 'kind': kind, 'lang': t.get('lang')})
        if kind == 'audio' and not items:
            items.append({'label': 'No other audio tracks', 'id': None, 'selected': True, 'kind': 'none', 'lang': None})
        if kind == 'sub' and len(items) == 1:
            items[0]['label'] = 'Off  ·  no subtitles available'
        self.menu_kind, self.menu_items = kind, items
        self.menu_idx = next((i for i, it in enumerate(items) if it['selected']), 0)
        self.mode = 'menu'
        self._render()

    def _choose(self, it):
        if it['kind'] == 'none':
            return
        if it['kind'] == 'sub':
            self.send('set_property', 'sid', it['id'] if it['id'] is not None else 'no')
            self.on_pref('sub', it['lang'] if it['id'] is not None else None)
        else:
            self.send('set_property', 'aid', it['id'])
            self.on_pref('audio', it['lang'])

    # ---- timers ------------------------------------------------------------------------------------------------
    def _loop(self, gen):
        while True:
            time.sleep(0.25)
            with self.lock:
                if gen != self._gen or self.mode == 'hidden':
                    return
                if self.mode == 'controls' and not self.paused and time.time() - self.last_input > HIDE_AFTER:
                    self._hide()
                    return
                self._render()

    # ---- drawing -----------------------------------------------------------------------------------------------
    def _set(self, oid, scene, z):
        """Send one overlay layer, but only if it changed since the last send (libass re-rasterizes the whole layer each time)."""
        data = scene.data() if scene else ''
        if self._ov.get(oid, '') == data:
            return
        self._ov[oid] = data
        if data:
            self.send('osd-overlay', oid, 'ass-events', data, W, H, z)
        else:
            self.send('osd-overlay', oid, 'none', '')

    def _clear(self):
        for oid, z in ((OVERLAY_STATIC, 0), (OVERLAY_LIVE, 1), (OVERLAY_MENU, 2)):
            self._set(oid, None, z)

    def _render(self):
        if self.mode == 'hidden':
            return
        static, live = Scene(), Scene()
        self._draw_static(static)
        self._draw_live(live)
        self._set(OVERLAY_STATIC, static, 0)
        self._set(OVERLAY_LIVE, live, 1)
        if self.mode == 'menu':
            menu = Scene()
            self._draw_menu(menu)
            self._set(OVERLAY_MENU, menu, 2)
        else:
            self._set(OVERLAY_MENU, None, 2)

    def _draw_static(self, s):
        # bottom gradient so white text reads on any picture
        # stacked translucent layers (each runs to the bottom edge) accumulate into a smooth gradient with no seams
        top, steps = 480, 40
        for i in range(steps):
            s.box(0, top + (H - top) * i / steps, W, H, 0, (0, 0, 0), a=0.05 + 0.02 * (i / steps))
        left, right = 96, W - 96
        if self.paused:                                         # pause glyph, top-left of the block
            s.box(left, 676, 11, 38, 3)
            s.box(left + 20, 676, 11, 38, 3)
        if self.subtitle:
            s.text(left, 746, self.subtitle.replace('  ', ' · ', 1) if '·' not in self.subtitle[:6] else self.subtitle, size=30, an=7, a=0.78)
        s.text(left, 786, self.title, size=62, an=7, bold=True)
        # round glass buttons, bottom right of the title row
        for i, (key, label) in enumerate([('cc', 'cc'), ('audio', 'audio')]):
            d = 86
            cx = right - d / 2 - (1 - i) * (d + 22)
            cy = 818
            on = self.mode == 'controls' and self.focus == key
            r = d / 2 + (6 if on else 0)
            if on:
                s.box(cx - r, cy - r, 2 * r, 2 * r, r, WHITE, a=0.96)
            else:
                s.box(cx - r, cy - r, 2 * r, 2 * r, r, WHITE, a=0.2, rim=WHITE, rim_a=0.45, rim_w=1.6)
            ink = INK if on else WHITE
            if label == 'cc':
                s.box(cx - 20, cy - 15, 40, 30, 8, ink, a=0.0, rim=ink, rim_a=1.0, rim_w=3.0)
                s.box(cx - 12, cy - 4, 10, 4.5, 2, ink)
                s.box(cx + 2, cy - 4, 10, 4.5, 2, ink)
                s.box(cx - 12, cy + 5, 24, 4.5, 2, ink)
            else:
                for j, hh in enumerate([14, 28, 40, 28, 14]):
                    s.box(cx - 24 + j * 11, cy - hh / 2, 6, hh, 3, ink)
    def _draw_live(self, s):
        left, right = 96, W - 96
        # scrubber
        by, bh = 912, 9
        focus = self.mode == 'controls' and self.focus == 'scrub'
        if focus:
            by, bh = 910, 13
        frac = (self.time / self.dur) if self.dur else 0
        frac = max(0.0, min(1.0, frac))
        s.box(left, by, right - left, bh, bh / 2, WHITE, a=0.3)
        fw = max(bh, (right - left) * frac)
        s.box(left, by, fw, bh, bh / 2, WHITE, a=0.97)
        px = left + (right - left) * frac
        if focus:
            s.box(px - 11, by + bh / 2 - 11, 22, 22, 11, WHITE, a=1.0, rim=(0, 0, 0), rim_a=0.25, rim_w=2)
        tx = max(left + 40, min(right - 120, px))
        s.text(tx, by + 28, clock(self.time), size=26, an=8, bold=True, a=0.95)
        remain = ('-' + clock(self.dur - self.time)) if self.dur else ''
        s.text(right, by + 28, remain, size=26, an=9, bold=True, a=0.95)

    def _draw_menu(self, s):
        title = 'Subtitles' if self.menu_kind == 'sub' else 'Audio'
        rows = 7
        n = len(self.menu_items)
        first = max(0, min(self.menu_idx - rows // 2, n - rows))
        vis = self.menu_items[first:first + rows]
        rh, pw = 90, 700
        ph = 130 + rh * len(vis) + 28
        px, py = W - 96 - pw, 150
        s.box(0, 0, W, H, 0, (0, 0, 0), a=0.35)                 # dim the picture behind the panel
        s.box(px, py, pw, ph, 44, (24, 27, 38), a=0.9, rim=WHITE, rim_a=0.35, rim_w=1.6)
        s.text(px + 48, py + 40, title, size=40, an=7, bold=True)
        for i, it in enumerate(vis):
            idx = first + i
            y = py + 118 + i * rh
            on = idx == self.menu_idx
            if on:
                s.box(px + 20, y, pw - 40, rh - 10, 28, WHITE, a=0.96)
            ink = INK if on else WHITE
            s.text(px + 56, y + (rh - 10) / 2, it['label'], size=32, an=4, bold=on, fill=ink, a=1.0 if on else 0.88, shadow=False)
            if it['selected']:
                s.text(px + pw - 62, y + (rh - 10) / 2, '✓', size=36, an=5, bold=True, fill=ink, shadow=False)
        if first > 0:
            s.text(px + pw / 2, py + 100, '⌃', size=26, an=8, a=0.5, shadow=False)
        if first + rows < n:
            s.text(px + pw / 2, py + ph - 8, '⌄', size=26, an=2, a=0.5, shadow=False)
