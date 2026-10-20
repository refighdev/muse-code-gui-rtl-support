import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DemoFiles } from "../src/demo/files.js";

const README = "/Users/you/code/readme-demo";
const API = "/Users/you/code/api-server";
const NOW = 1_000_000_000;

describe("demo files", () => {
  describe("listing", () => {
    it("lists a project root with folders first and each entry's size and time", () => {
      const listing = new DemoFiles(NOW).list(README, "");
      assert.equal(listing.path, "");
      assert.equal(listing.truncated, false);
      assert.equal(listing.entries[0]?.name, "docs");
      assert.equal(listing.entries[0]?.kind, "dir");
      assert.equal(
        listing.entries.filter((entry) => entry.kind === "file").length,
        listing.entries.length - 1,
      );
      const readme = listing.entries.find((entry) => entry.name === "README.md");
      assert.equal(readme?.path, "README.md");
      assert.equal(readme?.mtimeMs, NOW - 3_600_000);
      const readmeBytes = new TextEncoder().encode(new DemoFiles(NOW).read(README, "README.md").content ?? "").length;
      assert.equal(readme?.size, readmeBytes);
    });

    it("lists a subfolder with its own paths, and media sizes as stored", () => {
      const files = new DemoFiles(NOW);
      const listing = files.list(README, "docs");
      assert.equal(listing.path, "docs");
      const notesBytes = new TextEncoder().encode(files.read(README, "docs/notes.md").content ?? "").length;
      assert.deepEqual(
        listing.entries.map((entry) => [entry.name, entry.path, entry.kind, entry.size]),
        [
          ["notes.md", "docs/notes.md", "file", notesBytes],
          ["screenshot.png", "docs/screenshot.png", "file", 412_000],
          ["walkthrough.mp4", "docs/walkthrough.mp4", "file", 2_400_000],
        ],
      );
    });

    it("lists nested folders as folders, with size zero", () => {
      const listing = new DemoFiles(NOW).list(API, "");
      const src = listing.entries.find((entry) => entry.name === "src");
      assert.equal(src?.kind, "dir");
      assert.equal(src?.size, 0);
      assert.equal(src?.path, "src");
      const routes = new DemoFiles(NOW).list(API, "src");
      assert.deepEqual(
        routes.entries.map((entry) => [entry.name, entry.kind]),
        [
          ["routes", "dir"],
          ["index.ts", "file"],
        ],
      );
    });

    it("gives an unknown project a single placeholder README", () => {
      const listing = new DemoFiles(NOW).list("/Users/you/code/unknown", "");
      assert.deepEqual(
        listing.entries.map((entry) => [entry.name, entry.size]),
        [["README.md", "# Project\n".length]],
      );
    });

    it("lists nothing for a folder that is not there", () => {
      const listing = new DemoFiles(NOW).list(README, "nope");
      assert.deepEqual(listing, { path: "nope", entries: [], truncated: false });
    });
  });

  describe("reading", () => {
    it("reads markdown as markdown and code as text, with its content and size", () => {
      const files = new DemoFiles(NOW);
      const readme = files.read(README, "README.md");
      assert.equal(readme.name, "README.md");
      assert.equal(readme.kind, "markdown");
      assert.equal(readme.mediaType, "text/plain");
      assert.match(readme.content ?? "", /^# readme-demo/);
      assert.equal(readme.size, new TextEncoder().encode(readme.content ?? "").length);
      assert.equal(readme.truncated, false);

      const greeter = files.read(README, "greeter.py");
      assert.equal(greeter.kind, "text");
      assert.equal(greeter.name, "greeter.py");
    });

    it("reads media as a link with its media type and no content", () => {
      const files = new DemoFiles(NOW);
      const screenshot = files.read(README, "docs/screenshot.png");
      assert.equal(screenshot.kind, "image");
      assert.equal(screenshot.mediaType, "image/png");
      assert.equal(screenshot.size, 412_000);
      assert.equal("content" in screenshot, false);
      assert.equal(files.read(README, "docs/walkthrough.mp4").kind, "video");
    });

    it("reads a file that is not in the project as a 404", () => {
      const files = new DemoFiles(NOW);
      assert.throws(
        () => files.read(README, "missing.md"),
        (error: Error & { status?: number }) => error.message === "missing.md does not exist." && error.status === 404,
      );
    });
  });

  describe("writing", () => {
    it("keeps an edit for the page's life, and reads it back with its new size", () => {
      const files = new DemoFiles(NOW);
      const before = Date.now();
      const saved = files.write(README, "greeter.py", "é = 1\n");
      const after = Date.now();
      assert.equal(saved.path, "greeter.py");
      assert.equal(saved.size, new TextEncoder().encode("é = 1\n").length);
      assert.ok(saved.mtimeMs >= before && saved.mtimeMs <= after);
      assert.equal(files.read(README, "greeter.py").content, "é = 1\n");
      assert.equal(files.read(README, "greeter.py").mtimeMs, saved.mtimeMs);
    });

    it("reports the written size, not the sample file's preset one", () => {
      const files = new DemoFiles(NOW);
      const saved = files.write(README, "docs/screenshot.png", "tiny\n");
      assert.equal(saved.size, 5);
      assert.equal(files.read(README, "docs/screenshot.png").size, 5);
    });

    it("leaves the sample project as it was for the next page", () => {
      const first = new DemoFiles(NOW);
      first.write(README, "greeter.py", "changed\n");
      const second = new DemoFiles(NOW);
      assert.match(second.read(README, "greeter.py").content ?? "", /^def greet/);
    });

    it("refuses a file that is not in the project", () => {
      assert.throws(
        () => new DemoFiles(NOW).write(README, "new-file.md", "# New\n"),
        (error: Error & { status?: number }) => error.status === 404,
      );
    });
  });

  describe("searching", () => {
    it("matches paths case-insensitively and names each hit by its last part", () => {
      const hits = new DemoFiles(NOW).search(README, "GREETER");
      assert.deepEqual(
        hits.map((entry) => [entry.name, entry.path, entry.kind]),
        [
          ["greeter.py", "greeter.py", "file"],
          ["test_greeter.py", "test_greeter.py", "file"],
        ],
      );
    });

    it("matches folders in the path, and returns every file for an empty query", () => {
      const files = new DemoFiles(NOW);
      assert.deepEqual(
        files.search(README, "docs/").map((entry) => entry.path),
        ["docs/notes.md", "docs/screenshot.png", "docs/walkthrough.mp4"],
      );
      assert.equal(files.search(README, "").length, 7);
    });

    it("finds nothing when no path matches", () => {
      assert.deepEqual(new DemoFiles(NOW).search(README, "zzz"), []);
    });
  });

  describe("asset urls", () => {
    it("points media at its public asset and gives text no url", () => {
      const files = new DemoFiles(NOW);
      assert.equal(files.url(README, "docs/screenshot.png"), "/apple-touch-icon.png");
      assert.equal(files.url(README, "docs/walkthrough.mp4"), "/demo/a1.mp4");
      assert.equal(files.url(README, "README.md"), "");
      assert.equal(files.url(README, "missing.md"), "");
    });
  });
});
