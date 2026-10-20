import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { settledCount, settledEntry, withSettled } from "../src/model/changes.js";
import { collectFileChanges } from "../src/components/thread/items.js";
import type { MspItem } from "../src/types.js";

function edit(id: string, path: string, oldString: string, newString: string, status = "completed"): MspItem {
  return {
    itemId: id,
    kind: "toolCall",
    status,
    revision: 1,
    tool: "edit",
    args: JSON.stringify({ path, old_string: oldString, new_string: newString }),
  } as MspItem;
}

describe("settled changes", () => {
  it("counts a file's settled changes per thread", () => {
    const entries = withSettled([], "s1", [{ path: "a.ts", count: 2 }]);
    assert.equal(settledCount(entries, "s1", "a.ts"), 2);
    assert.equal(settledCount(entries, "s2", "a.ts"), 0, "another thread is unaffected");
    assert.equal(settledCount(entries, "s1", "b.ts"), 0);
  });

  it("replaces an older entry for the same file and keeps paths that contain the separator", () => {
    const first = withSettled([], "s1", [{ path: "a|b.ts", count: 1 }]);
    const next = withSettled(first, "s1", [{ path: "a|b.ts", count: 4 }]);
    assert.deepEqual(next, [settledEntry("s1", 4, "a|b.ts")]);
    assert.equal(settledCount(next, "s1", "a|b.ts"), 4);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ path: `f${i}.ts`, count: 1 }));
    assert.equal(withSettled([], "s1", many).length, 500);
  });
});

describe("collectFileChanges steps", () => {
  it("lists reversals latest first", () => {
    const [file] = collectFileChanges([edit("1", "a.ts", "a", "b"), edit("2", "a.ts", "b", "c")]);
    assert.deepEqual(file?.steps, [
      { before: "b", after: "c" },
      { before: "a", after: "b" },
    ]);
  });

  it("lists only the changes made after the settled ones", () => {
    const items = [edit("1", "a.ts", "a", "b"), edit("2", "a.ts", "b", "c"), edit("3", "a.ts", "c", "d")];
    const [file] = collectFileChanges(items, () => 2);
    assert.equal(file?.total, 3);
    assert.equal(file?.diffs.length, 1);
    assert.deepEqual(file?.steps, [{ before: "c", after: "d" }]);
    assert.deepEqual(collectFileChanges(items, () => 3), [], "a fully settled file is not listed");
  });

  it("skips calls that failed and gives up on one it cannot reverse", () => {
    const [kept] = collectFileChanges([edit("1", "a.ts", "a", "b"), edit("2", "a.ts", "x", "y", "failed")]);
    assert.equal(kept?.diffs.length, 1, "a failed call is not a change");
    assert.deepEqual(kept?.steps, [{ before: "a", after: "b" }]);
    const all = { ...edit("3", "a.ts", "b", "c"), args: JSON.stringify({ path: "a.ts", old_string: "b", new_string: "c", replace_all: true }) } as MspItem;
    const [mixed] = collectFileChanges([edit("1", "a.ts", "a", "b"), all]);
    assert.equal(mixed?.steps, null);
  });
});
