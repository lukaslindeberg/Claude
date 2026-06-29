# Claude Code Traffic Light 🚦

A tiny, always-on-top desktop traffic light that shows what Claude Code is doing:

| Light | Meaning |
|-------|---------|
| 🔴 **Red** | Claude is coding / working (running tools, editing files) |
| 🟡 **Yellow** | Claude is awaiting your approval or input |
| 🟢 **Green** | Claude is done with its turn |

It's pure Python standard library (tkinter) — no pip installs, no dependencies.
Claude Code drives it through [hooks](https://docs.claude.com/en/docs/claude-code/hooks):
the hooks write one word to a small state file, and the window polls that file.

```
┌─────────────────┐        writes        ┌──────────────────────┐
│  Claude Code     │  ── hooks ──▶  ~/.claude/traffic_light.state │
│  (UserPromptSubmit,                     └──────────┬───────────┘
│   PreToolUse, Notification, Stop)                  │ polls (250ms)
└──────────────────┘                          ┌──────▼───────┐
                                              │ traffic_light │  always-on-top
                                              │     .py        │  window
                                              └───────────────┘
```

## Requirements

- Python 3.8+
- **tkinter** (bundled with the python.org installer on Windows/macOS):
  - Debian/Ubuntu: `sudo apt install python3-tk`
  - Fedora: `sudo dnf install python3-tkinter`

## Install (2 steps)

1. **Wire up the hooks** (merges into `~/.claude/settings.json`, keeping your
   existing settings; a timestamped backup is made):

   ```bash
   python install.py
   ```

   Restart Claude Code afterward so it loads the new hooks.

2. **Run the light** (leave it running in the background):

   ```bash
   python traffic_light.py
   ```

That's it. As you work in Claude Code, the light changes color.

## Using the window

- **Drag** it anywhere with the left mouse button.
- **Right-click**, or press **Esc** / **q**, to quit.
- It starts in the top-right corner of your primary screen and stays on top.

## Uninstall

```bash
python install.py --uninstall   # removes only the traffic-light hooks
```

## How it works / customizing

- The state lives in `~/.claude/traffic_light.state` (a single word: `red`,
  `yellow`, `green`, or `off`). Override the location for both scripts with the
  `TRAFFIC_LIGHT_STATE_FILE` environment variable.
- You can set the light manually for testing:

  ```bash
  python hooks/set_state.py yellow
  ```

- The hook → color mapping is defined in `install.py` (`EVENT_STATE`):
  - `UserPromptSubmit` → red
  - `PreToolUse` → red
  - `Notification` → yellow
  - `Stop` → green

  Edit that dict and re-run `python install.py` to change the behavior.
- Colors, lamp size, poll interval, and window position are constants near the
  top of `traffic_light.py`.

## Files

| File | Purpose |
|------|---------|
| `traffic_light.py` | The always-on-top window (run this). |
| `hooks/set_state.py` | Tiny helper the hooks call to write the state. |
| `install.py` | Merges/removes the hooks in `~/.claude/settings.json`. |

## Notes

- Hooks run shell commands on your machine; this one only writes a single word
  to a file and exits, and it never fails loudly so it won't block Claude Code.
- The light reflects the most recent Claude Code event in any session. If you
  run several sessions at once they share one state file.
