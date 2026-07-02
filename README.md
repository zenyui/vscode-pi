# Pi Agent Context

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

VSCode and the terminal agent are separate processes, so they communicate
through a file. On every editor change (debounced), the extension writes:

- `<workspace>/.pi/vscode-context.md` — read by the agent
- `<workspace>/.pi/vscode-context.json` — machine-readable version

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
- **`open_in_editor` tool** — the agent opens a file at a line in your window
  (`code --goto path:line`).

The companion looks for the context file in this order:
`$PI_VSCODE_CONTEXT`, then `<cwd>/.pi/vscode-context.md`, then
`~/.pi/vscode-context.md`.

## Commands

Available in the command palette:

- **Pi Context: Toggle Sharing**
- **Pi Context: Write Context Now**
- **Pi Context: Show Context File Path**

## Settings

| Setting (`piContext.*`) | Default | Description |
|---|---|---|
| `enabled` | `true` | Auto-share on every editor change |
| `filePath` | `""` | Override output path (empty = `<workspace>/.pi/vscode-context.md`) |
| `debounceMs` | `300` | Delay before writing after edits stop |
| `maxSelectionLines` | `400` | Max selected lines shared verbatim |

## Development

```sh
npm install
npm run build     # bundle → dist/extension.js
npm run watch     # rebuild on save
```

Press `F5` to launch an Extension Development Host.
