// Pi companion extension for the "Pi Agent Context" VSCode extension.
//
// Install: copy to ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
//
// Talks to the VSCode extension over a loopback socket. VSCode owns the server
// and exports its port via PI_VSCODE_PORT into the terminal env; we dial it.
//
// What it does:
//   - Auto-injects your ACTIVE FILE + SELECTED LINES into every message you send,
//     as hidden metadata (deduped). Open-files list is left to the pull tool to
//     keep turns small.
//   - Shows a live footer status of what's selected in the TUI.
//   - Receives `Cmd+Alt+K` mentions from VSCode into the prompt box.
//   - `/vscode-auto [on|off]` toggles auto-injection.
//   - `/vscode` and the `vscode_context` tool pull the FULL context on demand.
//   - `open_in_editor` asks VSCode to open + highlight a line range.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "path";
import * as net from "net";
import * as crypto from "crypto";

const STATUS_KEY = "vscode";
const PORT_ENV = "PI_VSCODE_PORT";

interface Selection {
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
}
interface OpenFile {
  path: string;
  active: boolean;
  languageId?: string;
  dirty: boolean;
}
interface Ctx {
  activeFile: string | null;
  openFiles: OpenFile[];
  selection: { path: string; languageId: string; cursorLine: number; selections: Selection[] } | null;
}

// Short one-liner for the TUI footer: "vscode: extension.ts L120-148"
function statusLine(data: Ctx): string {
  const sel = data.selection;
  if (sel && sel.selections.length > 0) {
    const file = path.basename(sel.path);
    const ranges = sel.selections
      .map((s) => (s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`))
      .join(", ");
    return `vscode: ${file} ${ranges}`;
  }
  if (data.activeFile) {
    return `vscode: ${path.basename(data.activeFile)} (no selection)`;
  }
  return "vscode: no file";
}

// Widget factory: renders a single line flush-left (no leading padding, unlike
// the string-array form of setWidget which prefixes each line with a space).
function lineWidget(text: string) {
  return () => ({
    render: () => [text],
    invalidate: () => {},
  });
}

// Full markdown view of the editor state (for the pull tool + /vscode command).
function renderMarkdown(data: Ctx): string {
  const lines: string[] = ["# VSCode editor context", ""];

  lines.push("## Active file");
  lines.push(data.activeFile ? `\`${data.activeFile}\`` : "_none_");
  lines.push("");

  lines.push("## Open files");
  if (!data.openFiles.length) {
    lines.push("_none_");
  } else {
    for (const f of data.openFiles) {
      const marks = [f.active ? "active" : null, f.dirty ? "unsaved" : null].filter(Boolean).join(", ");
      lines.push(`- \`${f.path}\`${marks ? ` (${marks})` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Selection");
  const sel = data.selection;
  if (!sel || sel.selections.length === 0) {
    const cur = sel ? ` (cursor at line ${sel.cursorLine})` : "";
    lines.push(`_no selection_${cur}`);
  } else {
    for (const s of sel.selections) {
      lines.push(`\`${sel.path}\` lines ${s.startLine}-${s.endLine}${s.truncated ? " (truncated)" : ""}:`);
      lines.push("");
      lines.push("```" + sel.languageId);
      lines.push(s.text);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

// ---- Live socket link to the VSCode extension (server) ----------------------
// VSCode owns the server and exports its port via PI_VSCODE_PORT. We dial it,
// receive `context` pushes (drive footer + injection + tools), receive `inject`
// (drop a mention into the prompt), and send `open` requests.
interface LiveLink {
  latest: Ctx | null;
  send: (msg: { type: "open"; path: string; line?: number; endLine?: number; column?: number }) => boolean;
  connected: () => boolean;
}

function connectVscode(handlers: {
  onContext: (data: Ctx) => void;
  onInject: (text: string) => void;
}): LiveLink | null {
  const port = Number(process.env[PORT_ENV]);
  if (!port) return null;

  const link: LiveLink = { latest: null, send: () => false, connected: () => false };
  let socket: net.Socket | undefined;
  let buffer = "";
  let stopped = false;

  const dial = () => {
    if (stopped) return;
    socket = net.connect(port, "127.0.0.1");
    socket.setEncoding("utf8");
    link.send = (msg) => {
      if (socket && socket.writable) return socket.write(JSON.stringify(msg) + "\n");
      return false;
    };
    link.connected = () => !!socket && !socket.destroyed && socket.writable;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "context") {
            link.latest = msg.data as Ctx;
            handlers.onContext(msg.data as Ctx);
          } else if (msg.type === "inject") {
            handlers.onInject(msg.text as string);
          }
        } catch {
          // ignore malformed line
        }
      }
    });
    const retry = () => {
      socket = undefined;
      buffer = "";
      if (!stopped) setTimeout(dial, 1000);
    };
    socket.on("close", retry);
    socket.on("error", () => socket?.destroy());
  };
  dial();

  // Best-effort teardown when the process exits.
  process.on("exit", () => { stopped = true; socket?.destroy(); });
  return link;
}

export default function (pi: ExtensionAPI) {
  let lastInjectedHash = "";
  let link: LiveLink | null = null;
  const NO_LINK = "Not connected to VSCode. Run pi in a VSCode integrated terminal.";

  // ---- Live footer status + socket link ----
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    link = connectVscode({
      onContext: (data) => ctx.ui.setWidget(STATUS_KEY, lineWidget(statusLine(data)), { placement: "aboveEditor" }),
      onInject: (text) => {
        // setEditorText replaces the buffer; append to preserve any draft.
        const existing = ctx.ui.getEditorText?.() ?? "";
        const next = existing ? `${existing} ${text}` : text;
        ctx.ui.setEditorText(next);
      },
    });

    // Only show a placeholder when we're actually inside VSCode (link != null).
    // Outside VSCode (no PI_VSCODE_PORT) we stay silent entirely.
    if (link) ctx.ui.setWidget(STATUS_KEY, lineWidget("vscode: connecting…"), { placement: "aboveEditor" });

  });

  let autoInject = true;

  // Build a compact, selection-focused payload. Null when nothing worth sending.
  const buildInjection = (data: Ctx): string | null => {
    const sel = data.selection;
    if (sel && sel.selections.length > 0) {
      const parts: string[] = [];
      parts.push(`User is in \`${sel.path}\` (cursor line ${sel.cursorLine}).`);
      for (const s of sel.selections) {
        const range = s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`;
        parts.push(`Selected ${range}${s.truncated ? " (truncated)" : ""}:`);
        parts.push("```" + sel.languageId);
        parts.push(s.text);
        parts.push("```");
      }
      parts.push("(Full open-file list available via the vscode_context tool.)");
      return parts.join("\n");
    }
    if (data.activeFile) {
      return `User is focused on \`${data.activeFile}\` (no selection). Use the vscode_context tool for open files.`;
    }
    return null;
  };

  // ---- Smart auto-injection: attach active file + selection to each turn ----
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!autoInject) return;
    const data = link?.latest;
    if (!data) return;
    const payload = buildInjection(data);
    if (!payload) return;

    // Dedupe: skip if identical to what we injected last turn (saves tokens;
    // the model still has the previous copy in context).
    const hash = crypto.createHash("sha1").update(payload).digest("hex");
    if (hash === lastInjectedHash) return;
    lastInjectedHash = hash;

    return {
      message: {
        customType: "vscode-context",
        content: `Current VSCode editor state (auto-attached):\n\n${payload}`,
        display: false,
      },
    };
  });

  // ---- Toggle auto-injection ----
  pi.registerCommand("vscode-auto", {
    description: "Toggle auto-injection of VSCode context (on|off)",
    handler: async (args, ctx) => {
      const a = (args || "").trim().toLowerCase();
      autoInject = a === "on" ? true : a === "off" ? false : !autoInject;
      lastInjectedHash = "";
      ctx.ui.notify(`VSCode auto-inject ${autoInject ? "on" : "off"}`, "info");
    },
  });

  // ---- Open a file in VSCode at a specific line/range ----
  pi.registerTool({
    name: "open_in_editor",
    label: "Open in VSCode",
    description:
      "Open a file in the user's VSCode window and put the cursor on a line. " +
      "Use when you want to show the user a specific location in a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (absolute, or relative to the project root)" },
        line: { type: "number", description: "1-based line number to jump to (optional)" },
        endLine: { type: "number", description: "1-based end line to select through (optional)" },
        column: { type: "number", description: "1-based column (optional)" },
      },
      required: ["path"],
    } as never,
    async execute(_id: unknown, params: { path: string; line?: number; endLine?: number; column?: number }) {
      const where = params.line ? `${params.path}:${params.line}` : params.path;
      const sent = link?.connected() && link.send({
        type: "open",
        path: params.path,
        line: params.line,
        endLine: params.endLine,
        column: params.column,
      });
      return {
        content: [{ type: "text", text: sent ? `Opened ${where} in VSCode.` : NO_LINK }],
        details: { via: "socket", sent: !!sent },
      };
    },
  });

  // ---- On-demand tool the agent can call itself ----
  pi.registerTool({
    name: "vscode_context",
    label: "VSCode context",
    description:
      "Read the user's current VSCode editor state: active file, open files, " +
      "and selected lines of code. Use this to know what the user is looking at.",
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      const data = link?.latest;
      if (!data) return { content: [{ type: "text", text: NO_LINK }], details: {} };
      return { content: [{ type: "text", text: renderMarkdown(data) }], details: {} };
    },
  });

  // ---- Manual command to inject context on demand ----
  pi.registerCommand("vscode", {
    description: "Inject current VSCode editor context (open files + selection)",
    handler: async (_args, ctx) => {
      const data = link?.latest;
      if (!data) {
        ctx.ui.notify(NO_LINK, "warning");
        return;
      }
      await pi.sendMessage({
        customType: "vscode-context",
        content: `Here is my current VSCode editor context:\n\n${renderMarkdown(data)}`,
        display: true,
      });
    },
  });
}
