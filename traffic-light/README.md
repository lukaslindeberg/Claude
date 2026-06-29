# Agent Traffic Light 🚦

A tiny, always-on-top desktop traffic light that shows what your AI coding
agent is doing — works with **Claude Code** and **OpenAI Codex**, and
automatically shows whichever one is active right now.

| Light | Meaning |
|-------|---------|
| 🔴 **Red** | Coding / working (running tools, editing files) |
| 🟡 **Yellow** | Awaiting your approval or input |
| 🟢 **Green** | Done with its turn |

It's pure Python standard library (tkinter) — no `pip install`, no
dependencies, a few MB of RAM and ~0% idle CPU (it only redraws when the
status actually changes).

```
Claude Code ─hooks──▶ ~/.agent-traffic-light/claude.state ┐
                                                          ├─▶ traffic_light.py
Codex ───────notify─▶ ~/.agent-traffic-light/codex.state  ┘   (shows newest)
```

Each agent writes its status to its own file; the window shows the one updated
**most recently**, so it follows whichever agent you're working with — and
labels it (`claude` / `codex`) underneath the lights.

## Requirements

- Python 3.8+
- **tkinter** (bundled with the python.org installer on Windows/macOS):
  - Debian/Ubuntu: `sudo apt install python3-tk`
  - Fedora: `sudo dnf install python3-tkinter`

## Quick start — just double-click

Use the launcher for your device. It opens a small setup window where you tick
your agent(s) and click **Install** (with optional "start at login" and a
**Start light** button):

| Device | Double-click |
|--------|--------------|
| **macOS** | `Install Traffic Light.command` *(first time: right-click → Open)* |
| **Windows** | `Install Traffic Light.bat` |
| **Linux** | `install.sh` *(or right-click → Run)* |

No graphical toolkit? The same launcher falls back to a simple text menu.
After installing, **restart your agent(s)** so they load the changes.

### Or from the command line

```bash
python setup.py            # the same setup window / text menu
python install.py          # wire up both agents directly (no UI)
#   python install.py --claude-only | --codex-only | --uninstall
python traffic_light.py    # run the light
python traffic_light.py --demo   # preview the look with no agent running
```

## Using the window

- **Drag** it anywhere with the left mouse button.
- **Right-click**, or press **Esc** / **q**, to quit.
- Starts top-right of your primary screen and stays on top.

## What each agent supports

### Claude Code — full red / yellow / green
Installed as [hooks](https://docs.claude.com/en/docs/claude-code/hooks) in
`~/.claude/settings.json`:

| Hook | Light |
|------|-------|
| `UserPromptSubmit`, `PreToolUse` | 🔴 red |
| `Notification` | 🟡 yellow |
| `Stop` | 🟢 green |

### Codex — green out of the box, red on demand
Codex's external `notify` program currently only receives the
`agent-turn-complete` event ([openai/codex#11808](https://github.com/openai/codex/issues/11808)),
so `install.py` wires `notify_codex.py` into `~/.codex/config.toml` to turn the
light 🟢 **green when a turn finishes** — the signal that tells you to look back
at the terminal.

- **Red while it works:** Codex doesn't emit a "started" event, so for one-shot
  runs wrap the command with `run_red.py` (red while running, green when done):

  ```bash
  python run_red.py codex -- codex exec "refactor the utils module"
  ```

  Handy as a shell alias for one-shot use:
  ```bash
  alias codex-go='python /path/to/run_red.py codex -- codex exec'
  ```

- **Yellow (approval):** Codex doesn't deliver approval-request events to
  external programs yet, so there's no automatic yellow for Codex. You can still
  get a desktop ping by adding `notifications = ["approval-requested"]` under
  `[tui]` in `config.toml`.

## Uninstall

```bash
python install.py --uninstall        # removes hooks/notify from both
```

## Customizing

- **State directory:** `~/.agent-traffic-light/` (one `*.state` file per
  agent). Override with `AGENT_TRAFFIC_LIGHT_DIR` for every script.
- **Set a state by hand** (testing, or wiring a third agent):
  ```bash
  python set_state.py yellow --source claude
  ```
- **Hook → color mapping:** edit `CLAUDE_EVENTS` in `install.py`, re-run install.
- **Colors, size, poll interval, position:** constants near the top of
  `traffic_light.py`.

## Files

| File | Purpose |
|------|---------|
| `Install Traffic Light.command` / `.bat`, `install.sh` | Clickable launchers (macOS / Windows / Linux). |
| `setup.py` | Clickable setup window (install, uninstall, start, start-at-login); text menu fallback. |
| `traffic_light.py` | The always-on-top window (run this; `--demo` to preview). |
| `agent_state.py` | Shared state read/write + "most recent agent" logic. |
| `set_state.py` | Helper the Claude Code hooks call. |
| `notify_codex.py` | Codex `notify` program (turn-complete → green). |
| `run_red.py` | Run a command red→green (gives Codex a "working" state). |
| `install.py` | Adds/removes the integration for both agents (used by `setup.py`). |

## Notes

- The hooks/notify only write a single word to a file and exit; they never fail
  loudly, so they can't block or slow down your agent.
- Run several agents at once and the light always reflects the most recent
  activity across all of them.
