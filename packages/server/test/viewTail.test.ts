import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ViewTail, withoutProvisionalEnding, type TailEvent, type ViewTailTiming } from "../src/viewTail.js";

const TIMING: ViewTailTiming = {
  tickMs: 500,
  quietMs: 3_000,
  suspectQuietMs: 1_000,
  busyMaxMs: 10_000,
  idleMs: 15_000,
  idleMaxMs: 60_000,
  statusMs: 15_000,
  hotMs: 20_000,
  idleFollowMs: 300_000,
  lookMaxMs: 30_000,
};

const S = "s1";

function ev(method: string, ordinal: number | string, extra: Record<string, unknown> = {}): TailEvent {
  return { method, params: { sessionId: S, viewCursor: `v:${S}:${ordinal}`, ...extra } };
}

function item(ordinal: number, status = "completed"): TailEvent {
  return ev(status === "completed" ? "item/completed" : "item/started", ordinal, { item: { itemId: `i${ordinal}`, status } });
}

/** An event as the push feed carries it: one the view holds says which log records it came from. */
function pushed(event: TailEvent): TailEvent {
  return { ...event, params: { ...event.params, sourceRange: { start: 1, end: 1 } } };
}

/**
 * A view of ordered events, a clock, and a record of everything the tail did with them. The tail is
 * switched on, as these tests are about what it does then; `on: false` leaves it as it is made.
 */
function harness(options: { busy?: boolean; turn?: string | null; on?: boolean } = {}) {
  const view: TailEvent[] = [];
  const state = {
    now: 1_000_000,
    busy: options.busy ?? true,
    turn: options.turn === undefined ? "t1" : options.turn,
    /** What Muse's own record says is running; `undefined` makes the read fail. */
    record: (options.turn === undefined ? "t1" : options.turn) as string | null | undefined,
    /** Answers for the next reads, ahead of `record`, for a session that changes between two of them. */
    records: [] as (string | null)[],
    /** Whether the record can say where the view ends; a session with no usable projection cannot. */
    headKnown: true,
    /** Whether the record carries an update time, which moves whenever the view does. */
    stampKnown: true,
    /** The ending the view lends a running turn: served after the real events, never part of them. */
    provisional: [] as TailEvent[],
    reads: 0,
    /** Reads, counted from one, that get no answer worth having: Muse has none, or the request fails. */
    faults: {} as Record<number, "unreadable" | "rejected">,
    refuse: new Set<string | null>(),
    pageLimit: 200,
    gate: null as Promise<void> | null,
    /** The same as `gate`, for the record: a read made while it is set answers only once it opens. */
    readGate: null as Promise<void> | null,
    /** Runs once a page is put together, for what Muse does between a page and the read after it. */
    afterPage: null as (() => void) | null,
  };
  const delivered: TailEvent[] = [];
  const pages: (string | null)[] = [];
  const confirmed: string[] = [];
  const corrected: (string | null)[] = [];
  const tail = new ViewTail(
    {
      page: async (_sessionId, cursor) => {
        pages.push(cursor);
        if (state.gate) {
          await state.gate;
        }
        if (state.refuse.has(cursor)) {
          throw new Error("unknown cursor anchor");
        }
        const all = [...view, ...state.provisional];
        const from = cursor === null ? 0 : all.findIndex((e) => e.params["viewCursor"] === cursor) + 1;
        const events = all.slice(from, from + state.pageLimit);
        const more = from + events.length < all.length;
        state.afterPage?.();
        return { events, nextCursor: more ? (events[events.length - 1]?.params["viewCursor"] as string) : null };
      },
      read: async () => {
        state.reads += 1;
        const fault = state.faults[state.reads];
        if (state.readGate) {
          await state.readGate;
        }
        if (fault === "rejected") {
          throw new Error("request timed out");
        }
        if (state.record === undefined || fault === "unreadable") {
          return undefined;
        }
        const last = view[view.length - 1]?.params["viewCursor"];
        const queued = state.records.shift();
        const activeTurnId = queued === undefined ? state.record : queued;
        return {
          head: state.headKnown && typeof last === "string" ? last : null,
          activeTurnId,
          stamp: state.stampKnown ? `${view.length} ${activeTurnId}` : null,
        };
      },
      deliver: (_sessionId, event) => delivered.push(event),
      believed: () => ({ busy: state.busy, activeTurnId: state.turn }),
      confirmed: (_sessionId, turn) => confirmed.push(turn),
      corrected: (_sessionId, turn) => {
        corrected.push(turn);
        state.turn = turn;
      },
      log: () => undefined,
      now: () => state.now,
    },
    TIMING,
  );
  if (options.on !== false) {
    tail.setEnabled(true);
  }
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
  };
  /** Moves the clock on and lets the tail look, as its timer would. */
  const advance = async (ms: number) => {
    state.now += ms;
    tail.tick();
    await settle();
  };
  const cursors = () => delivered.map((e) => String(e.params["viewCursor"]).split(":").pop());
  return { tail, view, state, delivered, pages, confirmed, corrected, advance, settle, cursors };
}

describe("withoutProvisionalEnding", () => {
  const view = [
    ev("turn/started", 1, { turnId: "t1" }),
    item(2, "inProgress"),
    ev("item/completed", 3, { item: { itemId: "i2", status: "failed", reason: "incomplete" } }),
    ev("turn/completed", 4, { turnId: "t1", terminal: "failed", reason: "incomplete" }),
  ];

  it("cuts at the head the record gives, whatever follows it", () => {
    assert.deepEqual(withoutProvisionalEnding(view, [null], `v:${S}:2`), view.slice(0, 2));
    assert.equal(withoutProvisionalEnding(view, ["t1"], `v:${S}:4`), view, "a head at the end leaves the events as they are");
  });

  it("falls back to recognising the ending of a running turn", () => {
    assert.deepEqual(withoutProvisionalEnding(view, ["t1"], null), view.slice(0, 2));
    assert.deepEqual(withoutProvisionalEnding(view, [null, "t1"], `v:${S}:99`), view.slice(0, 2), "a head not in the events is no use");
  });

  it("leaves alone an ending of a turn that is not running, and anything that is not an ending", () => {
    assert.equal(withoutProvisionalEnding(view, [null], null), view);
    assert.equal(withoutProvisionalEnding(view, ["t2"], null), view);
    assert.equal(withoutProvisionalEnding(view.slice(0, 3), ["t1"], null).length, 3);
    assert.deepEqual(withoutProvisionalEnding([], ["t1"], null), []);
  });
});

describe("ViewTail", () => {
  it("pages a session whose push feed is silent and delivers what it finds", async () => {
    const h = harness();
    h.view.push(item(1), item(2));
    h.tail.anchor(S, `v:${S}:2`);
    h.view.push(item(3), ev("turn/completed", 4, { turnId: "t1" }));

    await h.advance(2_000);
    assert.deepEqual(h.pages, [], "not quiet for long enough yet");

    await h.advance(1_000);
    assert.deepEqual(h.pages, [`v:${S}:2`], "paged from where history ended");
    assert.deepEqual(h.cursors(), ["3", "4"]);
    assert.equal(h.tail.stats()[S]?.recovered, 2);
  });

  it("leaves a session alone while its pushes keep arriving", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    for (let n = 1; n <= 6; n += 1) {
      h.view.push(item(n));
      assert.equal(h.tail.heard(S, pushed(item(n))), true);
      await h.advance(2_000);
    }
    assert.deepEqual(h.pages, []);
    assert.deepEqual(h.delivered, [], "pushed events are passed on by the caller, not delivered twice");
  });

  it("discards the overlap between what was pushed and what a page returns", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    // Muse dropped 2 and went on to push 3; the position is now past the hole.
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:3` })), false, "a gap is not shown to a thread");

    await h.advance(0);
    assert.deepEqual(h.pages, [`v:${S}:1`], "paged from before the hole without waiting out the quiet");
    assert.deepEqual(h.cursors(), ["2"], "only the event push lost is delivered");
    assert.equal(h.tail.heard(S, pushed(item(2))), false, "and its late twin from the feed is refused");
  });

  it("looks for a hole as soon as it is reported, so what is pushed after it comes out after it", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4), item(5), item(6));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(4))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:4` })), false);
    // Before any tick: the look is already on its way, and these wait for it.
    assert.equal(h.tail.heard(S, pushed(item(5))), false);
    assert.equal(h.tail.heard(S, pushed(item(6))), false);
    await h.settle();
    assert.deepEqual(h.pages, [`v:${S}:1`]);
    assert.deepEqual(h.cursors(), ["2", "3", "5", "6"], "the hole first, then what followed it");
    assert.equal(h.tail.stats()[S]?.recovered, 2, "and only the two that push lost count against it");
  });

  it("pages from the first hole when a second is reported before the first is covered", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4), item(5), item(6));
    // One stretch of backpressure: Muse drops 2 and 3, delivers 4 and says so, then drops 5,
    // delivers 6 and says so again.
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(4))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:4` })), false);
    assert.equal(h.tail.heard(S, pushed(item(6))), false);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:4`, next: `v:${S}:6` })), false);
    await h.settle();
    assert.deepEqual(h.pages, [`v:${S}:1`], "the second gap did not move where the look for the first began");
    assert.deepEqual(h.cursors(), ["2", "3", "5", "6"]);

    await h.advance(0);
    assert.deepEqual(h.pages, [`v:${S}:1`, `v:${S}:6`], "a hole reported mid-look is looked for at once, from what is already delivered");
    assert.deepEqual(h.cursors(), ["2", "3", "5", "6"]);
    assert.equal(h.tail.stats()[S]?.gaps, 2);
  });

  it("pages from where a look began though a gap is reported while Muse answers it", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2), item(3), item(4), item(5), item(6));
    let open!: () => void;
    h.state.readGate = new Promise<void>((r) => (open = r));
    await h.advance(3_000);
    assert.equal(h.state.reads, 1, "an ordinary look, with the record on its way");
    // The session wakes meanwhile: three pushes, one event dropped, the next delivered, and the gap.
    for (const n of [2, 3, 4, 6]) {
      assert.equal(h.tail.heard(S, pushed(item(n))), false);
    }
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:4`, next: `v:${S}:6` })), false);

    h.state.readGate = null;
    open();
    await h.settle();
    assert.deepEqual(h.pages, [`v:${S}:1`], "not from the gap, which lies past pushes still being held");
    assert.deepEqual(h.cursors(), ["2", "3", "4", "5", "6"], "so everything comes out in the order the view holds it");
    assert.equal(h.tail.stats()[S]?.recovered, 1, "and only the dropped event counts as one push lost");
  });

  it("goes back for a hole reported mid-look that lies behind where the look began", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4), item(5));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    // Muse dropped 2 and 3 and pushed 4, but has not said so yet: the wire promises no order
    // between a gap and the frame after it.
    assert.equal(h.tail.heard(S, pushed(item(4))), true);
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => (open = r));
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:4`], "an ordinary look, from the newest push");
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:4` })), false);
    h.state.gate = null;
    open();
    await h.settle();
    assert.deepEqual(h.cursors(), ["5"]);

    await h.advance(0);
    assert.deepEqual(h.pages, [`v:${S}:4`, `v:${S}:1`], "the look did not carry the position past the hole");
    assert.deepEqual(h.cursors(), ["5", "2", "3"]);
  });

  it("keeps a hole whose look failed, so no push carries the position past it", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    // A host reporting gaps is one under pressure, which is when a request to it fails.
    h.state.faults[1] = "rejected";
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:3` })), false);
    await h.settle();
    assert.equal(h.tail.stats()[S]?.failures, 1);
    assert.deepEqual(h.pages, []);
    assert.equal(h.tail.heard(S, pushed(item(4))), true, "the turn carries on meanwhile");

    await h.advance(0);
    assert.equal(h.state.reads, 1, "a host that failed is asked again in its turn, not at every tick");
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`], "from before the hole, whatever has been pushed since");
    assert.deepEqual(h.cursors(), ["2"]);
  });

  it("keeps it as well when a push was held during the look that failed", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    h.state.faults[1] = "unreadable";
    let open!: () => void;
    h.state.readGate = new Promise<void>((r) => (open = r));
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:3` })), false);
    assert.equal(h.tail.heard(S, pushed(item(4))), false);
    h.state.readGate = null;
    open();
    await h.settle();
    assert.deepEqual(h.cursors(), ["4"], "the held push is released when the look fails");

    await h.advance(10_000);
    assert.deepEqual(h.pages, [`v:${S}:1`], "and did not take the position with it");
    assert.deepEqual(h.cursors(), ["4", "2"]);
  });

  it("still pages from the first hole when a second is reported after its look failed", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4), item(5), item(6));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(4))), true);
    h.state.faults[1] = "rejected";
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:4` })), false);
    await h.settle();
    await h.advance(500);
    assert.equal(h.tail.heard(S, pushed(item(6))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:4`, next: `v:${S}:6` })), false);
    await h.settle();
    assert.deepEqual(h.pages, [`v:${S}:1`]);
    assert.deepEqual(h.cursors(), ["2", "3", "5"]);
  });

  it("does not ask a host once for every gap it reports", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3));
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:3` })), false);
    await h.settle();
    assert.deepEqual(h.cursors(), ["2"]);
    // Another hole straight away: its look waits for the tick, as every look once did.
    h.view.push(item(4), item(5));
    assert.equal(h.tail.heard(S, pushed(item(5))), true);
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:3`, next: `v:${S}:5` })), false);
    await h.settle();
    assert.equal(h.state.reads, 1);
    await h.advance(500);
    assert.equal(h.state.reads, 2);
    assert.deepEqual(h.cursors(), ["2", "4"]);
  });

  it("does not step over a turn event because the status change sharing its cursor arrived", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    // Muse stamps the status change with the cursor of the turn event behind it. Push delivered
    // the first and lost the second, which is the one that ends the turn.
    h.view.push(ev("turn/completed", 2, { turnId: "t1" }));
    assert.equal(h.tail.heard(S, ev("session/statusChanged", 2, { status: "idle" })), true);
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`], "a frame the view does not serve is nowhere to page from");
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/completed"],
    );
  });

  it("does not page from a streaming delta either, though it counts as hearing from the session", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    assert.equal(h.tail.heard(S, ev("item/delta", "1.4", { itemId: "i2", delta: "x" })), true);
    await h.advance(2_000);
    assert.equal(h.state.reads, 0, "the delta was two seconds ago");
    h.view.push(item(2));
    await h.advance(1_000);
    assert.deepEqual(h.pages, [`v:${S}:1`]);
    assert.deepEqual(h.cursors(), ["2"]);
  });

  it("asks for no page when the record says the view ends where the session already is", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    await h.advance(3_000);
    assert.equal(h.state.reads, 1);
    assert.deepEqual(h.pages, []);
    assert.deepEqual(h.confirmed, ["t1"], "and the turn is confirmed from the same read");
  });

  it("does not deliver the ending the view lends a turn that is still running", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(ev("turn/started", 1, { turnId: "t1" }), item(2, "inProgress"));
    // What a page shows mid-turn: the open item and the turn closed as they would be had the host died.
    h.state.provisional = [
      ev("item/completed", 3, { item: { itemId: "i2", status: "failed", reason: "incomplete" } }),
      ev("turn/completed", 4, { turnId: "t1", terminal: "failed", reason: "incomplete" }),
    ];
    await h.advance(3_000);
    assert.deepEqual(h.cursors(), ["1", "2"], "the view really ends at 2");

    await h.advance(1_000);
    await h.advance(10_000);
    assert.deepEqual(h.cursors(), ["1", "2"], "and the lent ending never arrives, however often it is offered");
    assert.deepEqual(h.confirmed, ["t1"]);

    // The turn finishes, and the same cursors now hold what happened.
    h.state.provisional = [];
    h.view.push(item(3), ev("turn/completed", 4, { turnId: "t1", terminal: "completed" }));
    await h.advance(10_000);
    assert.deepEqual(h.cursors(), ["1", "2", "3", "4"]);
    assert.equal(h.delivered.at(-1)?.params["terminal"], "completed");
    assert.equal(h.delivered.some((e) => JSON.stringify(e).includes("incomplete")), false);
  });

  it("recognises the lent ending with no head to go by", async () => {
    const h = harness();
    h.state.headKnown = false;
    h.tail.anchor(S, null);
    h.view.push(ev("turn/started", 1, { turnId: "t1" }), item(2, "inProgress"));
    h.state.provisional = [
      ev("item/completed", 3, { item: { itemId: "i2", status: "failed", reason: "incomplete" } }),
      ev("turn/completed", 4, { turnId: "t1", terminal: "failed", reason: "incomplete" }),
    ];
    await h.advance(3_000);
    await h.advance(1_000);
    assert.deepEqual(h.cursors(), ["1", "2"]);
    assert.deepEqual(h.pages, [null], "the record has not moved since the view was read to its end, so it is not read again");
    assert.deepEqual(h.confirmed, ["t1"]);

    h.state.provisional = [];
    h.view.push(item(3), ev("turn/completed", 4, { turnId: "t1", terminal: "completed" }));
    await h.advance(10_000);
    assert.deepEqual(h.pages, [null, `v:${S}:2`], "paged from the last real event, never from a lent one");
    assert.deepEqual(h.cursors(), ["1", "2", "3", "4"]);
  });

  it("pages every time when the record offers neither a head nor an update time", async () => {
    const h = harness();
    h.state.headKnown = false;
    h.state.stampKnown = false;
    h.tail.anchor(S, null);
    h.view.push(item(1));
    await h.advance(3_000);
    await h.advance(1_000);
    await h.advance(1_500);
    assert.deepEqual(h.pages, [null, `v:${S}:1`, `v:${S}:1`], "nothing says the view is unchanged, so it is asked");
    assert.deepEqual(h.cursors(), ["1"]);
  });

  it("rests after a slow look in proportion to how long it took", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1));
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => (open = r));
    await h.advance(3_000);
    // Muse takes two seconds to answer, as it can for a large session it has to project afresh.
    h.state.now += 2_000;
    h.state.gate = null;
    open();
    await h.settle();
    assert.equal(h.tail.stats()[S]?.lastWalkMs, 2_000);
    h.view.push(item(2));
    await h.advance(5_000);
    assert.deepEqual(h.cursors(), ["1"], "a second of quiet would have been enough, were the look not so costly");
    await h.advance(1_000);
    assert.deepEqual(h.cursors(), ["1", "2"]);
  });

  it("stops looking at an idle session that has shown no life for a while, until it does", async () => {
    const h = harness({ busy: false, turn: null });
    h.tail.anchor(S, null);
    for (let i = 0; i < 20; i += 1) {
      await h.advance(60_000);
    }
    const looks = h.state.reads;
    assert.ok(looks >= 3 && looks <= 8, `looked ${looks} times in the first five minutes, then stopped`);
    await h.advance(3_600_000);
    assert.equal(h.state.reads, looks);

    h.tail.nudge(S);
    await h.advance(3_000);
    assert.equal(h.state.reads, looks + 1, "a command brings it back");
  });

  it("looks at such a session again once its thread is loaded again", async () => {
    const h = harness({ busy: false, turn: null });
    h.tail.anchor(S, null);
    for (let i = 0; i < 20; i += 1) {
      await h.advance(60_000);
    }
    const looks = h.state.reads;
    // Somebody opens the thread. It is followed already, so its position stays where it is.
    h.tail.anchor(S, `v:${S}:9`);
    h.view.push(ev("turn/started", 1, { turnId: "t2" }));
    await h.advance(1_000);
    assert.equal(h.state.reads, looks + 1, "a load is life, as a command is");
    assert.equal(h.pages.at(-1), null, "paged from where the tail was, not from where the load ended");
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/started"],
    );
  });

  it("keeps no memory of what it delivered for a session it has stopped looking at", async () => {
    const h = harness({ busy: false, turn: null });
    h.view.push(item(1));
    h.tail.anchor(S, null);
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(1))), false, "remembered while the session is followed");
    for (let i = 0; i < 6; i += 1) {
      await h.advance(60_000);
    }
    // Nothing is held for a thread nobody is using; a twin this late is not one any more.
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
  });

  it("recognises it for a turn that started while the page was being read", async () => {
    const h = harness({ busy: false, turn: null });
    h.state.headKnown = false;
    h.tail.anchor(S, null);
    h.view.push(ev("turn/started", 1, { turnId: "t2" }));
    h.state.provisional = [ev("turn/completed", 2, { turnId: "t2", terminal: "failed", reason: "incomplete" })];
    // Idle when asked before the page; running by the time the page's ending needs explaining.
    h.state.records = [null, "t2"];
    await h.advance(15_000);
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/started"],
    );
  });

  it("recognises it though the record, read again, puts the head on the cursor the ending was lent", async () => {
    const h = harness({ busy: false, turn: null });
    h.state.headKnown = false;
    h.tail.anchor(S, null);
    h.view.push(ev("turn/started", 1, { turnId: "t2" }));
    h.state.provisional = [ev("turn/completed", 2, { turnId: "t2", terminal: "failed", reason: "incomplete" })];
    h.state.records = [null, "t2"];
    // Between the page and the second read the turn's first real event takes the cursor the page lent out.
    h.state.afterPage = () => {
      h.state.afterPage = null;
      h.state.headKnown = true;
      h.state.provisional = [];
      h.view.push(item(2, "inProgress"));
    };
    await h.advance(15_000);
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/started"],
      "the head names a cursor in the page, and the event the page put there is still not real",
    );

    h.state.record = "t2";
    await h.advance(15_000);
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/started", "item/started"],
      "and the event really at that cursor is not stepped over",
    );
  });

  for (const fault of ["rejected", "unreadable"] as const) {
    it(`holds back an ending it cannot ask about, when the second read is ${fault}`, async () => {
      const h = harness({ busy: false, turn: null });
      h.state.headKnown = false;
      h.tail.anchor(S, null);
      h.view.push(ev("turn/started", 1, { turnId: "t2" }));
      h.state.provisional = [ev("turn/completed", 2, { turnId: "t2", terminal: "failed", reason: "incomplete" })];
      h.state.records = [null];
      h.state.faults[2] = fault;
      await h.advance(15_000);
      assert.deepEqual(
        h.delivered.map((e) => e.method),
        ["turn/started"],
        "nothing says the turn is over, so it is not shown as failed",
      );
      assert.equal(h.tail.stats()[S]?.failures, 1);

      // The next look asks again from before the ending, and by then the turn has moved on.
      h.state.record = "t2";
      h.state.provisional = [];
      h.view.push(item(2, "inProgress"));
      await h.advance(60_000);
      assert.deepEqual(
        h.delivered.map((e) => e.method),
        ["turn/started", "item/started"],
      );
    });
  }

  it("keeps an incomplete ending when no turn is running, since then the host really died", async () => {
    const h = harness({ busy: false, turn: null });
    h.tail.anchor(S, null);
    h.view.push(
      ev("turn/started", 1, { turnId: "t1" }),
      ev("item/completed", 2, { item: { itemId: "i2", status: "failed", reason: "incomplete" } }),
      ev("turn/completed", 3, { turnId: "t1", terminal: "failed", reason: "incomplete" }),
    );
    await h.advance(15_000);
    assert.deepEqual(h.cursors(), ["1", "2", "3"]);
  });

  it("holds pushes that land while a page is in flight and releases them after it, in order", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2), item(3));
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => (open = r));

    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`]);
    // While Muse answers: the twin of an event in the page, then one newer than the page.
    assert.equal(h.tail.heard(S, pushed(item(3))), false);
    assert.equal(h.tail.heard(S, pushed(item(4))), false);
    assert.deepEqual(h.delivered, []);

    h.state.gate = null;
    open();
    await h.settle();
    assert.deepEqual(h.cursors(), ["2", "3", "4"], "the paged prefix first, then the held tail without its overlap");
    assert.equal(h.tail.stats()[S]?.recovered, 1, "push lost 2; 3 was only late");
  });

  it("does not count an event against push because it landed while the look was in flight", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2));
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => (open = r));
    await h.advance(3_000);
    assert.equal(h.tail.heard(S, pushed(item(2))), false);
    h.state.gate = null;
    open();
    await h.settle();
    assert.deepEqual(h.cursors(), ["2"]);
    assert.equal(h.tail.stats()[S]?.recovered, 0, "push delivered everything");
    assert.equal(h.tail.stats()[S]?.suspect, false);
  });

  it("gives up on a look Muse never answers, and passes on the pushes it was holding", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    let open!: () => void;
    h.state.readGate = new Promise<void>((r) => (open = r));
    await h.advance(3_000);
    assert.equal(h.state.reads, 1);
    h.view.push(item(2), item(3));
    assert.equal(h.tail.heard(S, pushed(item(2))), false);
    assert.equal(h.tail.heard(S, pushed(item(3))), false);
    await h.advance(29_000);
    assert.deepEqual(h.delivered, [], "a slow look is still given its time");

    await h.advance(1_000);
    assert.deepEqual(h.cursors(), ["2", "3"], "in the order they arrived");
    assert.equal(h.tail.stats()[S]?.failures, 1);
    h.view.push(item(4));
    assert.equal(h.tail.heard(S, pushed(item(4))), true, "and the feed is held up no longer");

    // The answer turns up after all, and is not wanted any more.
    h.state.readGate = null;
    open();
    await h.settle();
    assert.deepEqual(h.pages, []);
    assert.deepEqual(h.cursors(), ["2", "3"]);

    h.view.push(item(5));
    await h.advance(90_000);
    assert.deepEqual(h.cursors(), ["2", "3", "5"], "the session is looked at again once the host has had a rest");
  });

  it("spaces out looks that find nothing, and looks again soon after a command", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    await h.advance(3_000);
    await h.advance(3_000);
    assert.equal(h.state.reads, 1, "the second look waits longer than the first");
    await h.advance(1_500);
    assert.equal(h.state.reads, 2);
    for (let i = 0; i < 20; i += 1) {
      await h.advance(10_000);
    }
    const settledAt = h.state.reads;
    await h.advance(9_000);
    assert.equal(h.state.reads, settledAt, "capped at the busy maximum, not sooner");

    h.tail.nudge(S);
    await h.advance(0);
    assert.equal(h.state.reads, settledAt + 1, "a command resets the spacing");
  });

  it("pages faster once push has been caught losing events, until a push arrives again", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.view.push(item(1));
    await h.advance(3_000);
    assert.equal(h.tail.stats()[S]?.suspect, true);

    h.view.push(item(2));
    await h.advance(1_000);
    assert.deepEqual(h.cursors(), ["1", "2"], "one second of quiet is enough now");

    h.view.push(item(3));
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    assert.equal(h.tail.stats()[S]?.suspect, false);
  });

  it("still pages an idle session, slowly, in case a turn starts unannounced", async () => {
    const h = harness({ busy: false, turn: null });
    h.tail.anchor(S, null);
    await h.advance(14_000);
    assert.equal(h.pages.length, 0);
    h.view.push(ev("turn/started", 1, { turnId: "t2" }));
    await h.advance(1_000);
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/started"],
    );
  });

  it("takes several pages for a session that fell far behind", async () => {
    const h = harness();
    h.state.pageLimit = 2;
    h.tail.anchor(S, null);
    h.view.push(item(1), item(2), item(3), item(4), item(5));
    await h.advance(3_000);
    assert.deepEqual(h.pages, [null, `v:${S}:2`, `v:${S}:4`]);
    assert.deepEqual(h.cursors(), ["1", "2", "3", "4", "5"]);
  });

  it("falls back to the last paged position when Muse refuses a pushed one", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2), item(3));
    assert.equal(h.tail.heard(S, pushed(item(2))), true);
    h.state.refuse.add(`v:${S}:2`);
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:2`, `v:${S}:1`]);
    assert.deepEqual(h.cursors(), ["3"], "2 came back in the page and was discarded as already pushed");
  });

  it("falls back to where the record last agreed the view ended, not to where history was loaded", async () => {
    const h = harness();
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2));
    assert.equal(h.tail.heard(S, pushed(item(2))), true);
    await h.advance(3_000);
    assert.deepEqual(h.pages, [], "the view ends where push left the session");

    h.view.push(item(3), item(4));
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    h.state.refuse.add(`v:${S}:3`);
    await h.advance(10_000);
    assert.deepEqual(h.pages, [`v:${S}:3`, `v:${S}:2`]);
    assert.deepEqual(h.cursors(), ["4"]);
  });

  it("has nowhere to fall back to for a session it never paged, and does not start from the top instead", async () => {
    const h = harness();
    h.view.push(item(1), item(2), item(3), item(4), item(5), item(6));
    // Known only from a push: catch-up was switched on mid-session, or the push beat the history load.
    assert.equal(h.tail.heard(S, pushed(item(5))), true);
    h.state.refuse.add(`v:${S}:5`);
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:5`]);
    assert.deepEqual(h.delivered, [], "the history before it is not delivered as though it had just happened");
    assert.equal(h.tail.stats()[S]?.failures, 1);

    h.state.refuse.clear();
    await h.advance(10_000);
    assert.deepEqual(h.cursors(), ["6"], "a refusal that was only passing costs one look");
  });

  it("delivers nothing twice when it falls back past more than it remembers", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    // A long healthy turn: more frames than the overlap memory holds, every one pushed and passed on.
    for (let n = 1; n <= 5_000; n += 1) {
      h.view.push(item(n));
      assert.equal(h.tail.heard(S, pushed(item(n))), true);
    }
    h.view.push(item(5_001));
    h.state.refuse.add(`v:${S}:5000`);
    await h.advance(3_000);
    assert.equal(h.pages[1], null, "paged again from where history was loaded");
    assert.deepEqual(h.delivered, [], "and everything up to the refused position is known to be old");

    await h.advance(10_000);
    assert.equal(h.pages.at(-1), `v:${S}:4999`, "the next look takes it up from just before that position");
    assert.deepEqual(h.cursors(), ["5001"]);
    assert.equal(h.tail.stats()[S]?.recovered, 1);
  });

  it("confirms a quiet turn against Muse's record instead of assuming it stalled", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    await h.advance(3_000);
    assert.deepEqual(h.confirmed, ["t1"], "an empty page is followed by asking Muse what is running");

    await h.advance(4_500);
    assert.deepEqual(h.confirmed, ["t1"], "but not on every page");
    for (let i = 0; i < 3; i += 1) {
      await h.advance(10_000);
    }
    assert.ok(h.confirmed.length >= 2, "a long quiet turn keeps being confirmed");
    assert.deepEqual(h.corrected, []);
  });

  it("ends a turn the view never ended, but only once Muse's record has said so twice", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.state.record = null;
    await h.advance(3_000);
    assert.deepEqual(h.corrected, [], "once could be the turn ending with its events one page away");
    await h.advance(3_000);
    assert.deepEqual(h.corrected, [null]);
    assert.deepEqual(h.confirmed, []);
  });

  it("does not correct a turn whose ending arrives on the next page", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.state.record = null;
    await h.advance(3_000);
    // The ending shows up in the view; whoever takes the delivery updates what is believed.
    h.view.push(ev("turn/completed", 1, { turnId: "t1" }));
    h.state.turn = null;
    await h.advance(3_000);
    assert.deepEqual(h.corrected, []);
    assert.deepEqual(
      h.delivered.map((e) => e.method),
      ["turn/completed"],
    );
  });

  it("says nothing when Muse's record cannot be read", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.state.record = undefined;
    await h.advance(3_000);
    await h.advance(20_000);
    assert.deepEqual(h.confirmed, []);
    assert.deepEqual(h.corrected, []);
  });

  it("does not page a session it has no position for, and stops once forgotten", async () => {
    const h = harness();
    assert.equal(h.tail.heard(S, { method: "session/statusChanged", params: { sessionId: S } }), true);
    await h.advance(60_000);
    assert.deepEqual(h.pages, [], "nowhere to page from");

    h.tail.anchor(S, null);
    h.tail.forget(S);
    await h.advance(60_000);
    assert.deepEqual(h.pages, []);
  });

  it("keeps a failed page from stopping the next one", async () => {
    const h = harness();
    h.tail.anchor(S, null);
    h.state.refuse.add(null);
    await h.advance(3_000);
    assert.equal(h.tail.stats()[S]?.failures, 1);
    h.state.refuse.clear();
    h.view.push(item(1));
    await h.advance(10_000);
    assert.deepEqual(h.cursors(), ["1"]);
  });
});

describe("ViewTail, switched off", () => {
  it("is off until it is switched on, and then passes every push on untouched", async () => {
    const h = harness({ on: false });
    h.view.push(item(1), item(2), item(3));
    h.tail.anchor(S, null);
    assert.equal(h.tail.heard(S, pushed(item(1))), true);
    assert.equal(h.tail.heard(S, pushed(item(3))), true);
    assert.equal(h.tail.heard(S, pushed(item(3))), true, "what Muse sends twice is passed on twice, as it always was");
    assert.equal(h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:3` })), true, "and a gap is passed on like anything else");
    assert.equal(h.tail.heard(S, ev("item/delta", "3.1", { itemId: "i4", delta: "x" })), true);
    assert.deepEqual(h.delivered, [], "nothing is delivered by the tail itself");
    assert.deepEqual(h.tail.stats(), {}, "and the gap is not counted, since nothing is kept");
  });

  it("never reads a session's record or pages its view", async () => {
    const h = harness({ on: false });
    h.view.push(item(1), item(2));
    h.tail.anchor(S, null);
    h.tail.heard(S, pushed(item(1)));
    h.tail.heard(S, ev("view/gap", "gap", { after: `v:${S}:1`, next: `v:${S}:2` }));
    h.tail.nudge(S);
    await h.advance(0);
    await h.advance(3_000);
    for (let i = 0; i < 20; i += 1) {
      await h.advance(60_000);
    }
    assert.equal(h.state.reads, 0);
    assert.deepEqual(h.pages, []);
    assert.deepEqual(h.delivered, []);
    assert.deepEqual(h.confirmed, []);
    assert.deepEqual(h.corrected, []);
  });

  it("starts following once switched on, from the next history load or pushed event and nothing earlier", async () => {
    const h = harness({ on: false });
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    assert.equal(h.tail.heard(S, pushed(item(1))), true);

    h.tail.setEnabled(true);
    h.view.push(item(2));
    await h.advance(60_000);
    assert.equal(h.state.reads, 0, "a load and a push from while it was off left it nowhere to page from");

    // The thread is loaded again, which is what the stalled notice's reload does.
    h.tail.anchor(S, `v:${S}:1`);
    assert.equal(h.tail.heard(S, pushed(item(1))), true, "the push from while it was off was not remembered, so its twin is no duplicate");
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`]);
    assert.deepEqual(h.cursors(), ["2"]);

    // A session with no load to go by is picked up from the first event pushed for it.
    h.tail.forget(S);
    assert.equal(h.tail.heard(S, pushed(item(2))), true);
    h.view.push(item(3));
    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`, `v:${S}:2`]);
    assert.deepEqual(h.cursors(), ["2", "3"]);
  });

  it("stops a look in flight when switched off, forgets its sessions, and hands over what it was holding", async () => {
    const h = harness();
    h.state.pageLimit = 1;
    h.view.push(item(1));
    h.tail.anchor(S, `v:${S}:1`);
    h.view.push(item(2), item(3));
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => (open = r));

    await h.advance(3_000);
    assert.deepEqual(h.pages, [`v:${S}:1`], "the first of several pages is on its way");
    // A push lands meanwhile and is held for the page, so the caller has not passed it on.
    assert.equal(h.tail.heard(S, pushed(item(4))), false);

    h.tail.setEnabled(false);
    assert.deepEqual(h.cursors(), ["4"], "the held push is handed over, not lost with the look it waited on");
    assert.deepEqual(h.tail.stats(), {});

    h.state.gate = null;
    open();
    await h.settle();
    assert.deepEqual(h.pages, [`v:${S}:1`], "the page in flight lands and no further one is asked for");
    assert.deepEqual(h.cursors(), ["4"], "and nothing it brought back is delivered");

    const reads = h.state.reads;
    assert.equal(h.tail.heard(S, pushed(item(2))), true, "pushes go straight through again");
    await h.advance(3_600_000);
    assert.equal(h.state.reads, reads);

    h.tail.setEnabled(true);
    await h.advance(3_600_000);
    assert.equal(h.state.reads, reads, "switched back on, it remembers none of what it followed");
    assert.deepEqual(h.tail.stats(), {});
  });
});
