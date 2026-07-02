// Pi companion extension for the "Pi Agent Context" VSCode extension.
//
// Install: copy to ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
//
// What it does:
//   - Auto-injects your ACTIVE FILE + SELECTED LINES into every message you send,
//     as hidden metadata (deduped). Open-files list is left to the pull tool to
//     keep turns small.
//   - Shows a live footer status of what's selected in the TUI.
//   - `/vscode-auto [on|off]` toggles auto-injection.
//   - `/vscode` and the `vscode_context` tool pull the FULL context on demand.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile } from "child_process";

const STATUS_KEY = "vscode";

interface Selection {
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
}
interface Ctx {
  activeFile: string | null;
  openFiles: { path: string; active: boolean; dirty: boolean }[];
  selection: { path: string; languageId: string; cursorLine: number; selections: Selection[] } | null;
}

function candidatePaths(cwd: string): string[] {
  const fromEnv = process.env.PI_VSCODE_CONTEXT;
  return [
    fromEnv,
    path.join(cwd, ".pi", "vscode-context.md"),
    path.join(os.homedir(), ".pi", "vscode-context.md"),
  ].filter((p): p is string => !!p);
}

function readMarkdown(cwd: string): { path: string; content: string } | null {
  for (const p of candidatePaths(cwd)) {
    try {
      return { path: p, content: fs.readFileSync(p, "utf8") };
    } catch {
      // try next
    }
  }
  return null;
}

function readJson(cwd: string): { path: string; data: Ctx } | null {
  for (const md of candidatePaths(cwd)) {
    const jsonPath = md.replace(/\.md$/, ".json");
    try {
      return { path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
    } catch {
      // try next
    }
  }
  return null;
}

// Short one-liner for the TUI footer: "vscode: extension.ts L120-148"
function statusLine(data: Ctx): string {
  const sel = data.selection;
  if (sel && sel.selections.length > 0) {
    const file = path.basename(sel.path);
    const ranges = sel.selections
      .map((s) => (s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`))
      .join(", ");
    return `📎 vscode: ${file} ${ranges}`;
  }
  if (data.activeFile) {
    return `📎 vscode: ${path.basename(data.activeFile)} (no selection)`;
  }
  return "📎 vscode: no file";
}

export default function (pi: ExtensionAPI) {
  let lastInjectedHash = "";

  // ---- Live footer status, driven by a watcher on the context file ----
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const update = () => {
      const found = readJson(process.cwd());
      if (found) ctx.ui.setStatus(STATUS_KEY, statusLine(found.data));
    };
    update();

    const found = readJson(process.cwd());
    if (found) {
      try {
        const dir = path.dirname(found.path);
        const base = path.basename(found.path);
        let timer: NodeJS.Timeout | undefined;
        fs.watch(dir, (_evt, fname) => {
          if (fname && fname !== base) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(update, 100);
        });
      } catch {
        // watching unavailable; status is still set once above
      }
    }
  });

  let autoInject = true;

  // Build a compact, selection-focused payload from the structured JSON.
  // Returns null when there's nothing worth sending.
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
    const found = readJson(process.cwd());
    if (!found) return;
    const payload = buildInjection(found.data);
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

  // ---- Open a file in VSCode at a specific line ----
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
        column: { type: "number", description: "1-based column (optional)" },
      },
      required: ["path"],
    } as never,
    async execute(_id: unknown, params: { path: string; line?: number; column?: number }) {
      const abs = path.isAbsolute(params.path) ? params.path : path.join(process.cwd(), params.path);
      let target = abs;
      if (params.line) {
        target += `:${params.line}`;
        if (params.column) target += `:${params.column}`;
      }
      const ok = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
        execFile("code", ["--goto", target], (error) => {
          resolve(error ? { ok: false, err: error.message } : { ok: true });
        });
      });
      const where = params.line ? `${params.path}:${params.line}` : params.path;
      return {
        content: [
          {
            type: "text",
            text: ok.ok
              ? `Opened ${where} in VSCode.`
              : `Failed to open ${where} (is the 'code' command on PATH?): ${ok.err}`,
          },
        ],
        details: { target },
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
      const found = readMarkdown(process.cwd());
      if (!found) {
        return {
          content: [{ type: "text", text: "No VSCode context file found. Is the 'Pi Agent Context' extension running?" }],
          details: {},
        };
      }
      return { content: [{ type: "text", text: found.content }], details: { path: found.path } };
    },
  });

  // ---- Manual command to inject context on demand ----
  pi.registerCommand("vscode", {
    description: "Inject current VSCode editor context (open files + selection)",
    handler: async (_args, ctx) => {
      const found = readMarkdown(process.cwd());
      if (!found) {
        ctx.ui.notify("No VSCode context file found.", "warning");
        return;
      }
      await pi.sendMessage({
        customType: "vscode-context",
        content: `Here is my current VSCode editor context:\n\n${found.content}`,
        display: true,
      });
    },
  });
}
