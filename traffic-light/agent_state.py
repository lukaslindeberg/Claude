#!/usr/bin/env python3
"""Shared state for the agent traffic light. Scales to many agents/sessions.

Every agent *session* writes its current status to its own tiny file in a
shared directory:

    <dir>/claude-<session>.state   ->  "red" | "yellow" | "green"
    <dir>/codex.state              ->  ...

(an agent that has no session id just uses "<source>.state"). The window
reads them all and shows an aggregate:

    red    -> at least one agent is coding / working
    yellow -> at least one agent is awaiting your approval / input
    green  -> at least one agent is connected and idle (ready / done)
    off    -> no agent connected

A file is removed when its session disconnects, so "green" means "connected".
Idle green files older than the stale window are ignored (covers crashes).

Directory defaults to ~/.agent-traffic-light and can be overridden with the
AGENT_TRAFFIC_LIGHT_DIR environment variable.
"""

from __future__ import annotations

import os
import time
from collections import namedtuple
from pathlib import Path

RED, YELLOW, GREEN, OFF = "red", "yellow", "green", "off"
PRIORITY = {OFF: 0, GREEN: 1, YELLOW: 2, RED: 3}

ALIASES = {
    "red": RED, "coding": RED, "working": RED, "busy": RED, "running": RED,
    "yellow": YELLOW, "awaiting": YELLOW, "approval": YELLOW,
    "waiting": YELLOW, "notification": YELLOW, "input": YELLOW,
    "green": GREEN, "done": GREEN, "complete": GREEN, "idle": GREEN,
    "ready": GREEN, "connected": GREEN, "start": GREEN,
    "off": OFF, "disconnected": OFF, "end": OFF, "": OFF,
}

# Idle (green) sessions older than this are treated as disconnected, so a
# crashed agent that never sent SessionEnd doesn't pin the light on forever.
DEFAULT_STALE_SECONDS = 12 * 3600

Summary = namedtuple("Summary", ["state", "count", "sources"])


def base_dir() -> Path:
    env = os.environ.get("AGENT_TRAFFIC_LIGHT_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".agent-traffic-light"


def _safe(name: str) -> str:
    return "".join(c for c in name if c.isalnum() or c in "-_") or "agent"


def state_file(source: str) -> Path:
    return base_dir() / f"{_safe(source.lower())}.state"


def base_source(file_stem: str) -> str:
    """Group sessions back to their agent: 'claude-1a2b' -> 'claude'."""
    return file_stem.split("-", 1)[0] or file_stem


def normalize(word: str) -> str:
    return ALIASES.get(word.strip().lower(), OFF)


def write_state(source: str, state: str) -> None:
    """Record a state for one agent/session. Never raises."""
    try:
        norm = normalize(state)
        if norm == OFF:
            remove_state(source)
            return
        p = state_file(source)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(norm + "\n", encoding="utf-8")
    except OSError:
        pass


def remove_state(source: str) -> None:
    """Disconnect one agent/session (delete its file). Never raises."""
    try:
        state_file(source).unlink()
    except (FileNotFoundError, OSError):
        pass


def read_states() -> list[tuple[str, str, float]]:
    """(stem, state, mtime) for every state file present."""
    out: list[tuple[str, str, float]] = []
    try:
        files = list(base_dir().glob("*.state"))
    except OSError:
        return out
    for p in files:
        try:
            out.append((p.stem, normalize(p.read_text(encoding="utf-8")),
                        p.stat().st_mtime))
        except OSError:
            continue
    return out


def _stale_seconds() -> float:
    try:
        return float(os.environ.get("AGENT_TRAFFIC_LIGHT_STALE",
                                    DEFAULT_STALE_SECONDS))
    except ValueError:
        return DEFAULT_STALE_SECONDS


def summary() -> Summary:
    """Aggregate across all connected agents/sessions (scales to many)."""
    now = time.time()
    stale = _stale_seconds()
    best = OFF
    connected: list[str] = []  # base source names
    for stem, state, mtime in read_states():
        if state == OFF:
            continue
        if state == GREEN and stale > 0 and (now - mtime) > stale:
            continue  # idle too long -> assume disconnected
        connected.append(base_source(stem))
        if PRIORITY[state] > PRIORITY[best]:
            best = state
    sources = sorted(set(connected))
    return Summary(state=best, count=len(connected), sources=sources)


def active() -> tuple[str | None, str]:
    """Backward-compatible helper: (sources, aggregate state)."""
    s = summary()
    if s.count == 0:
        return None, OFF
    return ", ".join(s.sources) or None, s.state
