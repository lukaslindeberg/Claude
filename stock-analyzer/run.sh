#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Stock DCF Analyzer — Launcher (macOS / Linux)
# ─────────────────────────────────────────────────────────
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "Virtual environment not found. Please run ./install.sh first."
  exit 1
fi

source venv/bin/activate
echo "Starting Stock DCF Analyzer — opening in your browser..."
streamlit run app.py --server.headless false
