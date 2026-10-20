// Test-only stand-in for the `vscode` module. src/extension.ts is bundled once with esbuild (vscode
// left external) into a temp folder whose node_modules/vscode re-exports globalThis.__museguiVscodeFake.
// Each test hands the bundle a fresh fake and reads back what the extension did.
import esbuild from "esbuild";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "extension.ts");

export const ViewColumn = { Active: -1, Beside: -2, One: 1 };
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };

export class Uri {
  constructor(fsPath, raw) {
    this.fsPath = fsPath;
    this.raw = raw;
  }
  static file(path) {
    return new Uri(path, `file://${path}`);
  }
  static parse(value) {
    return new Uri(new URL(value).pathname, value);
  }
  static joinPath(base, ...parts) {
    return Uri.file(join(base.fsPath, ...parts));
  }
  toString() {
    return this.raw;
  }
}

export class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    Object.assign(this, { startLine, startCharacter, endLine, endCharacter });
  }
}

/** A minimal VS Code event: callable to subscribe, with fire() and count() for the test side. */
function emitter() {
  const listeners = new Set();
  const on = (listener) => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  on.fire = (value) => {
    for (const listener of [...listeners]) listener(value);
  };
  on.count = () => listeners.size;
  return on;
}

const disposable = () => ({ dispose() {} });

export class FakeWebview {
  constructor() {
    this.posted = [];
    this.htmlHistory = [];
    this.options = undefined;
    this.messageListeners = new Set();
    this.currentHtml = "";
  }
  get html() {
    return this.currentHtml;
  }
  set html(value) {
    this.currentHtml = value;
    this.htmlHistory.push(value);
  }
  postMessage(message) {
    this.posted.push(message);
    return Promise.resolve(true);
  }
  onDidReceiveMessage(listener) {
    this.messageListeners.add(listener);
    return disposable();
  }
  /** Delivers a message as if the framed page had sent it. */
  receive(message) {
    for (const listener of this.messageListeners) listener(message);
  }
}

export class FakeView {
  constructor() {
    this.webview = new FakeWebview();
    this.disposed = emitter();
  }
  onDidDispose(listener) {
    return this.disposed(listener);
  }
  close() {
    this.disposed.fire();
  }
}

export class FakePanel {
  constructor() {
    this.webview = new FakeWebview();
    this.disposed = emitter();
    this.revealed = [];
    this.iconPath = undefined;
  }
  reveal(column) {
    this.revealed.push(column);
  }
  onDidDispose(listener) {
    return this.disposed(listener);
  }
  dispose() {
    this.disposed.fire();
  }
}

export function createFakeVscode({ workspaceFolders, config = {}, themeKind = ColorThemeKind.Dark, existingFiles = [] } = {}) {
  const settings = { ...config };
  const files = new Set(existingFiles);
  const registered = new Map();
  const viewProviders = new Map();
  const log = {
    channels: [],
    output: "",
    shown: [],
    messages: [],
    executed: [],
    opened: [],
    clipboardWritten: [],
    clipboardReads: 0,
    panels: [],
    statted: [],
  };
  const events = { theme: emitter(), folders: emitter(), config: emitter() };
  const fake = {
    log,
    registered,
    viewProviders,
    events,
    clipboardText: "",
    nextChoice: undefined,
    Uri,
    Range,
    ViewColumn,
    ColorThemeKind,
    workspace: {
      workspaceFolders,
      onDidChangeWorkspaceFolders: events.folders,
      onDidChangeConfiguration: events.config,
      getConfiguration: (section) => ({
        get: (key, fallback) => (`${section}.${key}` in settings ? settings[`${section}.${key}`] : fallback),
      }),
      fs: {
        stat: async (uri) => {
          // Tests name files with forward slashes; on Windows join() hands back backslashes.
          const path = uri.fsPath.replaceAll("\\", "/");
          log.statted.push(path);
          if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
          return { type: 1 };
        },
      },
    },
    window: {
      activeColorTheme: { kind: themeKind },
      onDidChangeActiveColorTheme: events.theme,
      createOutputChannel(name) {
        log.channels.push(name);
        return {
          appendLine: (line) => {
            log.output += `${line}\n`;
          },
          append: (text) => {
            log.output += text;
          },
          show: () => log.shown.push("output"),
          dispose() {},
        };
      },
      registerWebviewViewProvider(id, provider, options) {
        viewProviders.set(id, { provider, options });
        return { dispose: () => viewProviders.delete(id) };
      },
      createWebviewPanel(viewType, title, column, options) {
        const panel = new FakePanel();
        log.panels.push({ viewType, title, column, options, panel });
        return panel;
      },
      showErrorMessage: async (message, ...items) => {
        log.messages.push({ level: "error", message, items });
        return fake.nextChoice;
      },
      showInformationMessage: async (message) => {
        log.messages.push({ level: "info", message });
      },
      showWarningMessage: async (message) => {
        log.messages.push({ level: "warning", message });
      },
    },
    commands: {
      registerCommand: (id, handler) => {
        registered.set(id, handler);
        return disposable();
      },
      executeCommand: async (id, ...args) => {
        log.executed.push({ id, args });
        const handler = registered.get(id);
        return handler ? handler(...args) : undefined;
      },
    },
    env: {
      asExternalUri: async (uri) => uri,
      openExternal: async (uri) => {
        log.opened.push(uri.toString());
        return true;
      },
      clipboard: {
        writeText: async (text) => {
          log.clipboardWritten.push(text);
        },
        readText: async () => {
          log.clipboardReads += 1;
          return fake.clipboardText;
        },
      },
    },
  };
  return fake;
}

export function createContext(extensionPath) {
  return {
    extensionPath,
    extensionUri: Uri.file(extensionPath),
    globalStorageUri: Uri.file(join(extensionPath, "storage")),
    subscriptions: [],
  };
}

let stub = null;

async function buildStub() {
  // realpath: on macOS tmpdir() is a symlink, and require.cache is keyed by the resolved path.
  const root = await realpath(await mkdtemp(join(tmpdir(), "musegui-vscode-stub-")));
  await mkdir(join(root, "node_modules", "vscode"), { recursive: true });
  await writeFile(join(root, "node_modules", "vscode", "package.json"), JSON.stringify({ name: "vscode", main: "index.js" }));
  await writeFile(join(root, "node_modules", "vscode", "index.js"), "module.exports = globalThis.__museguiVscodeFake;\n");
  const bundlePath = join(root, "extension.cjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    outfile: bundlePath,
    logLevel: "silent",
  });
  return { root, bundlePath };
}

/** Bundles src/extension.ts once and loads a fresh copy of it bound to the given fake. */
export async function loadExtension(fake) {
  stub ??= await buildStub();
  globalThis.__museguiVscodeFake = fake;
  const require = createRequire(stub.bundlePath);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(stub.root)) delete require.cache[key];
  }
  return require(stub.bundlePath);
}

export async function removeStub() {
  if (stub) await rm(stub.root, { recursive: true, force: true });
  stub = null;
}
