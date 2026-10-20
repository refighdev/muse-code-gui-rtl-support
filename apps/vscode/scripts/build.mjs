// Builds the extension into dist/: the extension itself, the musegui-server bundle the desktop app
// also ships, and the built web UI. Build @musegui/web first (npm run build --workspace @musegui/web).
import esbuild from "esbuild";
import { cp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const dist = join(appDir, "dist");
const frontend = join(appDir, "..", "web", "dist");

if (!(await stat(join(frontend, "index.html")).catch(() => null))) {
  throw new Error("apps/web/dist is missing: run `npm run build --workspace @musegui/web` first.");
}

await rm(dist, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [join(appDir, "src", "extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  outfile: join(dist, "extension.js"),
  logLevel: "warning",
});
await esbuild.build({
  entryPoints: [join(appDir, "..", "..", "packages", "server", "src", "cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: join(dist, "server.cjs"),
  logLevel: "warning",
});
await cp(frontend, join(dist, "frontend"), { recursive: true });
await cp(join(appDir, "..", "..", "LICENSE"), join(appDir, "LICENSE"));
console.log("built apps/vscode/dist");
