#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Intrinsic — Know what it's really worth (macOS / Linux installer)
# ─────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

echo ""
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}   ◆ Intrinsic — Know what it's really worth${NC}"
echo -e "${BOLD}${BLUE}     Installation${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Python ──────────────────────────────────────────────
echo -e "${BOLD}[1/4] Checking Python...${NC}"

PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    MAJOR=$(echo "$VER" | cut -d. -f1)
    MINOR=$(echo "$VER" | cut -d. -f2)
    if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 9 ]; then
      PYTHON="$cmd"
      echo -e "  ${GREEN}✓ Python $VER found${NC}"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo -e "  ${RED}✗ Python 3.9+ not found.${NC}"
  echo ""
  echo "  Please install Python from: https://www.python.org/downloads/"
  echo "  On macOS you can also run:  brew install python"
  exit 1
fi

# ── Virtual environment ──────────────────────────────────
echo ""
echo -e "${BOLD}[2/4] Setting up virtual environment...${NC}"

if [ ! -d "venv" ]; then
  "$PYTHON" -m venv venv
  echo -e "  ${GREEN}✓ Virtual environment created${NC}"
else
  echo -e "  ${GREEN}✓ Virtual environment already exists${NC}"
fi

# Activate
source venv/bin/activate

# ── Python packages ──────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4] Installing Python packages...${NC}"
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo -e "  ${GREEN}✓ All packages installed${NC}"

# ── Ollama ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4] Checking Ollama (local AI)...${NC}"

if command -v ollama &>/dev/null; then
  echo -e "  ${GREEN}✓ Ollama is installed${NC}"

  # Check if running
  if ollama list &>/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Ollama is running${NC}"

    # Check for models
    MODEL_COUNT=$(ollama list 2>/dev/null | grep -c "^" || echo 0)
    if [ "$MODEL_COUNT" -gt 1 ]; then
      echo -e "  ${GREEN}✓ Models available${NC}"
    else
      echo -e "  ${YELLOW}⬇  No models found — pulling llama3.2 (≈2 GB, takes a few minutes)...${NC}"
      ollama pull llama3.2
      echo -e "  ${GREEN}✓ llama3.2 downloaded${NC}"
    fi
  else
    echo -e "  ${YELLOW}⚠  Ollama is installed but not running.${NC}"
    echo "     Start it with:  ollama serve"
    echo "     Then pull a model:  ollama pull llama3.2"
  fi
else
  echo -e "  ${YELLOW}⚠  Ollama not found.${NC}"
  echo ""
  echo "  To enable AI features, install Ollama:"
  echo "  ➜  Visit https://ollama.ai and download for your OS"
  echo "  ➜  Then run:  ollama pull llama3.2"
  echo ""
  echo "  The app will still show financial data without Ollama."
fi

# ── Done ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}   ✅ Installation complete!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Start the app with:  ${BOLD}./run.sh${NC}"
echo ""
