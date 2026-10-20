import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirnameOf, fileKey, fileTarget, formatFileSize, isMarkdownPath, looksLikeFilePath, relativeToProject } from "../src/model/files.js";

describe("file links", () => {
  it("resolves relative, absolute and line-suffixed paths against the project", () => {
    assert.deepEqual(fileTarget("registries.md", "/work/app"), { path: "registries.md", line: null });
    assert.deepEqual(fileTarget("src/app.js:4-5", "/work/app"), { path: "src/app.js", line: { start: 4, end: 5 } });
    assert.deepEqual(fileTarget("/work/app/src/app.js:12", "/work/app"), { path: "src/app.js", line: { start: 12, end: 12 } });
    assert.deepEqual(fileTarget("file:///work/app/docs/My%20Guide.md#L3-L9", "/work/app"), { path: "docs/My Guide.md", line: { start: 3, end: 9 } });
    // A link inside a file resolves from that file's folder, the way a markdown preview reads it.
    assert.deepEqual(fileTarget("../api/README.md", "/work/app", "docs/guides"), { path: "docs/api/README.md", line: null });
    assert.deepEqual(fileTarget("./notes.md", "/work/app", "docs"), { path: "docs/notes.md", line: null });
  });

  it("matches Windows project paths in either slash style, ignoring drive case", () => {
    assert.deepEqual(fileTarget("C:\\Users\\me\\app\\README.md", "c:\\Users\\me\\app"), { path: "README.md", line: null });
    assert.equal(relativeToProject("C:\\work\\app", "C:/work/app/src/x.ts"), "src/x.ts");
    assert.equal(relativeToProject("/work/app", "/work/application/x.ts"), null, "a sibling folder with a shared prefix is outside");
    assert.deepEqual(fileTarget("/etc/hosts", "/work/app"), { path: "/etc/hosts", line: null }, "outside paths go to the server as written");
  });

  it("leaves web links, anchors and mail alone", () => {
    for (const href of ["https://example.com", "mailto:a@b.c", "#section", "", "javascript:alert(1)"]) {
      assert.equal(fileTarget(href, "/work/app"), null, href);
    }
  });

  it("treats only path-shaped inline code as a file", () => {
    for (const code of [".env", ".gitignore", "registries.md", "src/app.ts", "app.js:4-5", "check.test.js:8", "packages/ui/src/model/plan.ts", "Dockerfile.dev/x.yml"]) {
      assert.equal(looksLikeFilePath(code), true, code);
    }
    for (const code of ["npm test", "process.env", "this.state", "withTip / people", "a.b()", "https://x.dev/a.md", "60 / 3 = 20", "v0.11.1", "x", "obj.prop"]) {
      assert.equal(looksLikeFilePath(code), false, code);
    }
  });

  it("has the small helpers the viewer leans on", () => {
    assert.equal(isMarkdownPath("docs/README.MD"), true);
    assert.equal(isMarkdownPath("notes.txt"), false);
    assert.equal(dirnameOf("a/b/c.md"), "a/b");
    assert.equal(dirnameOf("c.md"), "");
    assert.equal(fileKey("/w", "a.md"), "/w\na.md");
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(2048), "2.0 KB");
    assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
  });
});
