// Downloads the Node.js runtime Muse Code GUI ships as a Tauri sidecar, so users do not install Node themselves.
// Tauri wants one file per target triple in src-tauri/binaries (node-<triple>[.exe]); a universal macOS
// build also wants node-universal-apple-darwin, which lipo makes from the two halves.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pinned so every release ships the same runtime. node:sqlite needs 22.13 or newer.
const NODE_VERSION = "v22.23.2";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const binariesDir = join(appDir, "src-tauri", "binaries");
const cacheDir = join(appDir, ".cache", "node", NODE_VERSION);

const DISTS = {
  "x86_64-pc-windows-msvc": { name: `node-${NODE_VERSION}-win-x64`, ext: "zip", member: "node.exe" },
  "aarch64-apple-darwin": { name: `node-${NODE_VERSION}-darwin-arm64`, ext: "tar.gz", member: "bin/node" },
  "x86_64-apple-darwin": { name: `node-${NODE_VERSION}-darwin-x64`, ext: "tar.gz", member: "bin/node" },
  "x86_64-unknown-linux-gnu": { name: `node-${NODE_VERSION}-linux-x64`, ext: "tar.gz", member: "bin/node" },
  "aarch64-unknown-linux-gnu": { name: `node-${NODE_VERSION}-linux-arm64`, ext: "tar.gz", member: "bin/node" },
};

function hostTriple() {
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (process.platform === "linux") return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  return null;
}

const target = process.env.MUSEGUI_NODE_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

let shasums;
async function expectedSha(file) {
  shasums ??= await (await fetch(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).text();
  const line = shasums.split("\n").find((entry) => entry.trim().endsWith(`  ${file}`));
  if (!line) throw new Error(`no checksum for ${file} in SHASUMS256.txt`);
  return line.split(/\s+/)[0];
}

/** The node binary for one triple, downloaded, checksum-verified and extracted into the cache. */
async function nodeFor(triple) {
  const dist = DISTS[triple];
  if (!dist) throw new Error(`no Node.js build mapped for target ${triple}`);
  const extracted = join(cacheDir, dist.name, dist.member);
  if (await exists(extracted)) return extracted;

  await mkdir(cacheDir, { recursive: true });
  const file = `${dist.name}.${dist.ext}`;
  const archive = join(cacheDir, file);
  if (!(await exists(archive))) {
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${file}`;
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    const expected = await expectedSha(file);
    if (actual !== expected) throw new Error(`checksum mismatch for ${file}: got ${actual}, want ${expected}`);
    await writeFile(archive, bytes);
  }
  // bsdtar reads zip as well as tar.gz, and ships with Windows 10+ and macOS; Linux uses GNU tar for tar.gz.
  execFileSync("tar", ["-xf", archive, "-C", cacheDir, `${dist.name}/${dist.member}`], { stdio: "inherit" });
  return extracted;
}

async function place(source, triple) {
  const out = join(binariesDir, `node-${triple}${triple.includes("windows") ? ".exe" : ""}`);
  await copyFile(source, out);
  await chmod(out, 0o755);
  console.log(`sidecar ready: ${out}`);
}

if (!target) {
  throw new Error("cannot tell which Node.js build to bundle; set MUSEGUI_NODE_TARGET to a target triple");
}

await rm(binariesDir, { recursive: true, force: true });
await mkdir(binariesDir, { recursive: true });

if (target === "universal-apple-darwin") {
  const arm = await nodeFor("aarch64-apple-darwin");
  const intel = await nodeFor("x86_64-apple-darwin");
  await place(arm, "aarch64-apple-darwin");
  await place(intel, "x86_64-apple-darwin");
  const universal = join(binariesDir, "node-universal-apple-darwin");
  execFileSync("lipo", ["-create", arm, intel, "-output", universal], { stdio: "inherit" });
  await chmod(universal, 0o755);
  console.log(`sidecar ready: ${universal}`);
} else {
  await place(await nodeFor(target), target);
}

console.log(`bundled Node.js ${NODE_VERSION} for ${target}`);
