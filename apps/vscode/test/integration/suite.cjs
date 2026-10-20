// Runs inside the VS Code extension host. Plain assertions: no test framework to bundle.
const assert = require("node:assert/strict");
const { realpathSync } = require("node:fs");
const vscode = require("vscode");

async function waitFor(check, what) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

exports.run = async function run() {
  const ext = vscode.extensions.getExtension("refighdev.musegui");
  assert.ok(ext, "extension is installed");
  const api = await ext.activate();
  console.log(`extension host: node ${process.versions.node}, electron ${process.versions.electron}`);

  // The side panel: focusing it starts the server and points the frame at the compact layout.
  await vscode.commands.executeCommand("musegui.open");
  const src = await waitFor(() => api.panelLoaded(), "the side panel to load");
  const url = await api.serverUrl();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const params = new URL(src).searchParams;
  assert.equal(params.get("view"), "panel");
  assert.equal(params.get("host"), "editor");
  assert.match(params.get("theme"), /^(light|dark)$/);
  const folder = process.env.MUSEGUI_TEST_WORKSPACE;
  assert.equal(realpathSync(params.get("cwd")), realpathSync(folder));
  console.log(`panel: ${src}`);

  const page = await fetch(src);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);

  // Opening the panel adds the workspace folder as a project.
  const body = await (await fetch(`${url}/api/projects`)).json();
  assert.ok(body.projects.some((p) => realpathSync(p.cwd) === realpathSync(folder)), "workspace folder is a project");

  const env = await (await fetch(`${url}/api/env`)).json();
  console.log(`museFound=${env.museFound}`);

  // A file a reply names opens in an editor tab, at its line.
  api.frameMessage({ type: "command", command: "openFile", args: { cwd: folder, path: "README.md", line: { start: 1, end: 1 } } });
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith("README.md"), "README.md to open in the editor");
  console.log("file link opens in editor");

  // Copy goes through the editor's clipboard, since framed pages can't reach the browser's.
  api.frameMessage({ type: "command", command: "copy", args: { text: "copied from musegui" } });
  await waitFor(async () => (await vscode.env.clipboard.readText()) === "copied from musegui", "the editor clipboard");
  console.log("copy ok");

  // The full app still opens in an editor tab.
  await vscode.commands.executeCommand("musegui.openInEditor");
  await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === "Muse Code GUI"), "the editor tab");

  // Restart brings up a fresh server and reloads the panel.
  await vscode.commands.executeCommand("musegui.restart");
  const again = await api.serverUrl();
  assert.equal((await fetch(`${again}/api/env`)).status, 200);
  await waitFor(() => api.panelLoaded()?.startsWith(again), "the panel to reload on the new server");
  console.log("restart ok");
};
