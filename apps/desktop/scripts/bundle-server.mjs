import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const resourcesDir = join(appDir, "src-tauri", "resources");

await rm(resourcesDir, { recursive: true, force: true });
await mkdir(resourcesDir, { recursive: true });
await cp(join(appDir, "..", "web", "dist"), join(resourcesDir, "frontend"), {
  recursive: true,
});
await esbuild.build({
  entryPoints: [join(appDir, "..", "..", "packages", "server", "src", "cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(resourcesDir, "server.cjs"),
  logLevel: "info",
});
console.log("bundled desktop resources into src-tauri/resources");
