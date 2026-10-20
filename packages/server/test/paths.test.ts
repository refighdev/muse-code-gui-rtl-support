import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathError, resolveUserPath } from "../src/paths.js";
import { MuseGuiServer } from "../src/server.js";

async function request(base: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("typed paths", () => {
  it("maps WSL, mount and home paths onto Windows", () => {
    const ctx = { platform: "win32", home: "C:\\Users\\dev", distro: "Ubuntu" };
    assert.deepEqual(resolveUserPath("/mnt/d/work/", ctx), { local: "D:\\work", display: "/mnt/d/work", flavor: "posix" });
    assert.equal(resolveUserPath("/home/dev/app", ctx).local, "\\\\wsl.localhost\\Ubuntu\\home\\dev\\app");
    assert.equal(resolveUserPath("~/code", ctx).display, "C:\\Users\\dev\\code");
    assert.equal(resolveUserPath("D:/Projects/", ctx).display, "D:\\Projects");
    assert.throws(() => resolveUserPath("projects", ctx), PathError);
    assert.throws(() => resolveUserPath("/home/dev", { ...ctx, distro: null }), PathError);
  });

  it("lists folders for the picker, creates missing ones and refuses to clone into a full folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "musegui-fs-"));
    after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "beta"));
    await mkdir(join(root, "Alpha"));
    await mkdir(join(root, ".cache"));
    await writeFile(join(root, "notes.txt"), "");
    await writeFile(join(root, "beta", "README.md"), "");

    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: process.platform === "win32" ? "win32" : "linux",
      home: root,
      distro: "Ubuntu",
      musePath: "muse",
      hostFactory: () => {
        throw new Error("no Muse host in this test");
      },
      opener: async () => {},
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;

    const listed = await request(base, `/api/fs/list?path=${encodeURIComponent("~/")}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.exists, true);
    assert.equal(listed.json.directory, root);
    assert.deepEqual([...listed.json.entries.map((e: { name: string }) => e.name)].sort(), [".cache", "Alpha", "beta"]);

    const missing = await request(base, `/api/fs/list?path=${encodeURIComponent("~/nope/")}`);
    assert.equal(missing.json.exists, false);
    assert.equal((await request(base, `/api/fs/list?path=relative`)).status, 400);

    const created = await request(base, "/api/projects", { cwd: "~/fresh/app", create: true });
    assert.equal(created.status, 200);
    assert.equal(created.json.project.cwd, join(root, "fresh", "app"));
    assert.equal((await stat(join(root, "fresh", "app"))).isDirectory(), true);

    const full = await request(base, "/api/projects/clone", { url: "https://example.com/repo.git", path: "~/beta" });
    assert.equal(full.status, 409);
    assert.equal((await request(base, "/api/projects/clone", { url: "not a url", path: "~/x" })).status, 400);
    assert.equal((await request(base, "/api/fs/reveal", { path: "~/beta" })).status, 200);
    assert.equal((await request(base, "/api/fs/reveal", { path: "~/nope" })).status, 404);
  });
});
