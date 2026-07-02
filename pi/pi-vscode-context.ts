// Pi companion extension for the "Pi Agent Context" VSCode extension.
//
// Install: copy to ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
//
// What it does:
//   - Auto-injects your current VSCode editor state (active file, open files,
//     selected lines) into every message you send, as hidden metadata.
//   - Shows a live footer status of what's selected in the TUI.
//   - Also exposes an on-demand `/vscode` command and `vscode_context` tool.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

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

  // ---- Fully-auto injection: staple current editor context to every turn ----
  pi.on("before_agent_start", async (_event, _ctx) => {
    const found = readMarkdown(process.cwd());
    if (!found) return;

    // Dedupe: skip if identical to what we injected last turn (saves tokens;
    // the model still has the previous copy in context).
    const hash = crypto.createHash("sha1").update(found.content).digest("hex");
    if (hash === lastInjectedHash) return;
    lastInjectedHash = hash;

    return {
      message: {
        customType: "vscode-context",
        content: `Current VSCode editor state (auto-attached):\n\n${found.content}`,
        display: false,
      },
    };
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
