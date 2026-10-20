import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findNativeMuse, nativeReleaseInfo, parseRuntimePreference, type FileProbe } from "../src/native.js";
import { planMuseCli, planServe, probeEnvironment, type ExecFn } from "../src/wsl.js";

function fakeFiles(files: Record<string, string>): FileProbe {
  return {
    exists: (path) => path in files,
    read: (path) => files[path] ?? null,
  };
}

const INSTALL = "C:\\Users\\ada\\AppData\\Local\\Programs\\muse";

describe("native Windows Muse", () => {
  it("finds the binary the PowerShell installer made active", () => {
    const files = fakeFiles({
      [`${INSTALL}\\.muse-version`]: "1.3.0-R3301.2\n",
      [`${INSTALL}\\muse-bin-1.3.0-R3301.2.exe`]: "",
      [`${INSTALL}\\muse-bin-1.3.0-R3233.1.exe`]: "",
      [`${INSTALL}\\.muse-launcher.ps1`]: "",
      [`${INSTALL}\\.muse-release-info.json`]: '{"version":"1.3.0-R3301.2"}',
    });
    const found = findNativeMuse({ LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local", Path: "C:\\Windows" }, files);
    assert.deepEqual(found, {
      binary: `${INSTALL}\\muse-bin-1.3.0-R3301.2.exe`,
      dir: INSTALL,
      version: "1.3.0-R3301.2",
      launcher: `${INSTALL}\\.muse-launcher.ps1`,
    });
    assert.equal(nativeReleaseInfo(found!, files), '{"version":"1.3.0-R3301.2"}');
  });

  it("honours MUSE_INSTALL_DIR and PATH, and ignores a half-finished install", () => {
    const custom = "D:\\tools\\muse";
    const files = fakeFiles({
      [`${INSTALL}\\.muse-version`]: "1.3.0-R1.0",
      [`${custom}\\.muse-version`]: "1.3.0-R9.0",
      [`${custom}\\muse-bin-1.3.0-R9.0.exe`]: "",
      "E:\\bin\\muse.exe": "",
    });
    assert.equal(findNativeMuse({ MUSE_INSTALL_DIR: custom, LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, files)?.binary, `${custom}\\muse-bin-1.3.0-R9.0.exe`);
    assert.equal(findNativeMuse({ LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local", Path: "E:\\bin" }, files)?.binary, "E:\\bin\\muse.exe");
    assert.equal(findNativeMuse({ LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, files), null);
  });

  it("prefers native Muse over WSL unless WSL is asked for", async () => {
    const native = { binary: `${INSTALL}\\muse-bin-1.3.0-R1.exe`, dir: INSTALL, version: "1.3.0-R1", launcher: null };
    let wslCalls = 0;
    const exec: ExecFn = async (command) => {
      if (command === "wsl") wslCalls += 1;
      return { stdout: "", exitCode: 1 };
    };
    const auto = await probeEnvironment(exec, "win32", { findNative: () => native });
    assert.equal(auto.runtime, "native");
    assert.equal(auto.musePath, native.binary);
    assert.equal(wslCalls, 0, "WSL is not started when native Muse is there");
    const forced = await probeEnvironment(exec, "win32", { findNative: () => native, preference: "wsl" });
    assert.equal(forced.runtime, "wsl");
    const none = await probeEnvironment(exec, "win32", { findNative: () => null });
    assert.equal(none.runtime, "wsl");
    assert.equal(none.musePath, null);
  });

  it("plans native commands without WSL or a shell", () => {
    assert.deepEqual(planServe({ platform: "win32", runtime: "native", musePath: "C:\\m\\muse.exe", cwd: "D:\\a b" }), {
      command: "C:\\m\\muse.exe",
      args: ["serve"],
      cwd: "D:\\a b",
      viaWsl: false,
      distro: null,
    });
    assert.deepEqual(planMuseCli({ platform: "win32", runtime: "native", musePath: "C:\\m\\muse.exe", args: ["skills", "list", "--workspace", "D:\\a b"] }), {
      command: "C:\\m\\muse.exe",
      args: ["skills", "list", "--workspace", "D:\\a b"],
    });
    assert.equal(parseRuntimePreference("WSL"), "wsl");
    assert.equal(parseRuntimePreference("windows"), "native");
    assert.equal(parseRuntimePreference("bogus"), "auto");
  });
});
