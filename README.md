# 📡 Pi Agent Context

> Your terminal Pi agent, but with eyes.

You're in the editor. Your Pi agent is in the terminal. They live in the same
project but can't see each other — so you keep typing *"the file I have open"*
and *"the function I just selected"* like it's 2009 and you're describing a
bug over the phone.

This little extension fixes that. It quietly tells your terminal Pi agent:

- 👀 **what file you're looking at**
- 🗂️ **every file you have open**
- ✂️ **the exact lines you've selected** (with file + line numbers)

No more copy-paste. No more "line 42, no wait, my line 42."

## 🚀 Quickstart

**1. Build & install the VSCode extension:**

```sh
npm install
npm run package                              # → vscode-pi-ext-0.0.1.vsix
code --install-extension vscode-pi-ext-0.0.1.vsix
```

Reload VSCode — you'll see `📡 Pi` in the status bar.

**2. Teach your terminal Pi agent to read the notes:**

```sh
cp pi/pi-vscode-context.ts ~/.pi/agent/extensions/
```

If Pi is already running, type `/reload`.

**3. Use it.** Open a project in VSCode *and* run `pi` in that same project.
Then in the Pi session, type `/vscode` — or just let the agent call the
`vscode_context` tool when it needs to see what you're doing.

> Just hacking on the extension? Skip packaging and press `F5` in VSCode to
> launch an Extension Development Host instead.

## How the magic works

VSCode and your terminal agent are two separate processes that don't share a
brain. So they pass notes. On every editor change, this extension drops a
fresh context file:

- `<workspace>/.pi/vscode-context.md` — the version the agent actually reads
- `<workspace>/.pi/vscode-context.json` — the same thing, but for robots

A tidy little `📡 Pi` sits in your status bar. Green light = the agent can see
you. Click it to pull the blinds down (`🚫 Pi`) when you want privacy.

## Wiring up the agent

Two moving parts, one cable.

**1. Run the VSCode extension** (F5 in the dev host, or install the `.vsix`).

**2. Give the terminal agent a way to read the notes:**

```sh
cp pi/pi-vscode-context.ts ~/.pi/agent/extensions/
```

Now, in your terminal Pi session:

- Type **`/vscode`** to hand the agent your current editor state, or
- Just ask it to do something — it can call the **`vscode_context`** tool on
  its own whenever it needs to know what you're staring at.

The companion hunts for the context file in this order: `$PI_VSCODE_CONTEXT`,
then `<cwd>/.pi/vscode-context.md`, then `~/.pi/vscode-context.md`.

## Knobs & levers

Status bar too subtle? Command palette to the rescue:

- **Pi Context: Toggle Sharing**
- **Pi Context: Write Context Now**
- **Pi Context: Show Context File Path**

Settings (`piContext.*`):

| Setting | Default | What it does |
|---|---|---|
| `enabled` | `true` | Auto-share on every change |
| `filePath` | `""` | Override the drop location (empty = `<workspace>/.pi/vscode-context.md`) |
| `debounceMs` | `300` | How long to wait before writing after you stop fidgeting |
| `maxSelectionLines` | `400` | Cap on selected lines shared verbatim (nobody needs your 10k-line paste) |

## Hacking on it

```sh
npm install
npm run build     # bundle → dist/extension.js
npm run watch     # rebuild on save
```

Hit `F5` to launch an Extension Development Host and poke at it live.

---

Made for people who'd rather point than describe.
