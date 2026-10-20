import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AccountError, createAccounts, parseLoginOutput } from "../src/accounts.js";

async function fresh() {
  const home = await mkdtemp(join(tmpdir(), "musegui-accounts-unit-"));
  return { home, accounts: createAccounts({ home, platform: "linux", musePath: "muse", env: {} }) };
}

describe("accounts", () => {
  it("creates, lists, renames and removes an account", async () => {
    const { accounts } = await fresh();
    const work = await accounts.createAccount("work", { name: "Work" });
    assert.equal(work.name, "Work");
    await accounts.createAccount("home");
    assert.deepEqual((await accounts.listAccounts()).map((a) => a.id), ["home", "work"]);
    await accounts.renameAccount("home", "Personal");
    assert.equal((await accounts.getAccount("home")).name, "Personal");
    await accounts.removeAccount("work");
    assert.deepEqual((await accounts.listAccounts()).map((a) => a.id), ["home"]);
  });

  it("rejects a bad id and a duplicate", async () => {
    const { accounts } = await fresh();
    await assert.rejects(accounts.createAccount("Bad Id"), (e: unknown) => e instanceof AccountError && e.code === "bad_account_id");
    await accounts.createAccount("work");
    await assert.rejects(accounts.createAccount("work"), (e: unknown) => e instanceof AccountError && e.code === "account_exists");
    await assert.rejects(accounts.getAccount("nope"), (e: unknown) => e instanceof AccountError && e.code === "no_such_account");
  });

  it("points muse at the account's own folders", async () => {
    const { accounts } = await fresh();
    const work = await accounts.createAccount("work");
    const env = accounts.envFor(work);
    assert.equal(env["XDG_CONFIG_HOME"], work.roots.config);
    assert.equal(env["XDG_DATA_HOME"], work.roots.data);
    assert.deepEqual(accounts.loginCommand(work).args, ["login"]);
  });

  it("reads only the non-secret identity", async () => {
    const { accounts } = await fresh();
    const work = await accounts.createAccount("work");
    assert.deepEqual(await accounts.identityOf(work), { hasLogin: false, email: null, name: null });
    const dir = join(work.roots.config, "muse");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "auth.json"), JSON.stringify({ providers: { meta: { mechanism: "device", user_email: "a@b.c", user_full_name: "A B", token: "secret" } } }));
    assert.deepEqual(await accounts.identityOf(work), { hasLogin: true, email: "a@b.c", name: "A B" });
  });

  it("warns when META_API_KEY would override account logins", async () => {
    const home = await mkdtemp(join(tmpdir(), "musegui-accounts-unit-"));
    const accounts = createAccounts({ home, platform: "linux", env: { META_API_KEY: "x", PATH: "" } });
    assert.ok((await accounts.doctor()).some((f) => f.code === "meta_api_key_inherited"));
  });

  it("finds the device url and code in muse login output", () => {
    assert.deepEqual(parseLoginOutput("Open this page to sign in:\nhttps://example.com/device?code=ABCD-1234\n"), {
      url: "https://example.com/device?code=ABCD-1234",
      code: "ABCD-1234",
    });
    assert.deepEqual(parseLoginOutput("nothing yet"), { url: null, code: null });
  });
});
