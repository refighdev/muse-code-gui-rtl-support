import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cloneUrl, isFullPath, isSshPath, parentFolder, parseSshHost, repoName, sameFolder, splitBrowsePath, withTrailingSeparator } from "../src/model/paths.js";

describe("picker paths", () => {
  it("splits typed text into the folder to list and a filter", () => {
    assert.deepEqual(splitBrowsePath("D:/Projects/app"), { directory: "D:/Projects/", leaf: "app", separator: "/" });
    assert.deepEqual(splitBrowsePath("~/"), { directory: "~/", leaf: "", separator: "/" });
    assert.deepEqual(splitBrowsePath("C:\\Users\\a"), { directory: "C:\\Users\\", leaf: "a", separator: "\\" });
    assert.deepEqual(splitBrowsePath("proj"), { directory: "", leaf: "proj", separator: "/" });
  });

  it("recognizes full paths only", () => {
    for (const path of ["~/", "/home/dev", "D:\\", "c:/x", "\\\\server\\share", "ssh://h/", "ssh://deploy@db1/srv"]) {
      assert.equal(isFullPath(path), true, path);
    }
    for (const path of ["~", "projects", "D:", ""]) {
      assert.equal(isFullPath(path), false, path);
    }
  });

  it("browses ssh:// paths with the same split", () => {
    assert.deepEqual(splitBrowsePath("ssh://h/srv/ap"), { directory: "ssh://h/srv/", leaf: "ap", separator: "/" });
    assert.deepEqual(splitBrowsePath("ssh://h/~/"), { directory: "ssh://h/~/", leaf: "", separator: "/" });
    assert.equal(isSshPath("ssh://h/app"), true);
    assert.equal(isSshPath("/srv/app"), false);
  });

  it("validates SSH hostnames", () => {
    assert.equal(parseSshHost("devbox.example.com"), "devbox.example.com");
    assert.equal(parseSshHost("Example.COM"), "example.com");
    assert.equal(parseSshHost("deploy@DB1"), "deploy@db1");
    for (const bad of ["", "a b", "host;rm", "host|ls", "-h", ".h", "a..b", "ssh://h/x", "h/x", "-Elog@h", "-deploy@db1"]) {
      assert.equal(parseSshHost(bad), null, bad);
    }
  });

  it("finds parent folders and compares folders loosely", () => {
    assert.equal(parentFolder("D:\\Projects\\app"), "D:\\Projects\\");
    assert.equal(parentFolder("/home/dev/app/"), "/home/dev/");
    assert.equal(parentFolder("app"), null);
    assert.equal(withTrailingSeparator("D:\\", "\\"), "D:\\");
    assert.equal(withTrailingSeparator("/home", "/"), "/home/");
    assert.equal(sameFolder("D:\\Projects\\App", "d:/projects/app/"), true);
    assert.equal(sameFolder("/home/a", "/home/A"), false);
  });

  it("turns typed repositories into clone URLs and folder names", () => {
    assert.equal(cloneUrl("pingdotgg/t3code"), "https://github.com/pingdotgg/t3code.git");
    assert.equal(cloneUrl("git@github.com:a/b.git"), "git@github.com:a/b.git");
    assert.equal(cloneUrl("https://gitlab.com/g/p"), "https://gitlab.com/g/p");
    assert.equal(cloneUrl("not a repo"), null);
    assert.equal(repoName("https://github.com/a/b.git"), "b");
    assert.equal(repoName("git@github.com:a/b.git"), "b");
  });
});
