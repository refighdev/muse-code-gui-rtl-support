// Launches a real VS Code with the built extension and runs suite.cjs inside it.
//   npm run test:integration --workspace musegui
import { runTests } from "@vscode/test-electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "musegui-ext-"));
writeFileSync(join(workspace, "README.md"), "# fixture\n");

await runTests({
  extensionDevelopmentPath: join(here, "..", ".."),
  extensionTestsPath: join(here, "suite.cjs"),
  launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
  extensionTestsEnv: { MUSEGUI_TEST_WORKSPACE: workspace },
});
