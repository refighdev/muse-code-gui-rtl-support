import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { desktopUpdater } from "../src/updater.js";
import { captureConsoleError, stubGlobal, tauriWindow, tick } from "./stubs.js";

const update = (rid: number, extra: Record<string, unknown> = {}) => ({
  rid,
  currentVersion: "0.22.3",
  version: "0.23.0",
  date: "2026-10-19T10:00:00Z",
  body: "Faster start.",
  rawJson: {},
  ...extra,
});

describe("desktop updater", () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    restore = () => {};
  });

  it("does not exist in a browser", () => {
    restore = stubGlobal("window", {});
    assert.equal(desktopUpdater(), undefined);
  });

  it("reads the app version through the Tauri app plugin", async () => {
    const tauri = tauriWindow(() => "0.22.3");
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    assert.equal(await updater.currentVersion(), "0.22.3");
    assert.deepEqual(
      tauri.calls.map((call) => call.cmd),
      ["plugin:app|version"],
    );
  });

  it("reports a found update, with trimmed notes and the check timeout", async () => {
    const tauri = tauriWindow((cmd) => (cmd === "plugin:updater|check" ? update(7, { body: "  Faster start.\n" }) : null));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    assert.deepEqual(await updater.check(), { version: "0.23.0", notes: "Faster start.", date: "2026-10-19T10:00:00Z" });
    assert.deepEqual(tauri.calls[0]?.args, { timeout: 30_000 });
  });

  it("turns empty notes and a missing date into null", async () => {
    const tauri = tauriWindow((cmd) => (cmd === "plugin:updater|check" ? update(7, { body: "   ", date: undefined }) : null));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    assert.deepEqual(await updater.check(), { version: "0.23.0", notes: null, date: null });
  });

  it("reports no update as null", async () => {
    const tauri = tauriWindow(() => null);
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    assert.equal(await updater.check(), null);
  });

  it("closes the update that a newer check replaces", async () => {
    let rid = 6;
    const tauri = tauriWindow((cmd) => (cmd === "plugin:updater|check" ? update((rid += 1)) : undefined));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    await updater.check();
    const closed = tauri.calls.filter((call) => call.cmd === "plugin:resources|close").map((call) => call.args.rid);
    assert.deepEqual(closed, [7]);
  });

  it("closes a pending update when a later check finds nothing", async () => {
    let answer: unknown = update(7);
    const tauri = tauriWindow((cmd) => (cmd === "plugin:updater|check" ? answer : undefined));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    answer = null;
    assert.equal(await updater.check(), null);
    assert.deepEqual(
      tauri.calls.filter((call) => call.cmd === "plugin:resources|close").map((call) => call.args.rid),
      [7],
    );
    await assert.rejects(() => updater.download(() => {}), { message: "There is no update to download." });
  });

  it("refuses to download before a check has found an update", async () => {
    const tauri = tauriWindow(() => null);
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await assert.rejects(() => updater.download(() => {}), { message: "There is no update to download." });
    assert.equal(tauri.calls.some((call) => call.cmd === "plugin:updater|download"), false);
  });

  it("reports download progress as a fraction of the advertised size, clamped to 1", async () => {
    const tauri = tauriWindow((cmd, args) => {
      if (cmd === "plugin:updater|check") return update(7);
      if (cmd === "plugin:updater|download") {
        const id = args.onEvent.id as number;
        tauri.fire(id, { index: 0, message: { event: "Started", data: { contentLength: 100 } } });
        tauri.fire(id, { index: 1, message: { event: "Progress", data: { chunkLength: 25 } } });
        tauri.fire(id, { index: 2, message: { event: "Progress", data: { chunkLength: 75 } } });
        tauri.fire(id, { index: 3, message: { event: "Finished" } });
        return 9;
      }
      return undefined;
    });
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    const progress: (number | null)[] = [];
    await updater.download((value) => progress.push(value));
    assert.deepEqual(progress, [0, 0.25, 1, 1]);
    const download = tauri.calls.find((call) => call.cmd === "plugin:updater|download");
    assert.equal(download?.args.rid, 7);
    assert.equal(download?.args.timeout, 15 * 60_000);
  });

  it("reports progress as unknown when the server gives no size, and clamps overshoot", async () => {
    const tauri = tauriWindow((cmd, args) => {
      if (cmd === "plugin:updater|check") return update(7);
      if (cmd === "plugin:updater|download") {
        const id = args.onEvent.id as number;
        tauri.fire(id, { index: 0, message: { event: "Started", data: {} } });
        tauri.fire(id, { index: 1, message: { event: "Progress", data: { chunkLength: 40 } } });
        tauri.fire(id, { index: 2, message: { event: "Finished" } });
        return 9;
      }
      return undefined;
    });
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    const progress: (number | null)[] = [];
    await updater.download((value) => progress.push(value));
    assert.deepEqual(progress, [null, null, 1]);

    const overshoot = tauriWindow((cmd, args) => {
      if (cmd === "plugin:updater|check") return update(8);
      if (cmd === "plugin:updater|download") {
        const id = args.onEvent.id as number;
        overshoot.fire(id, { index: 0, message: { event: "Started", data: { contentLength: 10 } } });
        overshoot.fire(id, { index: 1, message: { event: "Progress", data: { chunkLength: 40 } } });
        return 9;
      }
      return undefined;
    });
    restore();
    restore = stubGlobal("window", overshoot.window);
    const second = desktopUpdater();
    assert.ok(second);
    await second.check();
    const seen: (number | null)[] = [];
    await second.download((value) => seen.push(value));
    assert.deepEqual(seen, [0, 1]);
  });

  it("refuses to install when nothing has been downloaded", async () => {
    const empty = tauriWindow(() => null);
    restore = stubGlobal("window", empty.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await assert.rejects(() => updater.install({ restart: false }), { message: "There is no downloaded update to install." });
  });

  it("refuses to install a check that was never downloaded", async () => {
    const tauri = tauriWindow((cmd) => (cmd === "plugin:updater|check" ? update(7) : undefined));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    await assert.rejects(() => updater.install({ restart: false }), { message: "Update.install called before Update.download" });
  });

  it("installs the downloaded bytes, restarting only when asked", async () => {
    const tauri = tauriWindow((cmd) => {
      if (cmd === "plugin:updater|check") return update(7);
      if (cmd === "plugin:updater|download") return 9;
      return undefined;
    });
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.check();
    await updater.download(() => {});
    await updater.install({ restart: true });
    const install = tauri.calls.find((call) => call.cmd === "plugin:updater|install");
    assert.deepEqual(install?.args, { updateRid: 7, bytesRid: 9, restartAfterInstall: true });
  });

  it("relaunches through the process plugin", async () => {
    const tauri = tauriWindow(() => undefined);
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    await updater.relaunch();
    assert.deepEqual(
      tauri.calls.map((call) => call.cmd),
      ["plugin:process|restart"],
    );
  });

  it("logs a close listener that fails to start instead of leaving it unhandled", async () => {
    const tauri = tauriWindow((cmd) => {
      if (cmd === "plugin:event|listen") throw new Error("no event plugin");
      return undefined;
    });
    restore = stubGlobal("window", tauri.window);
    const logs = captureConsoleError();
    try {
      const updater = desktopUpdater();
      assert.ok(updater);
      updater.onClose(async () => {});
      await tick();
      await tick();
      assert.equal(logs.messages[0]?.[0], "Muse Code GUI: close listener failed");
    } finally {
      logs.restore();
    }
  });

  it("runs the close handler before the window is destroyed, and stops listening on cleanup", async () => {
    const order: string[] = [];
    const tauri = tauriWindow((cmd) => (cmd === "plugin:event|listen" ? 5 : undefined));
    restore = stubGlobal("window", tauri.window);
    const updater = desktopUpdater();
    assert.ok(updater);
    const stop = updater.onClose(async () => {
      await tick();
      order.push("handler");
    });
    await tick();
    const listen = tauri.calls.find((call) => call.cmd === "plugin:event|listen");
    assert.equal(listen?.args.event, "tauri://close-requested");
    tauri.fire(listen?.args.handler, { event: "tauri://close-requested", id: 1, payload: null });
    await tick();
    await tick();
    tauri.calls.forEach((call) => {
      if (call.cmd === "plugin:window|destroy") order.push("destroy");
    });
    assert.deepEqual(order, ["handler", "destroy"]);

    stop();
    await tick();
    const unlisten = tauri.calls.find((call) => call.cmd === "plugin:event|unlisten");
    assert.deepEqual(unlisten?.args, { event: "tauri://close-requested", eventId: 5 });
  });
});
