import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signedOut, stuckThread } from "../src/model/errors.js";

describe("stuck threads", () => {
  it("knows an unreadable image poisons every later turn", () => {
    const found = stuckThread(
      "API error 400 [request_id=f5e4]: invalid image data at input[59].content[1]: the `image/png` payload could not be decoded (it may be corrupt or truncated). (invalid_request_error)",
    );
    assert.equal(found?.kind, "image");
    assert.equal(found?.remedy, "compact");
    assert.match(found?.message ?? "", /Compacting/);
  });

  it("knows reasoning cannot be replayed after a provider switch", () => {
    const found = stuckThread(
      "provider-private history is incompatible with the active route: reasoning replay `rs_6aa475:rs_01a0926c` has no provider attribution after a provider switch; start a fresh turn without opaque reasoning history",
    );
    assert.equal(found?.kind, "reasoning");
    // Compacting keeps the recent turns as they are, so the unusable reasoning survives it: seen live.
    assert.equal(found?.remedy, "fresh");
    assert.match(found?.message ?? "", /new thread/i);
  });

  it("does not blame the history for the image just sent", () => {
    const message = "API error 400: invalid image data at input[3].content[1]: the `image/png` payload could not be decoded.";
    const own = stuckThread(message, { ownImages: true });
    assert.equal(own?.kind, "image");
    assert.equal(own?.remedy, "none", "compacting would drop the file and retry the prompt without it");
    assert.match(own?.message ?? "", /sent with this message/);
    assert.match(own?.message ?? "", /older image/, "an older one may be the real culprit, so say so");
    assert.equal(stuckThread(message, { ownImages: false })?.remedy, "compact");
    assert.equal(stuckThread(message)?.remedy, "compact", "a turn with only a PDF cannot have caused this");
  });

  it("leaves an ordinary failure alone", () => {
    assert.equal(stuckThread("API error 429: Subscription quota exhausted."), null);
    assert.equal(stuckThread("The turn failed."), null);
    assert.equal(stuckThread(""), null);
    assert.equal(stuckThread(null), null);
  });
});

describe("signed-out turns", () => {
  it("knows the host's authRequired kind", () => {
    // What muse serve 1.4.4 sends for a first turn with no credentials: the session itself starts fine.
    assert.equal(signedOut({ kind: "authRequired", message: "not logged in: run /login to add an API key" }), true);
  });

  it("knows the wording when the host gives no kind", () => {
    assert.equal(signedOut({ kind: "error", message: "not logged in: run /login to add an API key" }), true);
    assert.equal(
      signedOut({ message: "missing meta credentials: run `muse login` or set META_API_KEY, or save credentials at ~/.config/muse/auth.json" }),
      true,
    );
  });

  it("knows a retained :auto-review session refused by a signed-out host", () => {
    // Reproduced on Muse Code 1.4.7: session/read, session/resume and session/fork all refuse once auth.json is gone.
    const refusal =
      "retained session refused (class c): compose session permission profile: permission profile ':auto-review' cannot be used: the automated reviewer is unavailable on this host [/home/me/.local/share/muse/sessions/2026/10/14/01a1/session.jsonl]; remedy: retry with a compatible host that can read the retained permission frame, or start a new session";
    assert.equal(signedOut({ message: refusal }), true);
  });

  it("leaves other failures alone", () => {
    assert.equal(signedOut({ kind: "error", message: "API error 500: upstream timed out" }), false);
    assert.equal(signedOut({ kind: "error", message: "the login page returned 500" }), false);
    assert.equal(signedOut(null), false);
    assert.equal(signedOut(undefined), false);
  });
});
