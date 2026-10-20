import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationManager, type NotifyPermission, type Notifier } from "../src/model/notify.js";

interface Shown {
  title: string;
  body: string;
  tag: string;
}

function notifier(permission: NotifyPermission = "granted") {
  const shown: Shown[] = [];
  let asked = 0;
  const fake: Notifier = {
    permission: async () => permission,
    request: async () => {
      asked += 1;
      return permission;
    },
    show: async (note) => {
      shown.push(note);
    },
  };
  return { fake, shown, asked: () => asked };
}

/** A clock the test moves by hand, so the repeat window can be crossed without waiting for it. */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, pass: (ms: number) => (at += ms) };
}

describe("notifications", () => {
  it("says nothing to someone already looking at the window", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: true }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(shown, []);
  });

  it("says nothing when the switch is off", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: false, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(shown, []);
  });

  it("never raises one without permission, and never asks on its own", async () => {
    const asking = notifier("default");
    const manager = new NotificationManager(asking.fake, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(asking.shown, []);
    // Asking belongs to a button the user pressed; a browser refuses it anywhere else anyway.
    assert.equal(asking.asked(), 0);
  });

  it("tells the user what happened, per kind", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    await manager.announce({ kind: "finished", sessionId: "s2", thread: "winmux", failed: false });
    await manager.announce({ kind: "finished", sessionId: "s3", thread: "winmux", failed: true });

    assert.match(shown[0]?.title ?? "", /waiting on you/);
    assert.match(shown[0]?.body ?? "", /notes-app/);
    assert.match(shown[1]?.title ?? "", /finished/);
    assert.match(shown[2]?.title ?? "", /failed/);
  });

  it("says the same thing about one thread once, until enough time has passed", async () => {
    const { fake, shown } = notifier();
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }), time.now);

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    assert.equal(shown.length, 1, "a thread flapping should not buzz twice");

    // A different thread has its own say.
    await manager.announce({ kind: "approval", sessionId: "s2", thread: "winmux" });
    assert.equal(shown.length, 2);

    time.pass(20_001);
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    assert.equal(shown.length, 3, "and it may speak again later");
  });

  it("lets a thread speak again once its request has been dealt with", async () => {
    const { fake, shown } = notifier();
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }), time.now);

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    manager.forget("s1");
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.equal(shown.length, 2);
  });
});
