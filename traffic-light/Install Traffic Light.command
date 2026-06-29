#!/bin/bash
# macOS: double-click this file to open the Traffic Light setup.
# (If macOS blocks it the first time: right-click -> Open, then confirm.)
cd "$(dirname "$0")" || exit 1
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1; then
    exec "$py" setup.py
  fi
done
echo "Python 3 was not found. Install it from https://www.python.org/downloads/"
read -r -p "Press Return to close..." _
