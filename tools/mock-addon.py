#!/usr/bin/env python3
"""A fake Stremio addon for tests: returns direct-HTTP streams with typical free-text labels. Serves CORS."""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8098
MANIFEST = {'id': 'test.mock.addon', 'version': '1.0.0', 'name': 'Mock Addon', 'description': 'test double',
            'resources': ['stream'], 'types': ['movie', 'series'], 'idPrefixes': ['tt'], 'catalogs': []}
def streams(vid):
    base = 'http://127.0.0.1:%d/video/' % PORT
    S = [
      ('[+] Mock\n4k DV | HDR', 'Movie.2160p.UHD.BluRay.REMUX.DV.HDR10.DTS-HD.MA.7.1-GRP\n👤 210 💾 58.2 GB ⚙️ SourceA'),
      ('[+] Mock\n4k', 'Movie.2160p.WEB-DL.DDP5.1.HEVC-GRP\n👤 95 💾 14.6 GB ⚙️ SourceB'),
      ('[+] Mock\n1080p', 'Movie.1080p.BluRay.x265.10bit.DDP5.1-GRP\n👤 340 💾 4.1 GB ⚙️ SourceC'),
      ('[+] Mock\n1080p', 'Movie.1080p.WEB-DL.H264.AAC-GRP\n👤 120 💾 2.4 GB ⚙️ SourceD'),
      ('[download] Mock\n1080p', 'Movie.1080p.HDTV.x264.AC3-GRP\n👤 8 💾 1.9 GB ⚙️ SourceE'),
      ('[+] Mock\n720p', 'Movie.720p.BluRay.x264.AAC-GRP\n👤 77 💾 1.1 GB ⚙️ SourceC'),
      ('[+] Mock\n480p', 'Movie.480p.DVDRip.x264.AAC-GRP\n👤 20 💾 0.7 GB ⚙️ SourceB'),
      ('[+] Mock\n1080p', 'Movie.1080p.CAM.x264-GRP\n👤 3 💾 1.2 GB ⚙️ SourceF'),
    ]
    return [{'name': n, 'description': d, 'url': base + '%d.mkv' % i, 'behaviorHints': {'filename': d.split('\n')[0] + '.mkv', 'bingeGroup': 'x'}} for i, (n, d) in enumerate(S)]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code)
        for k, v in {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Length': str(len(b))}.items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self._send({})
    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/manifest.json': return self._send(MANIFEST)
        if p.startswith('/stream/'):
            vid = p.rsplit('/', 1)[1].removesuffix('.json')
            return self._send({'streams': streams(vid)})
        self._send({}, 404)
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
