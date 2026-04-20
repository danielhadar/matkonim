#!/bin/bash
# Double-click this file (Finder) to start a local server for Matkonim.
# Then open http://localhost:8000 in your browser.
# Stop the server: close the Terminal window or press Ctrl+C.

cd "$(dirname "$0")" || exit 1
PORT=8000

# If 8000 is busy, try 8001, 8002, ...
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT"
echo "=== matkonim local server ==="
echo "serving $(pwd)"
echo "→ $URL"
echo ""
# open the URL in the default browser after a short delay
(sleep 1 && open "$URL") &
# run the server in foreground so closing the window stops it
python3 -m http.server "$PORT"
