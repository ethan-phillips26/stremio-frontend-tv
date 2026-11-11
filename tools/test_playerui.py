#!/usr/bin/env python3
"""Logic tests for server/playerui.py (the tvOS-style mpv overlay). No mpv needed: `send` is a recorder.
Run: python3 tools/test_playerui.py   (exits non-zero on failure)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'server'))
from playerui import PlayerUI, clock, lang_name  # noqa: E402

sent, stopped, prefs = [], [], []
ui = PlayerUI(lambda *a: sent.append(a) or True, lambda: stopped.append(1), lambda k, v: prefs.append((k, v)))


def layers():
    """Latest ASS data per overlay id."""
    out = {}
    for a in sent:
        if a[0] == 'osd-overlay':
            out[a[1]] = a[3] if a[2] == 'ass-events' else ''
    return out


def tracks(n_sub=32):
    langs = [('eng', 'SDH'), ('eng', ''), ('spa', ''), ('fre', 'Forced'), ('ger', None), ('xx', ''), (None, 'Commentary'), ('jpn', '')]
    t = [{'id': i, 'type': 'sub', 'lang': l, 'title': ti, 'selected': i == 3, 'external': i > 20, 'forced': i == 5}
         for i, (l, ti) in enumerate((langs * 8)[:n_sub], 1)]
    t += [{'id': 100 + i, 'type': 'audio', 'lang': l, 'codec': c, 'demux-channel-count': ch, 'selected': i == 0}
          for i, (l, c, ch) in enumerate([('eng', 'eac3', 6), ('eng', 'aac', 2), ('spa', 'ac3', 6), ('und', 'dts', 8), (None, 'opus', None)])]
    return t


# formatting helpers
assert clock(3 * 3600 + 5) == '3:00:05' and clock(0) == '0:00' and clock(59.9) == '0:59' and clock(3600) == '1:00:00'
assert lang_name('fre') == 'French' and lang_name('pt') == 'Portuguese' and lang_name(None) == 'Unknown' and lang_name('zzz') == 'ZZZ'

# hostile text must not produce ASS override blocks
ui.reset('A' * 200 + ' {\\an5} \\ x\nline2', 'S10 · E22  ' + 'x' * 120)
ui.prop('track-list', tracks())
ui.prop('duration', 3 * 3600 + 5)
ui.prop('time-pos', 2 * 3600 + 3599.9)
ui.key('ArrowUp')
assert ui.mode == 'controls' and 7 in layers() and 8 in layers()
assert '{\\an5}' not in layers()[7].split('\n')[-2], 'braces in titles must be neutralised'

# controls layout: buttons sit ABOVE the scrubber, so Up reaches them and Down returns
ui.reset('T', '')
ui.prop('track-list', tracks())
ui.key('ArrowUp')                       # hidden -> show
assert ui.mode == 'controls' and ui.focus == 'scrub'
ui.key('ArrowUp'); assert ui.focus == 'cc'
ui.key('ArrowRight'); assert ui.focus == 'audio'
ui.key('ArrowLeft'); assert ui.focus == 'cc'
ui.key('ArrowDown'); assert ui.focus == 'scrub'

# menu: long lists scroll, selection stays inside the window, choosing sends set_property + a pref
ui.key('ArrowUp'); ui.key('Enter')
assert ui.mode == 'menu' and len(ui.menu_items) == 33
for _ in range(40):
    ui.key('ArrowDown')
assert ui.menu_idx == 32
for _ in range(40):
    ui.key('ArrowUp')
assert ui.menu_idx == 0
ui.key('ArrowDown'); ui.key('ArrowDown'); ui.key('Enter')
assert ('set_property', 'sid', 2) in sent and prefs[-1] == ('sub', 'eng') and ui.mode == 'controls'
ui.key('ArrowRight'); ui.key('Enter'); ui.key('ArrowDown'); ui.key('Enter')
assert ('set_property', 'aid', 101) in sent and prefs[-1] == ('audio', 'eng')
ui.key('ArrowLeft'); ui.key('Enter')                               # focus is on Audio after the pick; Left = Captions
for _ in range(40):
    ui.key('ArrowUp')
ui.key('Enter')                                                    # "Off" is item 0
assert ('set_property', 'sid', 'no') in sent and prefs[-1] == ('sub', None)

# identical redraws are not re-sent (libass re-rasterizes a whole layer per send)
ui.reset('T', ''); ui.prop('duration', 100); ui.prop('time-pos', 5); ui.key('ArrowUp')
n = len([a for a in sent if a[0] == 'osd-overlay'])
ui._render(); ui._render()
assert len([a for a in sent if a[0] == 'osd-overlay']) == n, 'unchanged scene must not be re-sent'
ui.prop('time-pos', 6.4)                                          # same displayed second, bar moves < 1 px? (live layer may change)

# key spam in every mode never raises and always ends in a valid mode
for _ in range(5):
    for k in ['ArrowDown', 'ArrowUp', 'Enter', 'ArrowRight', 'ArrowLeft', 'Escape', ' ', 'Backspace'] * 6:
        ui.key(k)
        assert ui.mode in ('hidden', 'controls', 'menu')

# unknown duration; hidden-mode behaviour: OK pauses, Back stops playback
ui.close(); ui.reset('T', ''); ui.prop('duration', 0); ui.prop('time-pos', 5); ui.key('ArrowUp'); assert layers()[8]
ui.close(); ui.reset('T', ''); sent.clear()
ui.key('Enter'); assert ('cycle', 'pause') in sent
ui.mode = 'hidden'; ui.key('Escape'); assert stopped
print('playerui: all checks passed')
