#!/bin/sh
# Run from the USB stick on the TV computer:  sh install-streamingcomputer.sh [installer flags]
# Unpacks streamingcomputer.tar.gz (next to this script) into ~/streamingcomputer and runs the installer.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
TAR="$HERE/streamingcomputer.tar.gz"
[ -f "$TAR" ] || { echo "Can't find $TAR"; exit 1; }
DEST="$HOME"
rm -rf "$DEST/streamingcomputer.new"; mkdir -p "$DEST/streamingcomputer.new"
tar xzf "$TAR" -C "$DEST/streamingcomputer.new"
rm -rf "$DEST/streamingcomputer"
mv "$DEST/streamingcomputer.new/streamingcomputer" "$DEST/streamingcomputer"
rmdir "$DEST/streamingcomputer.new"
cd "$DEST/streamingcomputer"
chmod +x install/install.sh bin/* 2>/dev/null || true
echo "Unpacked to $DEST/streamingcomputer. Running the installer..."
exec ./install/install.sh "$@"
