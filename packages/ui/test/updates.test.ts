import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UpdateManager, type AppUpdater, type AvailableUpdate, type UpdateSettings } from "../src/model/updates.js";

class FakeUpdater implements AppUpdater {
  found: AvailableUpdate | null = { version: "0.4.0", notes: null, date: null };
  failCheck = false;
  checks = 0;
  downloads = 0;
  installs: boolean[] = [];
  relaunches = 0;
  closeHandler: (() => Promise<void>) | null = null;

  async currentVersion() {
    return "0.3.0";
  }
  async check() {
    this.checks += 1;
    if (this.failCheck) {
      throw "Could not fetch a valid release JSON from the remote";
    }
    return this.found;
  }
  async download(onProgress: (fraction: number | null) => void) {
    this.downloads += 1;
    onProgress(0.5);
    onProgress(1);
  }
  async install(options: { restart: boolean }) {
    this.installs.push(options.restart);
  }
  async relaunch() {
    this.relaunches += 1;
  }
  onClose(handler: () => Promise<void>) {
    this.closeHandler = handler;
    return () => {
      this.closeHandler = null;
    };
  }
}

function setup(settings: UpdateSettings, fake = new FakeUpdater()) {
  const manager = new UpdateManager(fake, () => settings, () => undefined, () => 1000);
  manager.start(false);
  return { manager, fake };
}

describe("app updates", () => {
  it("downloads a new version when automatic, and installs it without reopening as the app closes", async () => {
    const { manager, fake } = setup({ autoUpdate: true, paused: false });
    await manager.check();
    assert.equal(manager.current.status, "ready");
    assert.equal(manager.current.progress, 1);
    assert.equal(fake.downloads, 1);
    await fake.closeHandler?.();
    assert.deepEqual(fake.installs, [false]);
    assert.equal(manager.current.currentVersion, "0.3.0");
  });

  it("only offers the update when automatic updates are off, and restarts into it on request", async () => {
    const { manager, fake } = setup({ autoUpdate: false, paused: false });
    await manager.check();
    assert.equal(manager.current.status, "available");
    assert.equal(fake.downloads, 0);
    await fake.closeHandler?.();
    assert.deepEqual(fake.installs, [], "closing never installs what the user did not download");
    await manager.download();
    await manager.restart();
    assert.deepEqual(fake.installs, [true]);
    assert.equal(fake.relaunches, 1);
  });

  it("skips scheduled checks while paused, still checks on request, and never installs on close", async () => {
    const { manager, fake } = setup({ autoUpdate: true, paused: true });
    await manager.check();
    assert.equal(fake.checks, 0);
    await manager.check(true);
    assert.equal(fake.checks, 1);
    assert.equal(manager.current.status, "available", "found but not downloaded while paused");
    await fake.closeHandler?.();
    assert.deepEqual(fake.installs, []);
  });

  it("treats a missing-platform feed as up to date instead of an error", async () => {
    const fake = new FakeUpdater();
    fake.check = async () => {
      fake.checks += 1;
      throw new Error(
        'None of the fallback platforms `["darwin-aarch64-app", "darwin-aarch64"]` were found in the response `platforms` object',
      );
    };
    const { manager } = setup({ autoUpdate: true, paused: false }, fake);
    await manager.check();
    assert.equal(manager.current.status, "upToDate");
    assert.equal(manager.current.error, null);
    assert.equal(manager.current.checkedAt, 1000);
  });

  it("reports a failed check, then says when it is up to date", async () => {
    const fake = new FakeUpdater();
    fake.failCheck = true;
    const { manager } = setup({ autoUpdate: true, paused: false }, fake);
    await manager.check();
    assert.equal(manager.current.status, "error");
    assert.match(manager.current.error ?? "", /release JSON/);
    fake.failCheck = false;
    fake.found = null;
    await manager.check();
    assert.equal(manager.current.status, "upToDate");
    assert.equal(manager.current.checkedAt, 1000);
  });
});
