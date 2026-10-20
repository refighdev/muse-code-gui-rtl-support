import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSteer } from "../src/components/composer/keys.js";

describe("resolveSteer", () => {
  it("queues by default: plain Enter does not steer while running", () => {
    assert.equal(resolveSteer(true, false, false), false);
  });

  it("steers with the modifier while running", () => {
    assert.equal(resolveSteer(true, true, false), true);
  });

  it("flips with steer-by-default: plain Enter steers while running", () => {
    assert.equal(resolveSteer(true, false, true), true);
  });

  it("flips with steer-by-default: modifier queues instead", () => {
    assert.equal(resolveSteer(true, true, true), false);
  });

  it("never steers when nothing is running", () => {
    assert.equal(resolveSteer(false, false, false), false);
    assert.equal(resolveSteer(false, true, false), false);
    assert.equal(resolveSteer(false, false, true), false);
    assert.equal(resolveSteer(false, true, true), false);
  });
});

describe("steerByDefault pref", () => {
  it("defaults to off and survives a prefs round-trip", async () => {
    const { defaultPrefs, revivePrefs } = await import("../src/model/store.js");
    assert.equal(defaultPrefs().steerByDefault, false);
    assert.equal(revivePrefs({}, defaultPrefs()).steerByDefault, false);
    assert.equal(revivePrefs({ steerByDefault: true }, defaultPrefs()).steerByDefault, true);
    assert.equal(revivePrefs({ steerByDefault: "yes" }, defaultPrefs()).steerByDefault, false);
  });
});
