#!/bin/sh
# Make a tarball to copy to the TV computer (no node_modules, no test tooling needed there).
set -e
cd "$(dirname "$0")/.."
node build.mjs
OUT=${1:-streamingcomputer.tar.gz}
tar czf "$OUT" --transform 's,^,streamingcomputer/,' bin config install server web README.md
echo "wrote $OUT  ($(du -h "$OUT" | cut -f1))"
echo "on the TV computer:  tar xzf $OUT && cd streamingcomputer && ./install/install.sh"
