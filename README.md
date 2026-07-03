# Pi Agent VSCode Extension

Shares your VSCode editor state with a terminal-based Pi agent so you don't
have to describe what you're looking at. It exposes:

- the active file you're viewing
- all open files
- the exact lines you have selected (with file and line numbers)

so you can say "this function" instead of copy-pasting.

## Install

There are two halves — the VSCode extension and a small Pi companion — but the
extension installs the companion for you.

**1. Install the VSCode extension.** Search **"Pi Agent Context"** in the
Extensions panel, or from the command line:

```sh
code --install-extension zenyui.vscode-pi-bridge
```

Don't use the MS Marketplace (Cursor, VSCodium, Windsurf)? Grab the `.vsix`
from [Releases](https://github.com/zenyui/vscode-pi/releases) and:

```sh
code --install-extension vscode-pi-bridge-*.vsix
```

**2. Reload VSCode.** On startup the extension drops the Pi companion into
`~/.pi/agent/extensions/` automatically. A `📡 Pi` indicator appears in the
status bar.

**3. Use it.** Open a project and run `pi` in a **VSCode integrated terminal**.
The agent now sees your editor context automatically.

> Prefer to manage the companion with pi directly? It's also a pi package:
> `pi install git:github.com/zenyui/vscode-pi`

> Developing the extension? `npm install && npm run package`, install the
> generated `.vsix`, or press `F5` for an Extension Development Host.

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

See [docs/marketplaces.md](docs/marketplaces.md) for publishing and releases.
