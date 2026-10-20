import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultPrefs, revivePrefs } from "../src/model/store.js";

describe("editor extension card", () => {
  it("shows until it is closed, for fresh and revived prefs alike", () => {
    assert.equal(defaultPrefs().editorTipDismissed, false);
    assert.equal(revivePrefs({}, defaultPrefs()).editorTipDismissed, false);
    assert.equal(revivePrefs({ editorTipDismissed: true }, defaultPrefs()).editorTipDismissed, true);
  });

  it("falls back to showing when the saved value is not a boolean", () => {
    assert.equal(revivePrefs({ editorTipDismissed: "yes" }, defaultPrefs()).editorTipDismissed, false);
    assert.equal(revivePrefs({ editorTipDismissed: 1 }, defaultPrefs()).editorTipDismissed, false);
  });
});
