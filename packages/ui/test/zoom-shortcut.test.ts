import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zoomStepFromKey } from "../src/model/zoom-shortcut.js";

function key(partial: Partial<Parameters<typeof zoomStepFromKey>[0]>): Parameters<typeof zoomStepFromKey>[0] {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    ...partial,
  };
}

describe("zoom shortcut", () => {
  it("zooms in on Cmd+=, Cmd++, and numpad plus", () => {
    assert.equal(zoomStepFromKey(key({ metaKey: true, key: "=", code: "Equal" }), true), "in");
    assert.equal(zoomStepFromKey(key({ metaKey: true, shiftKey: true, key: "+", code: "Equal" }), true), "in");
    assert.equal(zoomStepFromKey(key({ ctrlKey: true, key: "+", code: "NumpadAdd" }), false), "in");
  });

  it("zooms out on Cmd+- and resets on Cmd+0", () => {
    assert.equal(zoomStepFromKey(key({ metaKey: true, key: "-", code: "Minus" }), true), "out");
    assert.equal(zoomStepFromKey(key({ ctrlKey: true, key: "0", code: "Digit0" }), false), "reset");
    assert.equal(zoomStepFromKey(key({ metaKey: true, shiftKey: true, key: ")", code: "Digit0" }), true), null);
  });

  it("ignores the shortcut without the platform modifier", () => {
    assert.equal(zoomStepFromKey(key({ key: "=", code: "Equal" }), true), null);
    assert.equal(zoomStepFromKey(key({ metaKey: true, key: "=", code: "Equal" }), false), null);
  });
});
