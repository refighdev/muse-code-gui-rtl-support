import { test } from "node:test";
import assert from "node:assert/strict";
import { inFolder } from "../src/app/panel.js";

test("inFolder keeps the folder and what is inside it", () => {
  assert.equal(inFolder("/code/app", "/code/app"), true);
  assert.equal(inFolder("/code/app/packages/ui", "/code/app"), true);
  assert.equal(inFolder("/code/app/", "/code/app/"), true);
  assert.equal(inFolder("/code/application", "/code/app"), false);
  assert.equal(inFolder("/code", "/code/app"), false);
  assert.equal(inFolder("C:\\work\\app\\src", "C:\\work\\app"), true);
  assert.equal(inFolder("C:\\work\\apple", "C:\\work\\app"), false);
  assert.equal(inFolder("/anything", null), true);
});
