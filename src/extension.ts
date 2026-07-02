import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

let statusBar: vscode.StatusBarItem;
let debounceTimer: NodeJS.Timeout | undefined;
let enabled = true;

interface OpenFile {
  path: string;
  active: boolean;
  languageId: string;
  dirty: boolean;
}

interface SelectionInfo {
  path: string;
  languageId: string;
  cursorLine: number;
  selections: {
    startLine: number;
    endLine: number;
    text: string;
    truncated: boolean;
  }[];
}

interface Context {
  workspace: string | null;
  timestamp: string;
  activeFile: string | null;
  openFiles: OpenFile[];
  selection: SelectionInfo | null;
}

function config() {
  return vscode.workspace.getConfiguration("piContext");
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Resolve the target file: <workspace>/.pi/vscode-context.md
function resolvePath(): string {
  const configured = config().get<string>("filePath")?.trim();
  if (configured) return configured;
  const root = workspaceRoot() ?? path.join(require("os").homedir());
  return path.join(root, ".pi", "vscode-context.md");
}

function relTo(root: string | undefined, fsPath: string): string {
  if (root && fsPath.startsWith(root)) {
    return path.relative(root, fsPath) || fsPath;
  }
  return fsPath;
}

function collectContext(): Context {
  const root = workspaceRoot();
  const editor = vscode.window.activeTextEditor;
  const maxLines = config().get<number>("maxSelectionLines") ?? 400;

  const openFiles: OpenFile[] = [];
  const seen = new Set<string>();
  for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
    const input = tab.input;
    if (input && typeof input === "object" && "uri" in input) {
      const uri = (input as { uri: vscode.Uri }).uri;
      if (uri.scheme !== "file") continue;
      if (seen.has(uri.fsPath)) continue;
      seen.add(uri.fsPath);
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === uri.fsPath,
      );
      openFiles.push({
        path: relTo(root, uri.fsPath),
        active: tab.isActive,
        languageId: doc?.languageId ?? path.extname(uri.fsPath).slice(1),
        dirty: tab.isDirty,
      });
    }
  }

  let selection: SelectionInfo | null = null;
  if (editor && editor.document.uri.scheme === "file") {
    const doc = editor.document;
    const sels = editor.selections
      .filter((s) => !s.isEmpty)
      .map((s) => {
        const startLine = s.start.line + 1;
        const endLine = s.end.line + 1;
        const truncated = endLine - startLine + 1 > maxLines;
        const range = truncated
          ? new vscode.Range(s.start.line, 0, s.start.line + maxLines, 0)
          : s;
        return {
          startLine,
          endLine,
          text: doc.getText(range),
          truncated,
        };
      });
    selection = {
      path: relTo(root, doc.uri.fsPath),
      languageId: doc.languageId,
      cursorLine: editor.selection.active.line + 1,
      selections: sels,
    };
  }

  return {
    workspace: root ?? null,
    timestamp: new Date().toISOString(),
    activeFile: editor?.document.uri.scheme === "file"
      ? relTo(root, editor.document.uri.fsPath)
      : null,
    openFiles,
    selection,
  };
}

function renderMarkdown(ctx: Context): string {
  const lines: string[] = [];
  lines.push("# VSCode editor context");
  lines.push("");
  lines.push(`_Updated: ${ctx.timestamp}_`);
  if (ctx.workspace) lines.push(`Workspace: \`${ctx.workspace}\``);
  lines.push("");

  lines.push("## Active file");
  lines.push(ctx.activeFile ? `\`${ctx.activeFile}\`` : "_none_");
  lines.push("");

  lines.push("## Open files");
  if (ctx.openFiles.length === 0) {
    lines.push("_none_");
  } else {
    for (const f of ctx.openFiles) {
      const marks = [f.active ? "active" : null, f.dirty ? "unsaved" : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`- \`${f.path}\`${marks ? ` (${marks})` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Selection");
  if (!ctx.selection || ctx.selection.selections.length === 0) {
    const cur = ctx.selection ? ` (cursor at line ${ctx.selection.cursorLine})` : "";
    lines.push(`_no selection_${cur}`);
  } else {
    const sel = ctx.selection;
    for (const s of sel.selections) {
      lines.push(
        `\`${sel.path}\` lines ${s.startLine}-${s.endLine}${s.truncated ? " (truncated)" : ""}:`,
      );
      lines.push("");
      lines.push("```" + sel.languageId);
      lines.push(s.text);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

function writeContext() {
  if (!enabled) return;
  try {
    const ctx = collectContext();
    const mdPath = resolvePath();
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, renderMarkdown(ctx), "utf8");
    const jsonPath = mdPath.replace(/\.md$/, ".json");
    fs.writeFileSync(jsonPath, JSON.stringify(ctx, null, 2), "utf8");
  } catch (err) {
    console.error("piContext: failed to write context", err);
  }
}

function scheduleWrite() {
  if (!enabled) return;
  const delay = config().get<number>("debounceMs") ?? 300;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(writeContext, delay);
}

function updateStatusBar() {
  statusBar.text = enabled ? "$(radio-tower) Pi" : "$(circle-slash) Pi";
  statusBar.tooltip = enabled
    ? "Sharing editor context with Pi agent (click to pause)"
    : "Pi context sharing paused (click to resume)";
  statusBar.show();
}

export function activate(context: vscode.ExtensionContext) {
  enabled = config().get<boolean>("enabled") ?? true;

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.command = "piContext.toggle";
  updateStatusBar();

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("piContext.toggle", () => {
      enabled = !enabled;
      config().update("enabled", enabled, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      if (enabled) writeContext();
    }),
    vscode.commands.registerCommand("piContext.writeNow", () => {
      writeContext();
      vscode.window.showInformationMessage(
        `Pi context written to ${resolvePath()}`,
      );
    }),
    vscode.commands.registerCommand("piContext.showPath", () => {
      vscode.window.showInformationMessage(`Pi context file: ${resolvePath()}`);
    }),
    vscode.window.onDidChangeActiveTextEditor(scheduleWrite),
    vscode.window.onDidChangeTextEditorSelection(scheduleWrite),
    vscode.window.tabGroups.onDidChangeTabs(scheduleWrite),
    vscode.workspace.onDidSaveTextDocument(scheduleWrite),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("piContext")) {
        enabled = config().get<boolean>("enabled") ?? true;
        updateStatusBar();
        scheduleWrite();
      }
    }),
  );

  writeContext();
}

export function deactivate() {
  if (debounceTimer) clearTimeout(debounceTimer);
}
