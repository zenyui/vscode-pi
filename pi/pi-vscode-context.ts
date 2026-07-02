// Pi companion extension for the "Pi Agent Context" VSCode extension.
//
// Install: copy to ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
// Gives the terminal agent a `vscode_context` tool + `/vscode` command that
// read the context file the VSCode extension writes.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function candidatePaths(cwd: string): string[] {
  const fromEnv = process.env.PI_VSCODE_CONTEXT;
  return [
    fromEnv,
    path.join(cwd, ".pi", "vscode-context.md"),
    path.join(os.homedir(), ".pi", "vscode-context.md"),
  ].filter((p): p is string => !!p);
}

function readContext(cwd: string): { path: string; content: string } | null {
  for (const p of candidatePaths(cwd)) {
    try {
      const content = fs.readFileSync(p, "utf8");
      return { path: p, content };
    } catch {
      // try next
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "vscode_context",
    label: "VSCode context",
    description:
      "Read the user's current VSCode editor state: active file, open files, " +
      "and selected lines of code. Use this to know what the user is looking at.",
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      const ctx = readContext(process.cwd());
      if (!ctx) {
        return {
          content: [
            {
              type: "text",
              text: "No VSCode context file found. Is the 'Pi Agent Context' extension running?",
            },
          ],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: ctx.content }],
        details: { path: ctx.path },
      };
    },
  });

  pi.registerCommand("vscode", {
    description: "Inject current VSCode editor context (open files + selection)",
    handler: async (_args, ctx) => {
      const found = readContext(process.cwd());
      if (!found) {
        ctx.ui.notify("No VSCode context file found.", "warning");
        return;
      }
      await pi.sendMessage(
        `Here is my current VSCode editor context:\n\n${found.content}`,
      );
    },
  });
}
