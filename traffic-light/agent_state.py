#!/usr/bin/env python3
"""Shared state helpers for the agent traffic light.

Each coding agent (Claude Code, Codex, ...) writes its current status to its
own tiny file inside a shared directory:

    <dir>/claude.state   ->  "red" | "yellow" | "green" | "off"
    <dir>/codex.state    ->  ...

The traffic-light window reads them all and shows whichever was updated most
recently -- i.e. whichever agent is actually doing something right now.

Directory defaults to ~/.agent-traffic-light and can be overridden with the
AGENT_TRAFFIC_LIGHT_DIR environment variable.
"""

from __future__ import annotations

import os
from pathlib import Path

# canonical states
RED, YELLOW, GREEN, OFF = "red", "yellow", "green", "off"

# normalize any word an agent might write into a canonical state
ALIASES = {
    "red": RED, "coding": RED, "working": RED, "busy": RED, "running": RED,
    "yellow": YELLOW, "awaiting": YELLOW, "approval": YELLOW,
    "waiting": YELLOW, "notification": YELLOW, "input": YELLOW,
    "green": GREEN, "done": GREEN, "complete": GREEN, "idle": GREEN,
    "off": OFF, "": OFF,
}


def base_dir() -> Path:
    env = os.environ.get("AGENT_TRAFFIC_LIGHT_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".agent-traffic-light"


def state_file(source: str) -> Path:
    safe = "".join(c for c in source.lower() if c.isalnum() or c in "-_") or "agent"
    return base_dir() / f"{safe}.state"


def normalize(word: str) -> str:
    return ALIASES.get(word.strip().lower(), OFF)


def write_state(source: str, state: str) -> None:
    """Write a state for one agent. Never raises (a status light must not
    be able to break the agent that drives it)."""
    path = state_file(source)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(normalize(state) + "\n", encoding="utf-8")
    except OSError:
        pass


def read_states() -> list[tuple[str, str, float]]:
    """Return (source, state, mtime) for every agent state file found."""
    out: list[tuple[str, str, float]] = []
    d = base_dir()
    try:
        entries = list(d.glob("*.state"))
    except OSError:
        return out
    for p in entries:
        try:
            word = p.read_text(encoding="utf-8").strip()
            mtime = p.stat().st_mtime
        except OSError:
            continue
        out.append((p.stem, normalize(word), mtime))
    return out


def active() -> tuple[str | None, str]:
    """Return (source, state) for the most recently updated agent.

    This is how the light "auto-selects whichever agent is running": the file
    touched most recently wins. Returns (None, "off") when nothing is known.
    """
    states = read_states()
    if not states:
        return None, OFF
    source, state, _ = max(states, key=lambda t: t[2])
    return source, state
