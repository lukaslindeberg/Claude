"""Detect whether the app runs as a shared website rather than on someone's own machine."""
import os
from pathlib import Path

# Streamlit Community Cloud checks repos out under /mount/src; INTRINSIC_HOSTED
# forces the mode on (or off with "0") for any other host.
_flag = os.environ.get("INTRINSIC_HOSTED")
HOSTED = (_flag == "1") if _flag in ("0", "1") else str(Path(__file__).resolve()).startswith("/mount/src/")
