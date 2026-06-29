#!/usr/bin/env python3
"""Always-on-top traffic light for AI coding agents (Claude Code, Codex, ...).

Aggregates across every connected agent/session and shows:

    green  -> connected & idle (ready / done)   <- turns on when an agent connects
    yellow -> someone is awaiting your approval or input
    red    -> someone is coding / working
    off    -> nothing connected

A "connected" indicator under the lamps shows how many agents are live.
Borderless, always-on-top, draggable. Right-click (or Esc / q) to quit.
Pure Python standard library (tkinter) -- no dependencies.

    python traffic_light.py              # run the light
    python traffic_light.py --demo       # cycle the colors to preview
    python traffic_light.py --scale 1.5  # bigger (also AGENT_TRAFFIC_LIGHT_SCALE)
"""

from __future__ import annotations

import os
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


POLL_MS = 300
LAMPS = ("red", "yellow", "green")
ON = {"red": "#ff453a", "yellow": "#ffd60a", "green": "#30d158"}
GLOW = {"red": "#7d211b", "yellow": "#7d6a05", "green": "#16662f"}
OFF = {"red": "#2c1512", "yellow": "#2c2810", "green": "#11291b"}
GLOSS = {"red": "#ffb3ad", "yellow": "#fff09a", "green": "#a6f0bd"}
LABELS = {
    agent_state.RED: "Coding",
    agent_state.YELLOW: "Needs you",
    agent_state.GREEN: "Ready",
    agent_state.OFF: "Offline",
}
WINDOW_BG, CASE_FILL, CASE_EDGE, CASE_INNER = "#0a0a0c", "#161619", "#000000", "#2a2a30"
TXT_SUB, CONNECTED_FG = "#8e8e93", "#30d158"


def _round_rect(x1, y1, x2, y2, r):
    return [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
            x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]


def _resolve_scale() -> float:
    scale = 1.0
    args = sys.argv[1:]
    if "--scale" in args:
        try:
            scale = float(args[args.index("--scale") + 1])
        except (IndexError, ValueError):
            pass
    else:
        try:
            scale = float(os.environ.get("AGENT_TRAFFIC_LIGHT_SCALE", "1"))
        except ValueError:
            pass
    return max(0.5, min(scale, 4.0))


class TrafficLight:
    def __init__(self, root: tk.Tk, demo: bool = False, scale: float = 1.0) -> None:
        self.root = root
        self.demo = demo
        self._current = None
        self._drag = (0, 0)
        self._demo_seq = ["green", "red", "yellow", "green", "off"]
        self._demo_i = 0

        s = scale
        self.R = int(22 * s)
        gap, padx, padtop = int(16 * s), int(18 * s), int(18 * s)
        label_h = int(46 * s)
        corner = int(16 * s)
        self.W = self.R * 2 + padx * 2
        self.H = padtop + self.R * 2 * 3 + gap * 2 + label_h

        root.overrideredirect(True)
        root.attributes("-topmost", True)
        try:
            root.attributes("-alpha", 0.97)
        except tk.TclError:
            pass
        sw = root.winfo_screenwidth()
        root.geometry(f"{self.W}x{self.H}+{sw - self.W - 28}+44")

        self.c = tk.Canvas(root, width=self.W, height=self.H,
                           highlightthickness=0, bg=WINDOW_BG)
        self.c.pack(fill="both", expand=True)
        self.c.create_polygon(_round_rect(3, 3, self.W - 3, self.H - 3, corner),
                              smooth=True, fill=CASE_FILL, outline=CASE_EDGE, width=2)
        self.c.create_polygon(_round_rect(6, 6, self.W - 6, self.H - 6, corner - 3),
                              smooth=True, fill="", outline=CASE_INNER, width=1)

        self.glow, self.body, self.gloss = {}, {}, {}
        cx = self.W // 2
        R = self.R
        for i, lamp in enumerate(LAMPS):
            cy = padtop + R + i * (R * 2 + gap)
            self.glow[lamp] = self.c.create_oval(cx - R - 4, cy - R - 4,
                                                 cx + R + 4, cy + R + 4,
                                                 fill="", outline="", width=0)
            self.body[lamp] = self.c.create_oval(cx - R, cy - R, cx + R, cy + R,
                                                 fill=OFF[lamp], outline="#000", width=1)
            self.gloss[lamp] = self.c.create_oval(cx - R * 0.55, cy - R * 0.7,
                                                  cx + R * 0.2, cy - R * 0.1,
                                                  fill="", outline="")

        self.f_main = tkfont.Font(family="Helvetica", size=int(11 * s), weight="bold")
        self.f_sub = tkfont.Font(family="Helvetica", size=max(7, int(8 * s)))
        ty = self.H - label_h + int(14 * s)
        self.t_main = self.c.create_text(cx, ty, text="Offline", fill=TXT_SUB,
                                         font=self.f_main)
        self.t_sub = self.c.create_text(cx, ty + int(18 * s), text="○ offline",
                                        fill=TXT_SUB, font=self.f_sub)

        self.c.bind("<ButtonPress-1>", self._press)
        self.c.bind("<B1-Motion>", self._drag_move)
        self.c.bind("<Button-3>", lambda _e: root.destroy())
        root.bind("<Escape>", lambda _e: root.destroy())
        root.bind("q", lambda _e: root.destroy())
        self._poll()

    def _render(self, state: str, connected: int, subtext: str) -> None:
        lamp = state if state in ON else None
        for name in LAMPS:
            on = name == lamp
            self.c.itemconfig(self.body[name], fill=ON[name] if on else OFF[name],
                              outline=ON[name] if on else "#000")
            self.c.itemconfig(self.glow[name], fill=GLOW[name] if on else "")
            self.c.itemconfig(self.gloss[name], fill=GLOSS[name] if on else "")
        self.c.itemconfig(self.t_main, text=LABELS.get(state, "Offline"),
                          fill=ON.get(lamp, TXT_SUB) if lamp else TXT_SUB)
        dot = "● " if connected else "○ "
        self.c.itemconfig(self.t_sub, text=dot + subtext,
                          fill=CONNECTED_FG if connected else TXT_SUB)

    def _poll(self) -> None:
        if self.demo:
            state = self._demo_seq[self._demo_i % len(self._demo_seq)]
            self._demo_i += 1
            conn = 0 if state == "off" else 1
            self._apply((state, conn, "demo" if conn else "offline"))
            self.root.after(900, self._poll)
            return

        s = agent_state.summary()
        if s.count == 0:
            sub = "offline"
        elif s.count == 1:
            sub = s.sources[0] if s.sources else "connected"
        else:
            sub = f"{s.count}: " + ", ".join(s.sources)
        self._apply((s.state, s.count, sub))
        self.root.after(POLL_MS, self._poll)

    def _apply(self, payload) -> None:
        if payload != self._current:
            self._current = payload
            self._render(payload[0], payload[1], payload[2])

    def _press(self, e: "tk.Event") -> None:
        self._drag = (e.x, e.y)

    def _drag_move(self, e: "tk.Event") -> None:
        x = self.root.winfo_x() + e.x - self._drag[0]
        y = self.root.winfo_y() + e.y - self._drag[1]
        self.root.geometry(f"+{x}+{y}")


def main() -> None:
    demo = "--demo" in sys.argv[1:]
    root = tk.Tk()
    root.title("Agent Traffic Light")
    TrafficLight(root, demo=demo, scale=_resolve_scale())
    root.mainloop()


if __name__ == "__main__":
    main()
