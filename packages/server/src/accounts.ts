import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

/**
 * Named Muse logins ("accounts") on one machine.
 *
 * Muse reads its login and settings from `$XDG_CONFIG_HOME/muse` and keeps sessions under
 * `$XDG_DATA_HOME/muse`. An account is a pair of private directories those two variables point at, so a `muse`
 * process started with an account's environment signs in as that account and sees that account's sessions.
 * Nothing here ever reads a secret: the only field taken from `auth.json` is the non-secret identity.
 */

export interface AccountRoots {
  config: string;
  data: string;
}

export interface Account {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  roots: AccountRoots;
}

export interface AccountIdentity {
  hasLogin: boolean;
  email: string | null;
  name: string | null;
}

export interface AccountFinding {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  accountId?: string;
}

export interface AccountCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CreateAccountOptions {
  /** Display label. Defaults to the id. */
  name?: string;
  /** Copy settings.json and trust.json from Muse's default config. Never auth.json. */
  seedFromDefault?: boolean;
}

export interface AccountsOptions {
  /** Where accounts live. Defaults to MUSEGUI_ACCOUNTS_HOME, then ~/.musegui/accounts. */
  home?: string;
  /** The muse executable: a bare name searched on PATH, or a path. Defaults to "muse". */
  musePath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** Every error raised on purpose. `code` is stable for callers; `message` is for people. */
export class AccountError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

export interface Accounts {
  readonly musePath: string;
  listAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account>;
  createAccount(id: string, options?: CreateAccountOptions): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  renameAccount(id: string, name: string): Promise<void>;
  /** Stamps the account as used just now. */
  touch(id: string): Promise<void>;
  /** The variables to lay over the parent environment so `muse` runs as this account. */
  envFor(account: Account): Record<string, string>;
  identityOf(account: Account): Promise<AccountIdentity>;
  loginCommand(account: Account): AccountCommand;
  doctor(): Promise<AccountFinding[]>;
}

const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEED_FILES = ["settings.json", "trust.json"];

interface IndexEntry {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function assertId(id: string): void {
  if (!ACCOUNT_ID.test(id)) {
    throw new AccountError(
      "bad_account_id",
      `"${id}" is not a valid account id: lowercase letters, digits and dashes, 1 to 32 characters, starting with a letter or digit.`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the well-formed entries and drops the rest, so one bad entry never hides the others. */
function reviveIndex(value: unknown): IndexEntry[] {
  const list = (value as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(list)) {
    return [];
  }
  const entries: IndexEntry[] = [];
  for (const item of list) {
    const e = item as Partial<IndexEntry> | null;
    if (e && typeof e.id === "string" && ACCOUNT_ID.test(e.id) && typeof e.name === "string" && typeof e.createdAt === "string") {
      entries.push({ id: e.id, name: e.name, createdAt: e.createdAt, lastUsedAt: typeof e.lastUsedAt === "string" ? e.lastUsedAt : null });
    }
  }
  return entries;
}

export function parseLoginOutput(text: string): { url: string | null; code: string | null } {
  const match = /https:\/\/\S+code=([A-Z0-9-]+)/i.exec(text);
  return match ? { url: match[0], code: match[1] ?? null } : { url: null, code: null };
}

async function findMuse(musePath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  if (musePath.includes("/") || musePath.includes("\\") || isAbsolute(musePath)) {
    return (await exists(musePath)) ? musePath : null;
  }
  const names = platform === "win32" ? [`${musePath}.exe`, `${musePath}.cmd`, `${musePath}.bat`, musePath] : [musePath];
  for (const dir of (env["PATH"] ?? "").split(delimiter).filter((d) => d.length > 0)) {
    for (const name of names) {
      if (await exists(join(dir, name))) {
        return join(dir, name);
      }
    }
  }
  return null;
}

export function createAccounts(options: AccountsOptions = {}): Accounts {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const musePath = options.musePath ?? "muse";
  const now = options.now ?? (() => new Date());
  const fromEnv = env["MUSEGUI_ACCOUNTS_HOME"];
  const home = resolve(options.home ?? (fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".musegui", "accounts")));
  const indexFile = join(home, "accounts.json");

  const rootsFor = (id: string): AccountRoots => ({ config: join(home, id, "config"), data: join(home, id, "data") });
  const museConfig = (roots: AccountRoots) => join(roots.config, "muse");
  const defaultMuseConfig = (): string => {
    const xdg = env["XDG_CONFIG_HOME"];
    return xdg && xdg.length > 0 ? join(xdg, "muse") : join(homedir(), ".config", "muse");
  };

  async function readIndex(): Promise<IndexEntry[]> {
    let raw: string;
    try {
      raw = await readFile(indexFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    try {
      return reviveIndex(JSON.parse(raw));
    } catch {
      throw new AccountError("index_corrupt", `${indexFile} is not valid JSON. Fix or delete it; account directories on disk are unaffected.`);
    }
  }

  async function writeIndex(entries: IndexEntry[]): Promise<void> {
    await mkdir(home, { recursive: true });
    const temp = `${indexFile}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, accounts: entries }, null, 2)}\n`, "utf8");
    await rename(temp, indexFile);
  }

  const toAccount = (entry: IndexEntry): Account => ({ ...entry, roots: rootsFor(entry.id) });

  return {
    musePath,

    async listAccounts() {
      const entries = await readIndex();
      return entries.sort((a, b) => a.id.localeCompare(b.id)).map(toAccount);
    },

    async getAccount(id) {
      assertId(id);
      const entry = (await readIndex()).find((e) => e.id === id);
      if (!entry) {
        throw new AccountError("no_such_account", `No account named "${id}".`);
      }
      return toAccount(entry);
    },

    async createAccount(id, create = {}) {
      assertId(id);
      const entries = await readIndex();
      if (entries.some((e) => e.id === id) || (await exists(join(home, id)))) {
        throw new AccountError("account_exists", `Account "${id}" already exists.`);
      }
      const roots = rootsFor(id);
      await mkdir(museConfig(roots), { recursive: true });
      await mkdir(join(roots.data, "muse"), { recursive: true });
      if (create.seedFromDefault) {
        for (const file of SEED_FILES) {
          const from = join(defaultMuseConfig(), file);
          if (await exists(from)) {
            await copyFile(from, join(museConfig(roots), file));
          }
        }
      }
      const entry: IndexEntry = { id, name: create.name ?? id, createdAt: now().toISOString(), lastUsedAt: null };
      await writeIndex([...entries, entry]);
      return toAccount(entry);
    },

    async removeAccount(id) {
      assertId(id);
      await rm(join(home, id), { recursive: true, force: true });
      await writeIndex((await readIndex()).filter((e) => e.id !== id));
    },

    async renameAccount(id, name) {
      assertId(id);
      const entries = await readIndex();
      const entry = entries.find((e) => e.id === id);
      if (!entry) {
        throw new AccountError("no_such_account", `No account named "${id}".`);
      }
      entry.name = name;
      await writeIndex(entries);
    },

    async touch(id) {
      const entries = await readIndex();
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.lastUsedAt = now().toISOString();
        await writeIndex(entries);
      }
    },

    envFor(account) {
      const overlay: Record<string, string> = { XDG_CONFIG_HOME: account.roots.config, XDG_DATA_HOME: account.roots.data };
      if (platform === "darwin") {
        // On macOS Muse keeps one shared Keychain item; this keeps each account's token in its own auth.json.
        overlay["TBH_CREDENTIAL_BACKEND"] = "file";
      }
      return overlay;
    },

    async identityOf(account) {
      const none: AccountIdentity = { hasLogin: false, email: null, name: null };
      let raw: string;
      try {
        raw = await readFile(join(museConfig(account.roots), "auth.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return none;
        }
        throw error;
      }
      let meta: Record<string, unknown> | undefined;
      try {
        meta = (JSON.parse(raw) as { providers?: { meta?: Record<string, unknown> } })?.providers?.meta;
      } catch {
        return none;
      }
      if (typeof meta !== "object" || meta === null) {
        return none;
      }
      const text = (key: string): string | null => {
        const value = meta?.[key];
        return typeof value === "string" && value.length > 0 ? value : null;
      };
      return { hasLogin: text("mechanism") !== null, email: text("user_email"), name: text("user_full_name") };
    },

    loginCommand(account) {
      return { command: musePath, args: ["login"], env: this.envFor(account) };
    },

    async doctor() {
      const findings: AccountFinding[] = [];
      const apiKey = env["META_API_KEY"];
      if (typeof apiKey === "string" && apiKey.length > 0) {
        findings.push({
          level: "warn",
          code: "meta_api_key_inherited",
          message:
            "META_API_KEY is set in this environment. Muse uses it before any account login, so every account would bill that key. Unset it to use account logins.",
        });
      }
      if ((await findMuse(musePath, env, platform)) === null) {
        findings.push({ level: "error", code: "muse_not_found", message: `The muse executable "${musePath}" was not found.` });
      }
      for (const entry of await readIndex()) {
        if (!(await exists(join(home, entry.id)))) {
          findings.push({
            level: "error",
            code: "account_directory_missing",
            message: `Account "${entry.id}" is listed but its directory ${join(home, entry.id)} is gone.`,
            accountId: entry.id,
          });
        } else if (!(await this.identityOf(toAccount(entry))).hasLogin) {
          findings.push({ level: "info", code: "account_not_logged_in", message: `Account "${entry.id}" has no login yet.`, accountId: entry.id });
        }
      }
      // A directory without an index entry is left alone, but worth saying so.
      try {
        const known = new Set((await readIndex()).map((e) => e.id));
        for (const dirent of await readdir(home, { withFileTypes: true })) {
          if (dirent.isDirectory() && ACCOUNT_ID.test(dirent.name) && !known.has(dirent.name)) {
            findings.push({ level: "info", code: "account_unlisted", message: `Directory "${dirent.name}" is not a listed account.`, accountId: dirent.name });
          }
        }
      } catch {
        // No accounts directory yet.
      }
      return findings;
    },
  };
}
