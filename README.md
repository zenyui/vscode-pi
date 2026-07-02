# Pi Agent VSCode Extension

Shares your VSCode editor state with a terminal-based Pi agent so you don't
have to describe what you're looking at.

On every editor change, the extension writes a context file with:

- the active file you're viewing
- all open files
- the exact lines you have selected (with file and line numbers)

Your terminal Pi agent reads that file, so you can say "this function" instead
of copy-pasting.

## Quickstart

**1. Build and install the VSCode extension:**

```sh
npm install
npm run package                              # → vscode-pi-ext-0.0.1.vsix
code --install-extension vscode-pi-ext-0.0.1.vsix
```

Reload VSCode. A `📡 Pi` indicator appears in the status bar.

**2. Install the Pi companion extension:**

```sh
cp pi/pi-vscode-context.ts ~/.pi/agent/extensions/
```

If Pi is already running, type `/reload`.

**3. Use it.** Open a project in VSCode and run `pi` in the same project. The
agent now sees your editor context automatically.

> Developing the extension? Press `F5` in VSCode to launch an Extension
> Development Host instead of packaging.

## How it works

VSCode and the terminal agent are separate processes, so they talk over a
loopback socket. The extension runs the server and exports its port as
`PI_VSCODE_PORT` into VSCode's integrated terminals. Any `pi` you launch there
connects automatically and gets editor context pushed in real time — no files,
no polling. The socket is bidirectional: the agent can also ask VSCode to open
and highlight a line range, and you can push a mention the other way.

Because it relies on the terminal environment, `pi` must run in a **VSCode
integrated terminal**. External terminals (iTerm, tmux) won't inherit the port
and won't connect.

The `📡 Pi` status bar item shows sharing is on. Click it to toggle off
(`🚫 Pi`) when you want privacy.

## Agent features

Once the companion is installed, the agent can:

- **Auto-inject** — your active file and selected lines are attached to every
  message you send (hidden, deduped). The Pi footer shows the current
  selection, e.g. `📎 vscode: file.ts L120-148`.
- **`/vscode-auto off`** — pause auto-injection (`on` to resume).
- **`/vscode`** — manually dump the full context, including open files.
- **`vscode_context` tool** — the agent pulls full context on demand.
- **`open_in_editor` tool** — the agent opens a file in your window and selects
  an exact line range.

Push the other way with **`Cmd+Alt+K`** (`Ctrl+Alt+K` on Windows/Linux): drops
a `@path#Lstart-end` mention for your selection straight into the pi prompt.

## Commands

Available in the command palette:

- **Pi Context: Toggle Sharing**
- **Pi Context: Send Selection to Pi** (`Cmd+Alt+K`)

## Settings

| Setting (`piContext.*`) | Default | Description |
|---|---|---|
| `enabled` | `true` | Auto-share on every editor change |
| `debounceMs` | `300` | Delay before sharing after edits stop |
| `maxSelectionLines` | `400` | Max selected lines shared verbatim |

## Development

```sh
npm install
npm run build     # bundle → dist/extension.js
npm run watch     # rebuild on save
```

Press `F5` to launch an Extension Development Host.
