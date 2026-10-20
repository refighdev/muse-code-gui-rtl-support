// Smoke test for what the extension ships: dist/server.cjs starts on a free port, serves the
// bundled UI, and answers the API, the way the extension launches it.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

test("the bundled server starts, serves the UI and answers the API", async (t) => {
  const child = spawn(process.execPath, [join(dist, "server.cjs"), "--port", "0", "--static", join(dist, "frontend"), "--data-dir", ":memory:"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`no listening line: ${out}`)), 20_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
      const match = /musegui-server listening on (http:\/\/\S+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited with ${code}: ${out}`)));
  });
  const page = await fetch(`${url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);
  const env = await fetch(`${url}/api/env`);
  assert.equal(env.status, 200);
  const body = await env.json();
  assert.equal(typeof body.museFound, "boolean");
});
