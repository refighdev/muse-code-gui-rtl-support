import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";

/**
 * Muse Code GUI inside the editor. The extension runs the same musegui-server the desktop app bundles,
 * on the editor's own Node runtime, and shows the web UI: a compact one-folder panel in the side
 * bar, or the full app in an editor tab. Nothing is reimplemented: the server drives `muse serve`
 * over MSP, and the UI talks to the server.
 */

const LISTENING = /musegui-server listening on (http:\/\/\S+)/;
const START_TIMEOUT_MS = 20_000;
const VIEW_ID = "musegui.panel";

let output: vscode.OutputChannel;
let server: ServerHost | null = null;
let editorPanel: vscode.WebviewPanel | null = null;
let sideView: PanelView | null = null;

/** What the extension exposes to other code: only the tests use it. */
export interface MuseGuiApi {
  serverUrl(): Promise<string>;
  panelLoaded(): string | null;
  /** Handles a message as if the Muse Code GUI frame had sent it. */
  frameMessage(message: unknown): void;
}

export function activate(context: vscode.ExtensionContext): MuseGuiApi {
  output = vscode.window.createOutputChannel("Muse Code GUI");
  server = new ServerHost(context);
  sideView = new PanelView();
  context.subscriptions.push(
    output,
    { dispose: () => server?.stop() },
    vscode.window.registerWebviewViewProvider(VIEW_ID, sideView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      const message = { type: "musegui-theme", theme: editorTheme() };
      void sideView?.post(message);
      void editorPanel?.webview.postMessage(message);
    }),
    // A different folder means a different panel: reload it on the new one.
    vscode.workspace.onDidChangeWorkspaceFolders(() => void sideView?.load()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("musegui.panelBorder") || event.affectsConfiguration("workbench.sideBar.location")) {
        void sideView?.load();
      }
    }),
    vscode.commands.registerCommand("musegui.open", () => focusPanel()),
    vscode.commands.registerCommand("musegui.newThread", () => newThreadInPanel()),
    vscode.commands.registerCommand("musegui.openInEditor", () => openEditor(context)),
    vscode.commands.registerCommand("musegui.openForFolder", (uri?: vscode.Uri) => openForFolder(context, uri)),
    vscode.commands.registerCommand("musegui.openInBrowser", () => openInBrowser()),
    vscode.commands.registerCommand("musegui.restart", () => restart()),
    vscode.commands.registerCommand("musegui.showLog", () => output.show()),
  );
  return { serverUrl: () => (server as ServerHost).url(), panelLoaded: () => sideView?.loadedSrc ?? null, frameMessage: onFrameMessage };
}

export function deactivate(): void {
  server?.stop();
}

/** The musegui-server child process, started on first use and reused until the window closes. */
class ServerHost {
  private child: ChildProcess | null = null;
  private starting: Promise<string> | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** The server's local address, starting it if it isn't running. */
  url(): Promise<string> {
    if (!this.starting) {
      this.starting = this.start().catch((error: unknown) => {
        this.starting = null;
        throw error;
      });
    }
    return this.starting;
  }

  stop(): void {
    this.starting = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      child.kill();
    }
  }

  private start(): Promise<string> {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) {
      return Promise.reject(
        new Error(`Muse Code GUI needs an editor built on Node 22 or newer (this one runs Node ${process.versions.node}). Update VS Code to 1.101 or newer.`),
      );
    }
    const dist = join(this.context.extensionPath, "dist");
    // Its own data folder: the desktop app may be running against ~/.musegui at the same time.
    const dataDir = this.context.globalStorageUri.fsPath;
    mkdirSync(dataDir, { recursive: true });
    const args = [join(dist, "server.cjs"), "--port", "0", "--static", join(dist, "frontend"), "--data-dir", dataDir];
    output.appendLine(`Starting musegui-server with ${process.execPath}`);
    // ELECTRON_RUN_AS_NODE makes the editor's own binary behave as plain Node, so nothing extra ships.
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let buffered = "";
      const timer = setTimeout(() => fail(new Error("musegui-server did not start within 20 seconds.")), START_TIMEOUT_MS);
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(error);
        }
      };
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        output.append(chunk);
        buffered += chunk;
        const match = LISTENING.exec(buffered);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(match[1] as string);
        }
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => output.append(chunk));
      child.on("error", (error) => fail(error));
      child.on("exit", (code, signal) => {
        output.appendLine(`musegui-server exited (${signal ?? `code ${code}`})`);
        if (this.child === child) {
          this.child = null;
          this.starting = null;
        }
        fail(new Error(`musegui-server exited before it was ready (${signal ?? `code ${code}`}).`));
      });
    });
  }
}

/** The side bar view: the compact one-folder layout for the workspace's first folder. */
class PanelView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  /** The page the frame was last pointed at; the tests read it. */
  loadedSrc: string | null = null;
  /** A page asked for before the frame is up (a cold start); the next load opens on it. */
  private pendingHash: string | null = null;
  /** Counts loads, so a slow load that a newer one overtook does nothing when it finishes. */
  private loads = 0;

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message) => onFrameMessage(message, view.webview));
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = null;
        this.loadedSrc = null;
      }
    });
    await this.load();
  }

  /** (Re)loads the panel, after first making sure the server runs and knows the folder. */
  async load(): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    const load = ++this.loads;
    this.loadedSrc = null;
    view.webview.html = messageHtml("Starting Muse Code GUI…");
    try {
      const base = await externalUrl();
      if (load !== this.loads || this.view !== view) {
        return;
      }
      const cwd = workspaceFolder();
      if (cwd) {
        // Not awaited: adding a folder also lists its threads through Muse, which can take many seconds,
        // and the panel shows the folder as soon as the server has recorded it.
        void addProject(cwd);
      }
      const query = new URLSearchParams({ view: "panel", host: "editor", theme: editorTheme(), ...(cwd ? { cwd } : {}) });
      this.loadedSrc = `${base}/?${query.toString()}${this.pendingHash ?? ""}`;
      this.pendingHash = null;
      view.webview.html = frameHtml(base, this.loadedSrc, "sideBar", panelBorder());
    } catch (error) {
      if (load !== this.loads || this.view !== view) {
        return;
      }
      view.webview.html = messageHtml(
        `Muse Code GUI could not start: ${(error instanceof Error ? error.message : String(error)).replace(/\.$/, "")}. Run “Muse Code GUI: Show Log” for details, or “Muse Code GUI: Restart Server”.`,
      );
    }
  }

  post(message: unknown): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage(message);
  }

  /** Moves the panel to a page, or remembers it while the panel is still starting and has no frame to message. */
  navigate(hash: string): void {
    if (this.loadedSrc) void this.post({ type: "navigate-hash", hash });
    else this.pendingHash = hash;
  }
}

/** The panel edge that faces the editor, from the setting or the side bar's location. */
function panelBorder(): "left" | "right" | "none" {
  const setting = vscode.workspace.getConfiguration("musegui").get<string>("panelBorder", "auto");
  if (setting === "left" || setting === "right" || setting === "none") {
    return setting;
  }
  return vscode.workspace.getConfiguration("workbench").get<string>("sideBar.location", "left") === "right" ? "left" : "right";
}

function editorTheme(): "light" | "dark" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

/** The first workspace folder, with a Windows drive letter uppercased the way the server stores it. */
function workspaceFolder(): string | null {
  const path = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return path ? normalizeFolder(path) : null;
}

function normalizeFolder(path: string): string {
  return path.replace(/^([a-z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);
}

/** The server URL as the webview can reach it: forwarded when the extension runs remotely. */
async function externalUrl(): Promise<string> {
  const local = await (server as ServerHost).url();
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(local));
  return external.toString(true).replace(/\/$/, "");
}

async function addProject(cwd: string): Promise<void> {
  try {
    const local = await (server as ServerHost).url();
    const res = await fetch(`${local}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    if (!res.ok) {
      output.appendLine(`Adding ${cwd} as a project failed: ${res.status} ${await res.text()}`);
    }
  } catch (error) {
    output.appendLine(`Adding ${cwd} as a project failed: ${String(error)}`);
  }
}

async function focusPanel(): Promise<void> {
  await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
}

async function newThreadInPanel(): Promise<void> {
  await focusPanel();
  const cwd = workspaceFolder();
  sideView?.navigate(cwd ? `#/new/${encodeURIComponent(cwd)}` : "#/new");
}

/** The full app, sidebar and all, in an editor tab. */
async function openEditor(context: vscode.ExtensionContext, hash = ""): Promise<void> {
  let base: string;
  try {
    base = await externalUrl();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const choice = await vscode.window.showErrorMessage(`Muse Code GUI could not start: ${message}`, "Show Log");
    if (choice === "Show Log") {
      output.show();
    }
    return;
  }
  if (editorPanel) {
    editorPanel.reveal(vscode.ViewColumn.Active);
    if (hash) {
      void editorPanel.webview.postMessage({ type: "navigate-hash", hash });
    }
    return;
  }
  editorPanel = vscode.window.createWebviewPanel("musegui", "Muse Code GUI", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  editorPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
  editorPanel.webview.html = frameHtml(base, `${base}/?${new URLSearchParams({ host: "editor", theme: editorTheme() }).toString()}${hash}`, "editor");
  const panelWebview = editorPanel.webview;
  panelWebview.onDidReceiveMessage((message) => onFrameMessage(message, panelWebview));
  editorPanel.onDidDispose(() => {
    editorPanel = null;
  });
}

/** A new thread in the chosen folder: in the side panel for the workspace folder, else in the full app. */
async function openForFolder(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const chosen = uri ? normalizeFolder(uri.fsPath) : workspaceFolder();
  if (!chosen || chosen === workspaceFolder()) {
    await newThreadInPanel();
    return;
  }
  await addProject(chosen);
  await openEditor(context, `#/new/${encodeURIComponent(chosen)}`);
}

async function openInBrowser(): Promise<void> {
  try {
    await vscode.env.openExternal(vscode.Uri.parse(await externalUrl()));
  } catch (error) {
    void vscode.window.showErrorMessage(`Muse Code GUI could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function restart(): Promise<void> {
  editorPanel?.dispose();
  server?.stop();
  await sideView?.load();
}

/** Editor theme colors forwarded into the frame so Muse Code GUI matches the editor around it. */
const HOST_VARS = [
  "font-family",
  "font-size",
  "sideBar-background",
  "editor-background",
  "sideBar-foreground",
  "foreground",
  "descriptionForeground",
  "disabledForeground",
  "input-background",
  "input-border",
  "editorWidget-background",
  "editorHoverWidget-background",
  "menu-background",
  "dropdown-background",
  "quickInput-background",
  "list-hoverBackground",
  "toolbar-hoverBackground",
  "list-inactiveSelectionBackground",
  "widget-border",
  "panel-border",
  "sideBarSectionHeader-border",
  "editorGroup-border",
  "contrastBorder",
  "button-background",
  "button-hoverBackground",
  "button-foreground",
  "focusBorder",
  "textLink-foreground",
  "scrollbarSlider-background",
];

/**
 * A full-bleed frame around the server's own page, which keeps its origin, storage and cookies.
 * The script passes the editor's theme (its CSS variables) into the frame, forwards navigation
 * from the extension, and relays the few commands the page can't run itself, like opening a folder.
 */
function frameHtml(origin: string, src: string, surface: "sideBar" | "editor", border: "left" | "right" | "none" = "none"): string {
  const nonce = randomBytes(16).toString("base64");
  const frameOrigin = new URL(origin).origin;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${frameOrigin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; box-sizing: border-box; background: var(--vscode-${surface}-background, var(--vscode-editor-background)); }
  body { display: flex; }
  ${border === "none" ? "" : `body { border-${border}: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border, var(--vscode-editorGroup-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.25))))); }`}
  iframe { display: block; flex: 1; min-width: 0; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe id="app" src="${src}" title="Muse Code GUI" allow="clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById("app");
  const origin = ${JSON.stringify(frameOrigin)};
  const names = ${JSON.stringify(HOST_VARS)};
  const surface = ${JSON.stringify(surface)};
  function hostStyle() {
    const css = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of names) {
      const value = css.getPropertyValue("--vscode-" + name).trim();
      if (value) vars[name] = value;
    }
    vars.surface = vars[surface + "-background"] || vars["editor-background"] || "";
    const cls = document.body.classList;
    const kind = cls.contains("vscode-light") || cls.contains("vscode-high-contrast-light") ? "light" : "dark";
    return { type: "musegui-host-style", kind, vars };
  }
  function sendStyle() {
    if (frame.contentWindow) frame.contentWindow.postMessage(hostStyle(), origin);
  }
  frame.addEventListener("load", sendStyle);
  // VS Code rewrites these variables in place when the theme changes.
  const watch = new MutationObserver(sendStyle);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (event.source === frame.contentWindow) {
      // Only the Muse Code GUI page itself may run commands, not whatever the frame was navigated to.
      if (event.origin !== origin) return;
      if (data.type === "musegui-host-ready") sendStyle();
      if (data.type === "musegui-command" && typeof data.command === "string") vscode.postMessage({ type: "command", command: data.command, args: data.args });
      return;
    }
    if (data.type === "musegui-theme") sendStyle();
    if (data.type === "musegui-paste" && frame.contentWindow) frame.contentWindow.postMessage(data, origin);
    if (data.type === "navigate-hash") {
      const url = new URL(frame.src);
      url.hash = data.hash;
      frame.src = url.toString();
    }
  });
</script>
</body>
</html>`;
}

/** Commands the framed page may ask for; anything else is ignored. */
function onFrameMessage(message: unknown, webview?: vscode.Webview): void {
  const data = message as { type?: unknown; command?: unknown; args?: unknown } | null;
  if (data?.type !== "command") {
    return;
  }
  const args = (data.args ?? {}) as { text?: unknown; id?: unknown };
  if (data.command === "copy" && typeof args.text === "string") {
    void vscode.env.clipboard.writeText(args.text);
  } else if (data.command === "paste" && typeof args.id === "number" && webview) {
    const id = args.id;
    void vscode.env.clipboard.readText().then((text) => webview.postMessage({ type: "musegui-paste", id, text }));
  } else if (data.command === "openFolder") {
    void vscode.commands.executeCommand("vscode.openFolder");
  } else if (data.command === "openFile") {
    void openFileInEditor(data.args);
  }
}

/** Opens a file a reply named in an editor tab, at its line when the reply gave one. */
async function openFileInEditor(args: unknown): Promise<void> {
  const { cwd, path, line } = (args ?? {}) as { cwd?: unknown; path?: unknown; line?: { start?: unknown; end?: unknown } | null };
  if (typeof cwd !== "string" || typeof path !== "string" || !path) {
    return;
  }
  // SSH projects live on another machine; the editor can't open their files by path.
  if (cwd.startsWith("ssh://")) {
    void vscode.window.showInformationMessage("Files in SSH projects can't be opened in the editor yet.");
    return;
  }
  const absolute = isAbsolute(path) ? path : join(cwd, path);
  const uri = vscode.Uri.file(absolute);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`Muse Code GUI: ${path} was not found in ${cwd}.`);
    return;
  }
  const start = typeof line?.start === "number" && line.start > 0 ? line.start - 1 : null;
  const end = typeof line?.end === "number" && line.end > 0 ? line.end - 1 : start;
  const options: vscode.TextDocumentShowOptions = { preview: false, viewColumn: vscode.ViewColumn.Active };
  if (start !== null) {
    options.selection = new vscode.Range(start, 0, end ?? start, 0);
  }
  await vscode.commands.executeCommand("vscode.open", uri, options);
}

/** A plain message in the editor's own font and colors, for starting up and for errors. */
function messageHtml(text: string): string {
  const safe = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return `<!DOCTYPE html><html><body style="margin:0;padding:16px;font:12px/1.5 var(--vscode-font-family);color:var(--vscode-descriptionForeground)">${safe}</body></html>`;
}
