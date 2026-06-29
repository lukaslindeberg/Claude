#!/usr/bin/env python3
"""Always-on-top traffic light that reflects Claude Code's status.

Reads a tiny state file (written by Claude Code hooks) and shows:

    red    -> Claude is coding / working
    yellow -> Claude is awaiting your approval or input
    green  -> Claude is done with its turn

The window is borderless, always-on-top, and draggable. Right-click it
(or press Esc / q) to quit.

State file:
    Defaults to ~/.claude/traffic_light.state and can be overridden with
    the TRAFFIC_LIGHT_STATE_FILE environment variable. The file should
    contain a single word: red, yellow, green, or off/idle.

This program uses only the Python standard library (tkinter).
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

try:
    import tkinter as tk
except ModuleNotFoundError:  # pragma: no cover - depends on the OS install
    sys.stderr.write(
        "tkinter is not available.\n"
        "  - Windows/macOS: it ships with the python.org installer.\n"
        "  - Debian/Ubuntu: sudo apt install python3-tk\n"
        "  - Fedora:        sudo dnf install python3-tkinter\n"
    )
    sys.exit(1)


# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

def state_file_path() -> Path:
    """Where to read the current status from."""
    env = os.environ.get("TRAFFIC_LIGHT_STATE_FILE")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".claude" / "traffic_light.state"


POLL_MS = 250  # how often to re-read the state file

# Lamp colors: (bright "on" color, dim "off" color)
LAMPS = ("red", "yellow", "green")
ON_COLORS = {
    "red": "#ff3b30",
    "yellow": "#ffcc00",
    "green": "#34c759",
}
OFF_COLORS = {
    "red": "#3a1412",
    "yellow": "#3a3410",
    "green": "#103a1d",
}

# Map the words that may appear in the state file to a lamp (or None = all off).
STATE_TO_LAMP = {
    "red": "red",
    "coding": "red",
    "working": "red",
    "busy": "red",
    "yellow": "yellow",
    "awaiting": "yellow",
    "approval": "yellow",
    "waiting": "yellow",
    "green": "green",
    "done": "green",
    "idle": None,
    "off": None,
    "": None,
}

# Geometry of the casing.
LAMP_RADIUS = 22
LAMP_GAP = 14
PAD = 14
WIDTH = LAMP_RADIUS * 2 + PAD * 2
HEIGHT = LAMP_RADIUS * 2 * 3 + LAMP_GAP * 2 + PAD * 2
CASE_COLOR = "#1c1c1e"


# ----------------------------------------------------------------------------
# Application
# ----------------------------------------------------------------------------

class TrafficLight:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.path = state_file_path()
        self.current_lamp = "__init__"  # force first draw
        self._drag = (0, 0)

        root.overrideredirect(True)  # borderless
        root.attributes("-topmost", True)
        try:
            root.attributes("-alpha", 0.96)
        except tk.TclError:
            pass  # not supported on every platform

        # Start in the top-right corner of the primary screen.
        screen_w = root.winfo_screenwidth()
        root.geometry(f"{WIDTH}x{HEIGHT}+{screen_w - WIDTH - 30}+40")

        self.canvas = tk.Canvas(
            root,
            width=WIDTH,
            height=HEIGHT,
            highlightthickness=0,
            bg=CASE_COLOR,
        )
        self.canvas.pack(fill="both", expand=True)
        self._draw_case()

        self.lamp_items: dict[str, int] = {}
        for i, lamp in enumerate(LAMPS):
            cx = WIDTH // 2
            cy = PAD + LAMP_RADIUS + i * (LAMP_RADIUS * 2 + LAMP_GAP)
            self.lamp_items[lamp] = self.canvas.create_oval(
                cx - LAMP_RADIUS,
                cy - LAMP_RADIUS,
                cx + LAMP_RADIUS,
                cy + LAMP_RADIUS,
                fill=OFF_COLORS[lamp],
                outline="#000000",
                width=1,
            )

        # Interactions: drag to move, click/keys to quit.
        for seq in ("<ButtonPress-1>",):
            self.canvas.bind(seq, self._start_drag)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<Button-3>", lambda _e: self.root.destroy())
        root.bind("<Escape>", lambda _e: self.root.destroy())
        root.bind("q", lambda _e: self.root.destroy())

        self._poll()

    def _draw_case(self) -> None:
        self.canvas.create_rectangle(
            2, 2, WIDTH - 2, HEIGHT - 2,
            outline="#000000", width=2, fill=CASE_COLOR,
        )

    def _read_state(self) -> str | None:
        try:
            raw = self.path.read_text(encoding="utf-8").strip().lower()
        except (FileNotFoundError, OSError):
            return None  # treat missing/unreadable file as "all off"
        word = raw.split()[0] if raw else ""
        return STATE_TO_LAMP.get(word, None)

    def _apply(self, lamp: str | None) -> None:
        if lamp == self.current_lamp:
            return
        self.current_lamp = lamp
        for name in LAMPS:
            color = ON_COLORS[name] if name == lamp else OFF_COLORS[name]
            self.canvas.itemconfig(self.lamp_items[name], fill=color)

    def _poll(self) -> None:
        self._apply(self._read_state())
        self.root.after(POLL_MS, self._poll)

    # --- dragging ----------------------------------------------------------
    def _start_drag(self, event: "tk.Event") -> None:
        self._drag = (event.x, event.y)

    def _on_drag(self, event: "tk.Event") -> None:
        dx = event.x - self._drag[0]
        dy = event.y - self._drag[1]
        x = self.root.winfo_x() + dx
        y = self.root.winfo_y() + dy
        self.root.geometry(f"+{x}+{y}")


def main() -> None:
    root = tk.Tk()
    root.title("Claude Traffic Light")
    TrafficLight(root)
    root.mainloop()


if __name__ == "__main__":
    main()
