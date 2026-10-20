import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * `webClient` reads where its daemon lives once, as the module loads, so every case installs its
 * browser first and then imports a fresh copy of the module through a unique specifier.
 */

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

class FakeEventSource {
  static made: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.made.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type);
    if (existing) {
      existing.push(handler);
    } else {
      this.listeners.set(type, [handler]);
    }
  }

  close(): void {
    this.closed = true;
  }
}

function browser(options: { search?: string; stored?: Record<string, string> } = {}) {
  const storage: Record<string, string> = { ...(options.stored ?? {}) };
  const replaced: string[] = [];
  const calls: Recorded[] = [];
  FakeEventSource.made = [];

  const globals = globalThis as Record<string, unknown>;
  globals["window"] = {
    localStorage: {
      getItem: (key: string) => (key in storage ? (storage[key] as string) : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    },
    location: { search: options.search ?? "", pathname: "/", hash: "" },
    history: {
      replaceState: (_state: unknown, _title: string, next: string) => {
        replaced.push(next);
      },
    },
  };
  globals["fetch"] = async (target: string, init?: RequestInit) => {
    calls.push({ url: target, init });
    return new Response(JSON.stringify({ ok: true, projects: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  globals["EventSource"] = FakeEventSource;

  return { storage, replaced, calls };
}

let seq = 0;
/** A fresh copy of the module, so one case's stored daemon cannot leak into the next. */
async function freshClient() {
  seq += 1;
  return (await import(`../src/webClient.js?case=${seq}`)) as typeof import("../src/webClient.js");
}

describe("web client", () => {
  it("takes a token out of the address bar and keeps it", async () => {
    const world = browser({ search: "?token=secret" });
    const { currentDaemon } = await freshClient();

    assert.equal(currentDaemon().token, "secret");
    assert.deepEqual(JSON.parse(world.storage["musegui:daemon"] as string), { base: "", token: "secret" });
    // The whole point: the credential stops being part of a URL anyone could copy.
    assert.deepEqual(world.replaced, ["/"]);
  });

  it("sends the token as a header, never in the path", async () => {
    const world = browser({ stored: { "musegui:daemon": JSON.stringify({ base: "", token: "secret" }) } });
    const { WebMuseGuiClient } = await freshClient();

    await new WebMuseGuiClient().listProjects();

    const call = world.calls.at(-1);
    assert.equal(call?.url, "/api/projects");
    assert.match(String((call?.init?.headers as Record<string, string>)["authorization"]), /^Bearer secret$/);
    assert.doesNotMatch(call?.url ?? "", /token=/);
  });

  it("addresses a daemon elsewhere absolutely, and sends its cookie with it", async () => {
    const world = browser({
      stored: { "musegui:daemon": JSON.stringify({ base: "https://box.example:3127", token: "secret" }) },
    });
    const { WebMuseGuiClient } = await freshClient();
    const client = new WebMuseGuiClient();

    await client.listProjects();
    assert.equal(world.calls.at(-1)?.url, "https://box.example:3127/api/projects");
    assert.equal(world.calls.at(-1)?.init?.credentials, "include");

    // An image the browser loads itself: absolute, and with nothing secret in it.
    const asset = client.assetUrl("/api/attachments/abc");
    assert.equal(asset, "https://box.example:3127/api/attachments/abc");
    assert.doesNotMatch(asset, /secret/);
  });

  it("earns the cookie before opening the stream", async () => {
    const world = browser({ stored: { "musegui:daemon": JSON.stringify({ base: "", token: "secret" }) } });
    const { WebMuseGuiClient } = await freshClient();

    const stop = new WebMuseGuiClient().subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // EventSource cannot carry a header, so /api/auth has to come first or the stream is refused.
    assert.equal(world.calls.at(0)?.url, "/api/auth");
    assert.equal(FakeEventSource.made.length, 1);
    assert.equal(FakeEventSource.made[0]?.url, "/api/events");
    // Without this the watchdog's timer outlives the test and the runner never exits.
    stop();
  });

  it("reads and writes the thread-title switch", async () => {
    const world = browser();
    const { WebMuseGuiClient } = await freshClient();
    const client = new WebMuseGuiClient();

    assert.deepEqual(await client.getTitleSettings(), { enabled: true, modelId: null });
    assert.equal(world.calls.at(-1)?.url, "/api/title-settings");

    await client.setTitleSettings({ enabled: false, modelId: "m9" });
    const patch = world.calls.at(-1);
    assert.equal(patch?.url, "/api/title-settings");
    assert.equal(patch?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(patch?.init?.body)), { enabled: false, modelId: "m9" });
  });

  it("reads and writes the sandbox switch", async () => {
    const world = browser();
    const { WebMuseGuiClient } = await freshClient();
    const client = new WebMuseGuiClient();

    assert.deepEqual(await client.getSandboxSettings(), { disabled: false });
    assert.equal(world.calls.at(-1)?.url, "/api/sandbox-settings");

    await client.setSandboxSettings({ disabled: true });
    const patch = world.calls.at(-1);
    assert.equal(patch?.url, "/api/sandbox-settings");
    assert.equal(patch?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(patch?.init?.body)), { disabled: true });
  });

  it("reads and writes the YOLO switch", async () => {
    const world = browser();
    const { WebMuseGuiClient } = await freshClient();
    const client = new WebMuseGuiClient();

    assert.deepEqual(await client.getYoloSettings(), { enabled: false });
    assert.equal(world.calls.at(-1)?.url, "/api/yolo-settings");

    await client.setYoloSettings({ enabled: true });
    const patch = world.calls.at(-1);
    assert.equal(patch?.url, "/api/yolo-settings");
    assert.equal(patch?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(patch?.init?.body)), { enabled: true });
  });

  it("imports OMP usage with a bare POST", async () => {
    const world = browser();
    const { WebMuseGuiClient } = await freshClient();

    await new WebMuseGuiClient().importOmpUsage();

    const posted = world.calls.at(-1);
    assert.equal(posted?.url, "/api/usage/import-omp");
    assert.equal(posted?.init?.method, "POST");
  });

  it("reads and writes the catch-up switch", async () => {
    const world = browser();
    const { WebMuseGuiClient } = await freshClient();
    const client = new WebMuseGuiClient();

    assert.deepEqual(await client.getFeedSettings(), { catchUp: false });
    assert.equal(world.calls.at(-1)?.url, "/api/feed-settings");

    await client.setFeedSettings({ catchUp: true });
    const patch = world.calls.at(-1);
    assert.equal(patch?.url, "/api/feed-settings");
    assert.equal(patch?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(patch?.init?.body)), { catchUp: true });
  });

  it("rebuilds a stream that has gone quiet", async () => {
    browser();
    const { WebMuseGuiClient } = await freshClient();
    mock.timers.enable({ apis: ["setTimeout"] });
    let stop = () => undefined as void;
    try {
      stop = new WebMuseGuiClient().subscribe(() => undefined);
      await Promise.resolve();
      assert.equal(FakeEventSource.made.length, 1, "one stream to begin with");

      // Two missed heartbeats: the server would have sent one every 25s.
      mock.timers.tick(70_001);
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(FakeEventSource.made[0]?.closed, true, "the dead one is torn down");
      assert.equal(FakeEventSource.made.length, 2, "and another opened in its place");
    } finally {
      // The replacement stream schedules its own watchdog, which would outlive the test.
      stop();
      mock.timers.reset();
    }
  });
});
