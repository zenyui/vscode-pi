import * as vscode from "vscode";
import * as path from "path";
import { IpcServer, IncomingMessage, OutgoingMessage } from "./ipc";

const PORT_ENV = "PI_VSCODE_PORT";
const PORT_KEY = "piContext.port";

let statusBar: vscode.StatusBarItem;
let debounceTimer: NodeJS.Timeout | undefined;
let enabled = true;
let ipc: IpcServer | undefined;

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

// Push the current editor state to any connected pi sessions.
function writeContext() {
  if (!enabled) return;
  ipc?.broadcast({ type: "context", data: collectContext() });
}

// Turn the current selection (or active file) into a `@path#Lstart-end`
// mention and push it into the pi prompt box.
function sendSelectionToPi() {
  if (!ipc || ipc.clientCount === 0) {
    vscode.window.showWarningMessage(
      "No Pi session connected. Run `pi` in a VSCode terminal.",
    );
    return;
  }
  const ctx = collectContext();
  let text: string | undefined;
  const sel = ctx.selection;
  if (sel && sel.selections.length > 0) {
    text = sel.selections
      .map((s) =>
        s.startLine === s.endLine
          ? `@${sel.path}#L${s.startLine}`
          : `@${sel.path}#L${s.startLine}-${s.endLine}`,
      )
      .join(" ");
  } else if (ctx.activeFile) {
    text = `@${ctx.activeFile}`;
  }
  if (!text) {
    vscode.window.showWarningMessage("No file or selection to send.");
    return;
  }
  ipc.broadcast({ type: "inject", text });
}

// pi -> VSCode: open a file, optionally selecting/revealing a line range.
async function handleOpen(msg: Extract<IncomingMessage, { type: "open" }>) {
  try {
    const root = workspaceRoot();
    const abs = path.isAbsolute(msg.path)
      ? msg.path
      : path.join(root ?? process.cwd(), msg.path);
    const doc = await vscode.workspace.openTextDocument(abs);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
    });
    if (msg.line) {
      const startLine = Math.max(0, msg.line - 1);
      const endLine = Math.max(startLine, (msg.endLine ?? msg.line) - 1);
      const col = Math.max(0, (msg.column ?? 1) - 1);
      const range = new vscode.Range(
        startLine,
        col,
        endLine,
        doc.lineAt(endLine).range.end.character,
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  } catch (err) {
    console.error("piContext: failed to open file from pi", err);
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

  // Start the IPC server and stamp its port into the terminal environment so
  // any `pi` launched in a VSCode terminal connects automatically.
  ipc = new IpcServer({
    onConnect: (send) => {
      send({ type: "context", data: collectContext() } as OutgoingMessage);
    },
    onMessage: (msg) => {
      if (msg.type === "open") handleOpen(msg);
    },
    onListening: (port) => {
      // Persist so we can reclaim the same port after a reload — running pi
      // clients keep retrying it and reconnect automatically.
      context.workspaceState.update(PORT_KEY, port);
      context.environmentVariableCollection.replace(PORT_ENV, String(port));
    },
    onError: (err) => console.error("piContext: ipc server error", err),
  });
  ipc.listen(context.workspaceState.get<number>(PORT_KEY));

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
    vscode.commands.registerCommand("piContext.sendToPi", sendSelectionToPi),
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
  ipc?.dispose();
  ipc = undefined;
}
