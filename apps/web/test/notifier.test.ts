import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appNotifier } from "../src/notifier.js";
import { stubGlobal, tauriWindow } from "./stubs.js";

interface Shown {
  title: string;
  options: Record<string, unknown>;
}

/**
 * A stand-in for the Notification API. `permission` is what the browser reports, and each call to
 * requestPermission takes the next value from `answers`, or throws if the entry is an Error.
 */
function fakeNotification(permission: string, answers: (string | Error)[] = []) {
  const shown: Shown[] = [];
  const asked = { count: 0 };
  class FakeNotification {
    static get permission() {
      return permission;
    }
    static requestPermission() {
      asked.count += 1;
      const next = answers.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    }
    constructor(title: string, options: Record<string, unknown>) {
      shown.push({ title, options });
    }
  }
  return { FakeNotification, shown, asked };
}

describe("browser notifier", () => {
  const restores: (() => void)[] = [];
  const stub = (name: string, value: unknown) => restores.push(stubGlobal(name, value));
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("does not exist where the Notification API is missing", () => {
    stub("window", {});
    stub("Notification", undefined);
    assert.equal(appNotifier(), undefined);
  });

  it("reports the permission the browser already holds", async () => {
    for (const permission of ["granted", "denied", "default"]) {
      stub("window", {});
      stub("Notification", fakeNotification(permission).FakeNotification);
      const notifier = appNotifier();
      assert.ok(notifier);
      assert.equal(await notifier.permission(), permission);
      restores.pop()?.();
      restores.pop()?.();
    }
  });

  it("does not ask again once the browser has already answered", async () => {
    const fake = fakeNotification("denied", ["granted"]);
    stub("window", {});
    stub("Notification", fake.FakeNotification);
    const notifier = appNotifier();
    assert.ok(notifier);
    assert.equal(await notifier.request(), "denied");
    assert.equal(fake.asked.count, 0);
  });

  it("asks once while the permission is open, and returns the answer", async () => {
    const fake = fakeNotification("default", ["granted"]);
    stub("window", {});
    stub("Notification", fake.FakeNotification);
    const notifier = appNotifier();
    assert.ok(notifier);
    assert.equal(await notifier.request(), "granted");
    assert.equal(fake.asked.count, 1);
  });

  it("maps an unrecognised answer to default and a thrown ask to denied", async () => {
    stub("window", {});
    stub("Notification", fakeNotification("default", ["prompt"]).FakeNotification);
    const unrecognised = appNotifier();
    assert.ok(unrecognised);
    assert.equal(await unrecognised.request(), "default");
    restores.pop()?.();

    stub("Notification", fakeNotification("default", [new Error("not from a press")]).FakeNotification);
    const thrown = appNotifier();
    assert.ok(thrown);
    assert.equal(await thrown.request(), "denied");
  });

  it("shows a notice with the thread tag, so a newer one can replace it", async () => {
    const fake = fakeNotification("granted");
    stub("window", {});
    stub("Notification", fake.FakeNotification);
    const notifier = appNotifier();
    assert.ok(notifier);
    await notifier.show({ title: "Done", body: "Reply ready", tag: "thread-1" });
    assert.deepEqual(fake.shown, [{ title: "Done", options: { body: "Reply ready", tag: "thread-1" } }]);
  });
});

describe("desktop notifier", () => {
  const restores: (() => void)[] = [];
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("is chosen when the Tauri shell is present, and reports denied without the webview API", async () => {
    const tauri = tauriWindow(() => true);
    restores.push(stubGlobal("window", tauri.window));
    const notifier = appNotifier();
    assert.ok(notifier);
    assert.equal(await notifier.permission(), "denied");
    assert.equal(tauri.calls.length, 0);
  });

  it("reports granted from the webview's own permission without asking the shell", async () => {
    const tauri = tauriWindow(() => false);
    tauri.window.Notification = fakeNotification("granted").FakeNotification;
    restores.push(stubGlobal("window", tauri.window));
    const notifier = appNotifier();
    assert.ok(notifier);
    assert.equal(await notifier.permission(), "granted");
    assert.equal(tauri.calls.length, 0);
  });

  it("asks the shell when the webview has no answer yet", async () => {
    const granted = tauriWindow((cmd) => (cmd === "plugin:notification|is_permission_granted" ? true : undefined));
    granted.window.Notification = fakeNotification("default").FakeNotification;
    restores.push(stubGlobal("window", granted.window));
    assert.equal(await appNotifier()?.permission(), "granted");
    assert.equal(granted.calls[0]?.cmd, "plugin:notification|is_permission_granted");
    restores.pop()?.();

    const refused = tauriWindow(() => false);
    refused.window.Notification = fakeNotification("default").FakeNotification;
    restores.push(stubGlobal("window", refused.window));
    assert.equal(await appNotifier()?.permission(), "default");
  });

  it("reports denied when the shell's permission check fails", async () => {
    const tauri = tauriWindow(() => {
      throw new Error("plugin missing");
    });
    tauri.window.Notification = fakeNotification("default").FakeNotification;
    restores.push(stubGlobal("window", tauri.window));
    assert.equal(await appNotifier()?.permission(), "denied");
  });

  it("maps the webview's answer to the ask, and a refused ask to denied", async () => {
    const tauri = tauriWindow(() => undefined);
    tauri.window.Notification = fakeNotification("default", ["granted", "denied", "prompt"]).FakeNotification;
    restores.push(stubGlobal("window", tauri.window));
    const notifier = appNotifier();
    assert.ok(notifier);
    assert.equal(await notifier.request(), "granted");
    assert.equal(await notifier.request(), "denied");
    assert.equal(await notifier.request(), "default");

    const refused = tauriWindow(() => undefined);
    refused.window.Notification = fakeNotification("default", [new Error("no prompt")]).FakeNotification;
    restores.pop()?.();
    restores.push(stubGlobal("window", refused.window));
    assert.equal(await appNotifier()?.request(), "denied");
  });

  it("sends the notice through the webview's Notification, without the replacement tag", async () => {
    const tauri = tauriWindow(() => undefined);
    const fake = fakeNotification("granted");
    tauri.window.Notification = fake.FakeNotification;
    restores.push(stubGlobal("window", tauri.window));
    const notifier = appNotifier();
    assert.ok(notifier);
    await notifier.show({ title: "Done", body: "Reply ready", tag: "thread-1" });
    assert.deepEqual(fake.shown, [{ title: "Done", options: { title: "Done", body: "Reply ready" } }]);
  });
});
