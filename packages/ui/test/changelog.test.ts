import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CHANGELOG, compareVersions, highlights, newEntries, runningVersion } from "../src/model/changelog.js";

const entries = [
  { version: "0.14.2", body: "### Fixed\n\n- Threads stop freezing." },
  { version: "0.14.1", body: "The Linux AppImage is repacked." },
  { version: "0.14.0", body: "### New\n\n- Session statistics." },
  { version: "0.13.1", body: "### Fixed\n\n- Subagent threads." },
];

describe("compareVersions", () => {
  it("orders by each part in turn, not as text", () => {
    assert.ok(compareVersions("0.9.0", "0.10.0") < 0);
    assert.ok(compareVersions("0.14.2", "0.14.10") < 0);
    assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
    assert.equal(compareVersions("0.14.2", "0.14.2"), 0);
  });

  it("does not throw on something that is not a version", () => {
    assert.equal(compareVersions("dev", "dev"), 0);
    assert.ok(compareVersions("dev", "0.14.2") !== 0);
  });
});

describe("newEntries", () => {
  it("says nothing on a first run, when no version has been seen", () => {
    assert.deepEqual(newEntries(null, "0.14.2", entries), []);
  });

  it("says nothing before the running version is known", () => {
    assert.deepEqual(newEntries("0.14.0", null, entries), []);
  });

  it("says nothing when the running version is the one already seen", () => {
    assert.deepEqual(newEntries("0.14.2", "0.14.2", entries), []);
  });

  it("says nothing on a downgrade", () => {
    assert.deepEqual(newEntries("0.14.2", "0.14.0", entries), []);
  });

  it("gives the one entry after a single update", () => {
    assert.deepEqual(
      newEntries("0.14.1", "0.14.2", entries).map((e) => e.version),
      ["0.14.2"],
    );
  });

  it("gives every entry missed when releases were skipped", () => {
    assert.deepEqual(
      newEntries("0.13.1", "0.14.2", entries).map((e) => e.version),
      ["0.14.2", "0.14.1", "0.14.0"],
    );
  });

  it("never includes a version newer than the one running", () => {
    assert.deepEqual(
      newEntries("0.13.1", "0.14.0", entries).map((e) => e.version),
      ["0.14.0"],
    );
  });
});

describe("runningVersion", () => {
  it("uses the version a self-updating shell reports", () => {
    assert.equal(runningVersion({ currentVersion: "0.14.1" }, entries), "0.14.1");
  });

  it("waits for that shell rather than guessing", () => {
    assert.equal(runningVersion({ currentVersion: null }, entries), null);
  });

  it("is the newest built-in entry where nothing reports one, as in the browser and the editor", () => {
    assert.equal(runningVersion(null, entries), "0.14.2");
    assert.equal(runningVersion(undefined, entries), "0.14.2");
    assert.equal(runningVersion(null, []), null);
  });
});

describe("highlights", () => {
  const release = (version: string, body: string) => ({ version, body });

  it("takes each item's bold lead, without its link or full stop", () => {
    const notes = release(
      "0.21.7",
      "### Fixed\n\n- **A signed-out first turn says to sign in** ([#123](https://example.com/123)). Muse Code starts without credentials.",
    );
    assert.deepEqual(highlights([notes]), ["A signed-out first turn says to sign in"]);
  });

  it("puts new things before changes and changes before fixes", () => {
    const notes = release(
      "0.21.6",
      "### Fixed\n\n- **Fix one.** Detail.\n\n### Changed\n\n- **Change one.** Detail.\n\n### New\n\n- **New one.** Detail.",
    );
    assert.deepEqual(highlights([notes]), ["New one", "Change one", "Fix one"]);
  });

  it("ranks across skipped releases, newest first within a section", () => {
    const newer = release("0.2.0", "### Fixed\n\n- **Newer fix.**\n\n### New\n\n- **Newer feature.**");
    const older = release("0.1.0", "### New\n\n- **Older feature.**\n- **Second older feature.**");
    assert.deepEqual(highlights([newer, older], 3), ["Newer feature", "Older feature", "Second older feature"]);
  });

  it("stops at the limit, four by default", () => {
    const notes = release("1.0.0", ["### New", "", ...["A", "B", "C", "D", "E"].map((x) => `- **Item ${x}.**`)].join("\n"));
    assert.equal(highlights([notes]).length, 4);
    assert.deepEqual(highlights([notes], 2), ["Item A", "Item B"]);
  });

  it("drops code marks and keeps link text", () => {
    const notes = release("1.0.0", "### Also\n\n- Type `/side` to open a [side chat](https://example.com). More words.");
    assert.deepEqual(highlights([notes]), ["Type /side to open a side chat"]);
  });

  it("gives the first sentence of notes written as a paragraph", () => {
    assert.deepEqual(highlights([release("0.14.1", "The Linux AppImage is repacked. Nothing else changed.")]), [
      "The Linux AppImage is repacked",
    ]);
  });

  it("shortens a long headline at a word", () => {
    const long = "word ".repeat(40).trim();
    const [line] = highlights([release("1.0.0", `- ${long}`)]);
    assert.ok(line.length <= 97, `${line.length} characters`);
    assert.ok(line.endsWith("word…"));
  });

  it("does not repeat a headline two releases share", () => {
    const a = release("0.2.0", "### Changed\n\n- **Up to date with Muse Code.**");
    const b = release("0.1.0", "### Changed\n\n- **Up to date with Muse Code.**");
    assert.deepEqual(highlights([a, b]), ["Up to date with Muse Code"]);
  });

  it("reads the release that ships as plain headlines", () => {
    assert.ok(highlights(CHANGELOG.slice(0, 1)).length >= 1);
    for (const line of highlights(CHANGELOG.slice(0, 1))) {
      assert.doesNotMatch(line, /\*\*|`|\]\(/, `${line} still has markdown`);
    }
  });
});

describe("the generated changelog", () => {
  it("is in step with the released version", () => {
    // scripts/sync-changelog.mjs was not run if this fails, and the app would ship notes that stop
    // short of the version it is.
    // The suite runs from dist as well as from source, so the package root is found by walking up.
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) {
      dir = dirname(dir);
    }
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    assert.equal(CHANGELOG[0]?.version, version);
  });

  it("is newest first, with no repeats and no empty entries", () => {
    const seen = new Set<string>();
    for (const [index, entry] of CHANGELOG.entries()) {
      assert.ok(entry.body.trim().length > 0, `${entry.version} has no notes`);
      assert.ok(!seen.has(entry.version), `${entry.version} appears twice`);
      seen.add(entry.version);
      const next = CHANGELOG[index + 1];
      if (next) {
        assert.ok(compareVersions(entry.version, next.version) > 0, `${entry.version} is not newer than ${next.version}`);
      }
    }
  });
});
