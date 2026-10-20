import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImeTracker, type ImeKeyEvent } from "../src/app/ime.js";

function key(name: string, overrides: { keyCode?: number; shiftKey?: boolean; isComposing?: boolean } = {}): ImeKeyEvent {
  return {
    key: name,
    keyCode: overrides.keyCode ?? (name === "Enter" ? 13 : 0),
    shiftKey: overrides.shiftKey ?? false,
    nativeEvent: { isComposing: overrides.isComposing ?? false },
  };
}

describe("ImeTracker", () => {
  it("Enter during composition does not submit", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    assert.equal(ime.isImeKey(key("Enter", { isComposing: true })), true);
    assert.equal(ime.isImeKey(key("Enter", { keyCode: 229 })), true);
  });

  it("Enter right after compositionend (WebKit order) does not submit", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    // WebKit: isComposing is already false here, so only the tracker knows this Enter confirmed the IME.
    assert.equal(ime.isImeKey(key("Enter", { isComposing: false })), true);
  });

  it("the confirming Enter's keyup closes the window, so the next Enter sends", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    assert.equal(ime.isImeKey(key("Enter")), true);
    ime.keyUp("Enter");
    now += 300;
    assert.equal(ime.isImeKey(key("Enter")), false);
  });

  it("the window closes after about 100 ms when no keyup arrives", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    now += 100;
    assert.equal(ime.isImeKey(key("Enter")), true);
    now += 1;
    assert.equal(ime.isImeKey(key("Enter")), false);
  });

  it("keyCode 229 does not submit, with or without a tracked composition", () => {
    const ime = new ImeTracker(() => 0);
    assert.equal(ime.isImeKey(key("Enter", { keyCode: 229 })), true);
    assert.equal(ime.isImeKey(key("Process", { keyCode: 229 })), true);
  });

  it("plain Enter with no composition still submits", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    assert.equal(ime.isImeKey(key("Enter")), false);
    // A composition that finished long ago must not hold Enter back either.
    ime.compositionStart();
    ime.compositionEnd();
    ime.keyUp("Enter");
    now += 5_000;
    assert.equal(ime.isImeKey(key("Enter")), false);
  });

  it("Shift+Enter acts as usual with no composition, and is held while one confirms", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    assert.equal(ime.isImeKey(key("Enter", { shiftKey: true })), false);
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    assert.equal(ime.isImeKey(key("Enter", { shiftKey: true })), true, "ATOK confirms with Shift+Enter");
    ime.compositionStart();
    assert.equal(ime.isImeKey(key("Enter", { shiftKey: true, isComposing: true })), true);
  });

  it("other keys right after a commit are not treated as IME keys", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    assert.equal(ime.isImeKey(key("ArrowDown", { keyCode: 40 })), false);
    assert.equal(ime.isImeKey(key("a", { keyCode: 65 })), false);
  });

  it("a new composition resets a stale confirm window", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    assert.equal(ime.isImeKey(key("Enter")), true);
    ime.keyUp("Enter");
    assert.equal(ime.isImeKey(key("Enter")), false);
  });

  it("a composition that never ended does not block Enter later", () => {
    const ime = new ImeTracker(() => 1000);
    // The input unmounted or lost focus mid-composition, so compositionend never came.
    ime.compositionStart();
    assert.equal(ime.isImeKey(key("Enter")), false);
  });

  it("a non-Enter key closes the confirm window, so a quick real Enter still sends", () => {
    let now = 1000;
    const ime = new ImeTracker(() => now);
    ime.compositionStart();
    ime.compositionEnd();
    now += 5;
    // Korean and some Japanese IMEs commit on Space or a click, then the user presses Enter at once.
    assert.equal(ime.isImeKey(key(" ", { keyCode: 32 })), false);
    now += 20;
    assert.equal(ime.isImeKey(key("Enter")), false);
  });
});
