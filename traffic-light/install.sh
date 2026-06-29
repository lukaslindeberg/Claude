#!/usr/bin/env bash
# Linux/macOS: run this to open the Traffic Light setup.
# Many file managers can run it on double-click (or: right-click -> Run).
# Otherwise from a terminal:  ./install.sh
cd "$(dirname "$0")" || exit 1
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1; then
    exec "$py" setup.py "$@"
  fi
done
echo "Python 3 was not found."
echo "  Debian/Ubuntu: sudo apt install python3 python3-tk"
echo "  Fedora:        sudo dnf install python3 python3-tkinter"
read -r -p "Press Enter to close..." _
