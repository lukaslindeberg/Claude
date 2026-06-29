#!/usr/bin/env python3
"""Run a command with the traffic light RED, then GREEN when it finishes.

This fills the gap for agents (like Codex) that don't emit a "started" event:
wrap the invocation and the light goes red while it runs, green when it exits.

Usage:
    python run_red.py <source> -- <command> [args...]

Example (alias `codex` to this for one-shot runs):
    python run_red.py codex -- codex exec "refactor utils"

The command's exit code is propagated.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_state  # noqa: E402


def main() -> int:
    argv = sys.argv[1:]
    if "--" not in argv or argv.index("--") == 0:
        sys.stderr.write("usage: run_red.py <source> -- <command> [args...]\n")
        return 2
    sep = argv.index("--")
    source = argv[0]
    cmd = argv[sep + 1:]
    if not cmd:
        sys.stderr.write("error: no command given after --\n")
        return 2

    agent_state.write_state(source, agent_state.RED)
    try:
        code = subprocess.call(cmd)
    finally:
        agent_state.write_state(source, agent_state.GREEN)
    return code


if __name__ == "__main__":
    sys.exit(main())
