#!/usr/bin/env python3
"""Always-on-top traffic light for AI coding agents (Claude Code, Codex, ...).

Shows whichever agent is currently active (most recent state wins):

    red    -> coding / working
    yellow -> awaiting your approval or input
    green  -> done with its turn

Borderless, always-on-top, draggable. Right-click (or Esc / q) to quit.
Pure Python standard library (tkinter) -- no dependencies.

    python traffic_light.py          # run the light
    python traffic_light.py --demo   # cycle the colors to preview the look
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_state  # noqa: E402

try:
    import tkinter as tk
    import tkinter.font as tkfont
except ModuleNotFoundError:  # pragma: no cover - depends on the OS install
    sys.stderr.write(
        "tkinter is not available.\n"
        "  - Windows/macOS: it ships with the python.org installer.\n"
        "  - Debian/Ubuntu: sudo apt install python3-tk\n"
        "  - Fedora:        sudo dnf install python3-tkinter\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Look & feel
# ---------------------------------------------------------------------------
POLL_MS = 300

LAMPS = ("red", "yellow", "green")
ON = {"red": "#ff453a", "yellow": "#ffd60a", "green": "#30d158"}
GLOW = {"red": "#7d211b", "yellow": "#7d6a05", "green": "#16662f"}
OFF = {"red": "#2c1512", "yellow": "#2c2810", "green": "#11291b"}
GLOSS = {"red": "#ffb3ad", "yellow": "#fff09a", "green": "#a6f0bd"}

LABELS = {
    agent_state.RED: "Coding",
    agent_state.YELLOW: "Needs you",
    agent_state.GREEN: "Done",
    agent_state.OFF: "Idle",
}

WINDOW_BG = "#0a0a0c"     # shows in the rounded corners
CASE_FILL = "#161619"
CASE_EDGE = "#000000"
CASE_INNER = "#2a2a30"
TXT_MAIN = "#f2f2f7"
TXT_SUB = "#8e8e93"

R = 22                    # lamp radius
GAP = 16                  # gap between lamps
PADX = 18
PADTOP = 18
LABEL_H = 46              # room for the text under the lamps
WIDTH = R * 2 + PADX * 2
HEIGHT = PADTOP + (R * 2) * 3 + GAP * 2 + LABEL_H
CORNER = 16


def _round_rect_points(x1, y1, x2, y2, r):
    return [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]


class TrafficLight:
    def __init__(self, root: tk.Tk, demo: bool = False) -> None:
        self.root = root
        self.demo = demo
        self._current = ("__init__", "__init__")
        self._drag = (0, 0)
        self._demo_seq = ["red", "yellow", "green", "off"]
        self._demo_i = 0

        root.overrideredirect(True)
        root.attributes("-topmost", True)
        try:
            root.attributes("-alpha", 0.97)
        except tk.TclError:
            pass

        sw = root.winfo_screenwidth()
        root.geometry(f"{WIDTH}x{HEIGHT}+{sw - WIDTH - 28}+44")

        self.c = tk.Canvas(root, width=WIDTH, height=HEIGHT,
                           highlightthickness=0, bg=WINDOW_BG)
        self.c.pack(fill="both", expand=True)

        # casing
        self.c.create_polygon(_round_rect_points(3, 3, WIDTH - 3, HEIGHT - 3, CORNER),
                              smooth=True, fill=CASE_FILL, outline=CASE_EDGE, width=2)
        self.c.create_polygon(_round_rect_points(6, 6, WIDTH - 6, HEIGHT - 6, CORNER - 3),
                              smooth=True, fill="", outline=CASE_INNER, width=1)

        # lamps (glow ring, body, gloss highlight)
        self.glow_items: dict[str, int] = {}
        self.body_items: dict[str, int] = {}
        self.gloss_items: dict[str, int] = {}
        cx = WIDTH // 2
        for i, lamp in enumerate(LAMPS):
            cy = PADTOP + R + i * (R * 2 + GAP)
            self.glow_items[lamp] = self.c.create_oval(
                cx - R - 4, cy - R - 4, cx + R + 4, cy + R + 4,
                fill="", outline="", width=0)
            self.body_items[lamp] = self.c.create_oval(
                cx - R, cy - R, cx + R, cy + R,
                fill=OFF[lamp], outline="#000000", width=1)
            self.gloss_items[lamp] = self.c.create_oval(
                cx - R * 0.55, cy - R * 0.7, cx + R * 0.2, cy - R * 0.1,
                fill="", outline="")

        self.font_main = tkfont.Font(family="Helvetica", size=11, weight="bold")
        self.font_sub = tkfont.Font(family="Helvetica", size=8)
        ty = HEIGHT - LABEL_H + 14
        self.text_main = self.c.create_text(cx, ty, text="Idle",
                                            fill=TXT_SUB, font=self.font_main)
        self.text_sub = self.c.create_text(cx, ty + 18, text="",
                                           fill=TXT_SUB, font=self.font_sub)

        self.c.bind("<ButtonPress-1>", self._start_drag)
        self.c.bind("<B1-Motion>", self._on_drag)
        self.c.bind("<Button-3>", lambda _e: root.destroy())
        root.bind("<Escape>", lambda _e: root.destroy())
        root.bind("q", lambda _e: root.destroy())

        self._poll()

    # --- rendering ---------------------------------------------------------
    def _render(self, source: str | None, state: str) -> None:
        lamp = state if state in ON else None
        for name in LAMPS:
            on = name == lamp
            self.c.itemconfig(self.body_items[name],
                              fill=ON[name] if on else OFF[name],
                              outline=ON[name] if on else "#000000")
            self.c.itemconfig(self.glow_items[name],
                              fill=GLOW[name] if on else "",
                              outline="")
            self.c.itemconfig(self.gloss_items[name],
                              fill=GLOSS[name] if on else "")
        meaning = LABELS.get(state, "Idle")
        self.c.itemconfig(self.text_main, text=meaning,
                          fill=ON.get(lamp, TXT_SUB) if lamp else TXT_SUB)
        self.c.itemconfig(self.text_sub, text=(source or "") if lamp else "")

    # --- polling -----------------------------------------------------------
    def _poll(self) -> None:
        if self.demo:
            state = self._demo_seq[self._demo_i % len(self._demo_seq)]
            self._demo_i += 1
            key = ("demo", state)
            if key != self._current:
                self._current = key
                self._render("demo", state)
            self.root.after(900, self._poll)
            return

        source, state = agent_state.active()
        key = (source, state)
        if key != self._current:
            self._current = key
            self._render(source, state)
        self.root.after(POLL_MS, self._poll)

    # --- dragging ----------------------------------------------------------
    def _start_drag(self, e: "tk.Event") -> None:
        self._drag = (e.x, e.y)

    def _on_drag(self, e: "tk.Event") -> None:
        x = self.root.winfo_x() + e.x - self._drag[0]
        y = self.root.winfo_y() + e.y - self._drag[1]
        self.root.geometry(f"+{x}+{y}")


def main() -> None:
    demo = "--demo" in sys.argv[1:]
    root = tk.Tk()
    root.title("Agent Traffic Light")
    TrafficLight(root, demo=demo)
    root.mainloop()


if __name__ == "__main__":
    main()
