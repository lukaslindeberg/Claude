#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ── Activate venv ─────────────────────────────────────────────────────────────
if [ -d "venv" ]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
elif [ -d ".venv" ]; then
  source .venv/bin/activate
fi

# ── Check FastAPI / uvicorn ───────────────────────────────────────────────────
if ! python3 -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "Installing FastAPI and uvicorn…"
  pip install "fastapi>=0.110.0" "uvicorn[standard]>=0.29.0" --quiet
fi

# ── Detect local IP ───────────────────────────────────────────────────────────
LOCAL_IP=$(python3 - <<'EOF'
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print("127.0.0.1")
EOF
)

PORT="${PORT:-8080}"

echo ""
echo "══════════════════════════════════════════════"
echo "  ◆  Intrinsic — Mobile PWA"
echo "     Know what it's really worth"
echo "══════════════════════════════════════════════"
echo ""
echo "  Desktop:  http://localhost:${PORT}"
echo ""
echo "  iPhone / iPad (same WiFi):"
echo "  ➜   http://${LOCAL_IP}:${PORT}"
echo ""
echo "  On your iPhone:"
echo "  1. Open Safari and go to the URL above"
echo "  2. Tap the Share icon  (□↑)"
echo "  3. Tap 'Add to Home Screen'"
echo "  4. Tap 'Add' → works like a native app!"
echo ""
echo "  Press Ctrl+C to stop."
echo "══════════════════════════════════════════════"
echo ""

python3 -m uvicorn api:app --host 0.0.0.0 --port "$PORT" --log-level warning
