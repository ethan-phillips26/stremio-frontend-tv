#!/usr/bin/env python3
"""Stand-in for mpv in tests: same JSON IPC (observe_property, cycle pause, seek, quit) and exit behaviour."""
import json, os, socket, sys, threading, time
args = sys.argv[1:]
path = next(a.split('=', 1)[1] for a in args if a.startswith('--input-ipc-server='))
start = float(next((a.split('=', 1)[1] for a in args if a.startswith('--start=')), 0))
DUR = float(os.environ.get('FAKE_MPV_DURATION', 100))
SPEED = float(os.environ.get('FAKE_MPV_SPEED', 10))
state = {'t': start, 'paused': False, 'quit': False, 'obs': {}}
open(os.environ.get('FAKE_MPV_LOG', '/dev/null'), 'a').write('ARGS ' + ' '.join(args) + '\n')
try: os.unlink(path)
except OSError: pass
srv = socket.socket(socket.AF_UNIX); srv.bind(path); srv.listen(1)
conn, _ = srv.accept(); lock = threading.Lock()
def send(o):
    with lock: conn.sendall((json.dumps(o) + '\n').encode())
def reader():
    buf = b''
    while not state['quit']:
        d = conn.recv(4096)
        if not d: break
        buf += d
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1); c = json.loads(line)['command']
            if c[0] == 'observe_property': state['obs'][c[2]] = c[1]
            elif c[:2] == ['cycle', 'pause']:
                state['paused'] = not state['paused']; send({'event': 'property-change', 'name': 'pause', 'data': state['paused']})
            elif c[0] == 'seek':
                state['t'] = max(0, min(DUR, state['t'] + c[1])); send({'event': 'seek'})
            elif c[0] == 'quit': state['quit'] = True
            send({'error': 'success'})
threading.Thread(target=reader, daemon=True).start()
time.sleep(0.2); send({'event': 'property-change', 'name': 'duration', 'data': DUR})
eof = False
while not state['quit']:
    time.sleep(0.1)
    if not state['paused']: state['t'] += 0.1 * SPEED
    send({'event': 'property-change', 'name': 'time-pos', 'data': state['t']})
    if state['t'] >= DUR:
        send({'event': 'property-change', 'name': 'eof-reached', 'data': True}); send({'event': 'end-file', 'reason': 'eof'}); break
sys.exit(0)
