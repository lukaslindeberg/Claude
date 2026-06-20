#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Intrinsic — Know what it's really worth (macOS / Linux)
# ─────────────────────────────────────────────────────────
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "Virtual environment not found. Please run ./install.sh first."
  exit 1
fi

source venv/bin/activate
echo "◆ Starting Intrinsic — opening in your browser..."
streamlit run app.py --server.headless false
