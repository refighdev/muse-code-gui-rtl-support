/**
 * Follows a session's view by asking for it, for when Muse stops pushing it.
 *
 * Push delivery is best effort by the protocol's own account. A host may drop events and say so
 * with `view/gap`, and #42 found sessions whose push feed stops for good while the turn carries on
 * and the durable log completes. Either one used to leave a thread frozen on a spinner, and then
 * on a notice that it had stopped receiving updates. The view itself stays readable throughout:
 * `view/page` serves everything after a cursor, so a session that has gone quiet is paged from the
 * last event seen, and whatever comes back is delivered exactly as though it had been pushed.
 *
 * One thing a page says must not be taken at its word. While a turn is running, the view closes it
 * off as it would stand if the host died that instant: every open item `failed`, the turn `failed`,
 * each with the reason `incomplete`, at cursors the real events take over as they happen. That
 * ending is provisional, and reading it as real is how a turn that was fine came to be shown as
 * failed (#54). `withoutProvisionalEnding` removes it, here and from a history load alike.
 *
 * Following is a mode, off until it is switched on (`setEnabled`). A tail that is off does nothing
 * at all: every push is passed on as it arrived, nothing is remembered and Muse is asked nothing,
 * which is this server as it was before there was a tail. Removing the provisional ending from a
 * history load is not part of the mode; that happens either way.
 */

/** One view event, pushed or paged. `params` are as Muse sent them. */
export interface TailEvent {
  method: string;
  params: Record<string, unknown>;
  /** When Muse emitted it. Paged events carry no time. */
  at?: number;
}

export interface ViewTailTiming {
  /** How often every followed session is looked at. */
  tickMs: number;
  /** A busy session is paged once it has been quiet this long. */
  quietMs: number;
  /** The same, once paging has turned up events push never delivered. */
  suspectQuietMs: number;
  /** Pages that find nothing space themselves out, up to this, while something is in flight. */
  busyMaxMs: number;
  /** An idle session is still paged, in case a turn starts that nothing here was told about. */
  idleMs: number;
  idleMaxMs: number;
  /** How often clients are told that a quiet turn is confirmed still running. */
  statusMs: number;
  /** How long a command keeps its session on the busy cadence while its events are on their way. */
  hotMs: number;
  /**
   * How long an idle session goes on being looked at after it last showed any life. Past this it is
   * left alone until something happens, so a thread opened once is not asked about all day and Muse
   * is free to unload it.
   */
  idleFollowMs: number;
  /**
   * How long a look may go unanswered. Pushes are held while one is in flight, so past this it is
   * given up: they are passed on, and whatever Muse says to it afterwards is ignored.
   */
  lookMaxMs: number;
}

export const DEFAULT_TAIL_TIMING: ViewTailTiming = {
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

/** What Muse's own record of a session says, as opposed to what its view shows. */
export interface SessionRecordView {
  /** Where the view really ends; `null` when it is empty or Muse cannot say. */
  head: string | null;
  /** The turn that is running, if one is. */
  activeTurnId: string | null;
  /**
   * Something that differs whenever the session has moved on, for a record with no head to compare:
   * its update time. `null` when the record carries none, and then nothing is concluded from it.
   */
  stamp: string | null;
}

export interface ViewTailHooks {
  /** One forward page of the session's view after `cursor`; `null` pages from the start. */
  page(sessionId: string, cursor: string | null): Promise<{ events: unknown[]; nextCursor: string | null }>;
  /** Muse's own record of the session, read without a lease; `undefined` when it cannot be read. */
  read(sessionId: string): Promise<SessionRecordView | undefined>;
  /** Takes one event the push feed did not deliver, or one held back while a page was in flight. */
  deliver(sessionId: string, event: TailEvent): void;
  /** What this server believes about the session: whether anything is in flight, and which turn. */
  believed(sessionId: string): { busy: boolean; activeTurnId: string | null };
  /** Muse confirmed the believed turn is still running and has nothing new to show for it. */
  confirmed(sessionId: string, activeTurnId: string): void;
  /** Muse's record names another turn, or none, twice running, and the view holds no event saying why. */
  corrected(sessionId: string, activeTurnId: string | null): void;
  log(message: string): void;
  now?(): number;
}

/** What the tail has done for one session, for `/api/health`. */
export interface TailStats {
  polls: number;
  /**
   * Events paging delivered that push never did. Anything above zero is a push feed that lost events:
   * one whose push merely landed while the look was in flight is not counted.
   */
  recovered: number;
  lastRecoveredAt: number | null;
  gaps: number;
  failures: number;
  lastError: string | null;
  /** How long the last look took. One that has to page a large session can take seconds. */
  lastWalkMs: number;
}

/** Pages one pass may take. A session further behind than this catches up over the next passes. */
const MAX_PAGES = 25;
/** How many delivered events are remembered for discarding the overlap between push and page. */
const SEEN_LIMIT = 4096;
/** How fast empty pages space themselves out. */
const BACKOFF = 1.5;
/** A look is followed by at least this many times its own duration of rest, so a slow one cannot crowd the host. */
const REST_FACTOR = 3;
const UNREADABLE = "the session record could not be read";

interface Feed {
  /** Whether there is anywhere to page from yet. */
  known: boolean;
  /** The newest position seen, pushed or paged; `null` is the start of the view. */
  cursor: string | null;
  /**
   * The newest position a page handed out, which Muse is certain to accept as an anchor. `undefined`
   * until there is one, which is not the start of the view: that is `null`, as for `cursor`.
   */
  paged: string | null | undefined;
  seen: Set<string>;
  /** When the session was last heard from or looked at; what the next look is timed from. */
  heardAt: number;
  /** When it last showed life: an event, a command, a load. Looks do not count. */
  aliveAt: number;
  /** The record's stamp at the last look that read the view to its end, so an unchanged record needs no page. */
  settled: string | null;
  statusAt: number;
  hotUntil: number;
  /** Passes in a row that found nothing. */
  empty: number;
  /** Paging has delivered what push should have, and no push has arrived since. */
  suspect: boolean;
  /** Muse reported a hole in what it pushed, and no look has read the view to its end since. */
  gap: boolean;
  /** A hole was reported since the last look began, so the next one does not wait its turn. */
  urgent: boolean;
  walking: boolean;
  /** Which look is in flight, or was last. An answer to an earlier one is ignored. */
  look: number;
  /** When that look began. */
  began: number;
  /** Pushes that arrived while a pass was in flight, released after it in arrival order. */
  held: TailEvent[];
  /** Muse's record disagreed with this server once; a second time is acted on. */
  disagreed: { turn: string | null } | null;
  stats: TailStats;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function cursorOf(params: Record<string, unknown>): string | null {
  const cursor = params["viewCursor"];
  return typeof cursor === "string" ? cursor : null;
}

/**
 * What makes two frames the same event. The cursor alone is not enough: Muse stamps a status
 * change and the turn event beside it with one cursor, so the method and what it is about count too.
 * Cursors are only ever compared for equality, never ordered: they are opaque (tdd SS4.1).
 */
function keyOf(event: TailEvent): string | null {
  const cursor = cursorOf(event.params);
  if (cursor === null) {
    return null;
  }
  const item = asRecord(event.params["item"]);
  const about = item?.["itemId"] ?? event.params["itemId"] ?? event.params["turnId"] ?? "";
  return `${cursor} ${event.method} ${typeof about === "string" ? about : ""}`;
}

/**
 * Whether a pushed frame is one the view holds, and so somewhere to page from. Muse also pushes
 * frames the view never serves: streaming deltas, and status changes stamped with the cursor of
 * the turn event that follows them. Paging from one of those would step over that turn event if
 * it were the one push lost, so only a frame projected from the session's log moves the position.
 */
function isPaged(event: TailEvent): boolean {
  return typeof event.params["sourceRange"] === "object" && event.params["sourceRange"] !== null;
}

function isIncompleteItem(event: { method: string; params: Record<string, unknown> }): boolean {
  return event.method === "item/completed" && asRecord(event.params["item"])?.["reason"] === "incomplete";
}

/**
 * Removes the ending Muse's view lends a turn that has not ended.
 *
 * `head` is where the session's record says the view really stops, and when a page holds that
 * event everything after it goes: exact, and safe if real events landed after the record was read,
 * since those come round again. Without a usable head (a session whose projection is unavailable
 * reports none) the ending is recognised by what it is: a `failed`/`incomplete` close of a turn the
 * record says is running, and the `incomplete` item closes stacked before it. A turn Muse does not
 * say is running keeps its ending, because then it is what happened: a host that died mid-turn.
 */
export function withoutProvisionalEnding<T extends { method: string; params: Record<string, unknown> }>(
  events: T[],
  running: readonly (string | null | undefined)[],
  head: string | null | undefined,
): T[] {
  if (head) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.params["viewCursor"] === head) {
        return index === events.length - 1 ? events : events.slice(0, index + 1);
      }
    }
  }
  const last = events[events.length - 1];
  const closes =
    last !== undefined &&
    last.method === "turn/completed" &&
    last.params["reason"] === "incomplete" &&
    running.some((turn) => typeof turn === "string" && turn === last.params["turnId"]);
  if (!closes) {
    return events;
  }
  let end = events.length - 1;
  while (end > 0 && isIncompleteItem(events[end - 1] as T)) {
    end -= 1;
  }
  return events.slice(0, end);
}

/** Whether a page ends on a turn closed as `incomplete`, which is either provisional or a host that died. */
export function endsIncomplete(events: readonly { method: string; params: Record<string, unknown> }[]): boolean {
  const last = events[events.length - 1];
  return last !== undefined && last.method === "turn/completed" && last.params["reason"] === "incomplete";
}

function asEvent(value: unknown): TailEvent | null {
  const record = asRecord(value);
  const params = record ? asRecord(record["params"]) : null;
  return record && params && typeof record["method"] === "string" ? { method: record["method"], params } : null;
}

export class ViewTail {
  private readonly feeds = new Map<string, Feed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Whether sessions are followed at all. Off, every method below leaves things as it found them. */
  private enabled = false;

  constructor(
    private readonly hooks: ViewTailHooks,
    private readonly timing: ViewTailTiming = DEFAULT_TAIL_TIMING,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.timing.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.feeds.clear();
  }

  /**
   * Turns following on or off. Switched on, sessions are picked up as they are next heard from: a
   * history load or a pushed event. Switched off, everything being followed is let go, and a look
   * still in flight delivers nothing when it lands. Pushes held back for such a look were never
   * passed on, so they are handed over here, in the order they arrived, rather than lost.
   */
  setEnabled(on: boolean): void {
    if (this.enabled === on) {
      return;
    }
    this.enabled = on;
    if (on) {
      return;
    }
    const followed = [...this.feeds];
    this.feeds.clear();
    for (const [sessionId, feed] of followed) {
      for (const event of feed.held.splice(0)) {
        this.hooks.deliver(sessionId, event);
      }
    }
  }

  /**
   * Where a session's view stood when its history was read, so there is somewhere to page from
   * before the first push. Only a session not yet followed takes it: a tail already under way is
   * at least as far along as a point-in-time load, and jumping it forward would skip what the
   * load showed one window and no other. The load counts as life either way, so an idle session
   * somebody opened again is looked at again.
   */
  anchor(sessionId: string, cursor: string | null): void {
    if (!this.enabled) {
      return;
    }
    const feed = this.feedFor(sessionId);
    feed.aliveAt = this.now();
    if (feed.known) {
      return;
    }
    feed.known = true;
    feed.cursor = cursor;
    feed.paged = cursor;
    feed.heardAt = feed.aliveAt;
  }

  /** A command went to this session, so events are on their way: look for them soon. */
  nudge(sessionId: string): void {
    const feed = this.enabled ? this.feeds.get(sessionId) : undefined;
    if (feed) {
      feed.aliveAt = this.now();
      feed.hotUntil = feed.aliveAt + this.timing.hotMs;
      feed.empty = 0;
    }
  }

  forget(sessionId: string): void {
    this.feeds.delete(sessionId);
  }

  /**
   * One pushed notification. Answers whether to pass it on now: `false` for one already delivered
   * from a page, for one held until the page in flight lands, and for `view/gap`, which is an
   * instruction to this tail rather than something a thread shows. A tail that is off passes
   * everything on, `view/gap` included, and keeps no note of any of it.
   */
  heard(sessionId: string, event: TailEvent): boolean {
    if (!this.enabled) {
      return true;
    }
    const feed = this.feedFor(sessionId);
    if (event.method === "view/gap") {
      // Everything after `after` may be missing. Paging from there, with the overlap discarded,
      // covers the hole whether or not the frames past it have already arrived. A hole reported
      // while an earlier one is still unpaged begins further on, so the earlier start is kept.
      const after = event.params["after"];
      if (typeof after === "string" && !feed.gap) {
        feed.cursor = after;
        feed.known = true;
      }
      feed.gap = true;
      feed.urgent = true;
      feed.stats.gaps += 1;
      // Looked for now rather than at the next tick: every frame from here on is then held, and
      // comes out after the hole's events instead of ahead of them. No more often than the tick
      // would have, though: a host reporting gaps is under pressure as it is.
      if (!feed.walking && feed.known && this.now() - feed.began >= this.timing.tickMs) {
        void this.walk(sessionId, feed);
      }
      return false;
    }
    const key = keyOf(event);
    if (key !== null && feed.seen.has(key)) {
      return false;
    }
    if (feed.walking) {
      feed.held.push(event);
      return false;
    }
    this.accept(feed, event, key, isPaged(event));
    feed.heardAt = this.now();
    feed.aliveAt = feed.heardAt;
    feed.empty = 0;
    if (key !== null) {
      feed.suspect = false;
    }
    return true;
  }

  stats(): Record<string, TailStats & { suspect: boolean }> {
    const out: Record<string, TailStats & { suspect: boolean }> = {};
    for (const [sessionId, feed] of this.feeds) {
      if (feed.stats.polls > 0 || feed.stats.gaps > 0) {
        out[sessionId] = { ...feed.stats, suspect: feed.suspect };
      }
    }
    return out;
  }

  /** Looks at every followed session and pages the ones that are due. Exposed for tests. */
  tick(): void {
    if (!this.enabled) {
      return;
    }
    const now = this.now();
    for (const [sessionId, feed] of this.feeds) {
      if (feed.walking) {
        // Muse never promises an answer, and every push for the session waits on this one.
        if (now - feed.began >= this.timing.lookMaxMs) {
          this.abandon(sessionId, feed);
        }
        continue;
      }
      if (!feed.known) {
        continue;
      }
      const busy = this.hooks.believed(sessionId).busy || now < feed.hotUntil;
      if (!busy && !feed.gap && now - feed.aliveAt > this.timing.idleFollowMs) {
        // Left alone, and by now no late twin of anything delivered is still on its way.
        feed.seen.clear();
        continue;
      }
      const base = busy ? (feed.suspect ? this.timing.suspectQuietMs : this.timing.quietMs) : this.timing.idleMs;
      const cap = busy ? this.timing.busyMaxMs : this.timing.idleMaxMs;
      const spaced = Math.min(base * BACKOFF ** feed.empty, Math.max(base, cap));
      const wait = feed.urgent ? 0 : Math.max(spaced, feed.stats.lastWalkMs * REST_FACTOR);
      if (now - feed.heardAt >= wait) {
        void this.walk(sessionId, feed);
      }
    }
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  /**
   * Whether a look begun for this session is still wanted: not forgotten, nor the tail switched off,
   * nor the look given up as unanswered, meanwhile.
   */
  private follows(sessionId: string, feed: Feed, look: number): boolean {
    return this.feeds.get(sessionId) === feed && feed.look === look;
  }

  private feedFor(sessionId: string): Feed {
    let feed = this.feeds.get(sessionId);
    if (!feed) {
      feed = {
        known: false,
        cursor: null,
        paged: undefined,
        seen: new Set(),
        heardAt: this.now(),
        aliveAt: this.now(),
        settled: null,
        statusAt: 0,
        hotUntil: 0,
        empty: 0,
        suspect: false,
        gap: false,
        urgent: false,
        walking: false,
        look: 0,
        began: 0,
        held: [],
        disagreed: null,
        stats: { polls: 0, recovered: 0, lastRecoveredAt: null, gaps: 0, failures: 0, lastError: null, lastWalkMs: 0 },
      };
      this.feeds.set(sessionId, feed);
    }
    return feed;
  }

  /** Records an event as delivered and, when it marks a place in the view, moves the position to it. */
  private accept(feed: Feed, event: TailEvent, key: string | null, moves: boolean): void {
    if (key === null) {
      return;
    }
    feed.seen.add(key);
    if (feed.seen.size > SEEN_LIMIT) {
      const oldest = feed.seen.values().next();
      if (!oldest.done) {
        feed.seen.delete(oldest.value);
      }
    }
    // A reported gap moved the position back to before the hole; no push moves it on until that is paged.
    if (moves && !feed.gap) {
      feed.cursor = cursorOf(event.params);
      feed.known = true;
    }
  }

  /** Pages from the session's position to the head of its view and delivers what push did not. */
  private async walk(sessionId: string, feed: Feed): Promise<void> {
    feed.walking = true;
    feed.look += 1;
    feed.began = this.now();
    feed.urgent = false;
    feed.stats.polls += 1;
    // Taken before anything is awaited: a gap reported while Muse answers must not move where this
    // look starts, nor pass for the one it set out to cover.
    const look = feed.look;
    const from = feed.cursor;
    const hadGap = feed.gap;
    let ended = false;
    let paged: TailEvent[] = [];
    let reached: string | null = null;
    let failed = false;
    let record: SessionRecordView | undefined;
    // The position Muse would not page from, when the look had to begin further back instead.
    let refused: string | null = null;
    try {
      record = await this.hooks.read(sessionId);
      // Forgotten, switched off or given up while the answer was on its way: nothing more is asked of Muse.
      if (!this.follows(sessionId, feed, look)) {
        return;
      }
      if (!record) {
        // Without the record there is no telling a page's provisional ending from a real one.
        throw new Error(UNREADABLE);
      }
      let cursor = from;
      const atHead = record.head !== null && record.head === from;
      if (atHead) {
        // The head is a position Muse handed out itself, so it is one to fall back to from now on.
        feed.paged = from;
      }
      // The view really ends where this session already is, or the record has not moved since the
      // view was last read to its end: nothing to page, and no need to ask.
      const current = !hadGap && (atHead || (record.stamp !== null && record.stamp === feed.settled));
      ended = current;
      for (let page = 0; !current && page < MAX_PAGES; page += 1) {
        if (!this.follows(sessionId, feed, look)) {
          return;
        }
        let result: { events: unknown[]; nextCursor: string | null };
        try {
          result = await this.hooks.page(sessionId, cursor);
        } catch (error) {
          // A pushed position Muse will not page from. The last one a page handed out always works.
          // A session never paged has none, and the start of its view is no stand-in for one: that
          // would deliver its whole history over again.
          const fallback = feed.paged;
          if (page > 0 || fallback === undefined || cursor === fallback || !this.follows(sessionId, feed, look)) {
            throw error;
          }
          refused = cursor;
          cursor = fallback;
          result = await this.hooks.page(sessionId, cursor);
        }
        let last: string | null = null;
        for (const raw of result.events) {
          const event = asEvent(raw);
          if (event) {
            paged.push(event);
            last = cursorOf(event.params) ?? last;
          }
        }
        const next = last ?? result.nextCursor;
        if (!result.nextCursor || result.events.length === 0 || next === null || next === cursor) {
          ended = true;
          break;
        }
        cursor = next;
      }
      if (!this.follows(sessionId, feed, look)) {
        return;
      }
      if (refused !== null) {
        // Everything up to the refused position was passed on already, however long ago and whether
        // or not it is still remembered: only what follows it is news. Where the pages do not hold
        // it, the overlap is discarded from memory as usual.
        const position = refused;
        const at = paged.findIndex((event) => cursorOf(event.params) === position);
        if (at >= 0) {
          // The position before it is one a page handed out, and nearer than the last: a look that
          // ran out of pages on the way here begins the next one from it.
          const nearer = at > 0 ? cursorOf((paged[at - 1] as TailEvent).params) : null;
          if (nearer !== null) {
            feed.paged = nearer;
          }
          paged = paged.slice(at + 1);
        }
      }
      // The end of the view may be in hand, and with it the ending a running turn was lent. A turn
      // that started while the page was being read is caught by asking once more. Only what the
      // ending looks like counts then: a head read after the page can be a cursor the page filled
      // with a lent event.
      let settled = withoutProvisionalEnding(paged, [record.activeTurnId], record.head);
      if (settled.length === paged.length && endsIncomplete(paged)) {
        const after = await this.hooks.read(sessionId).catch(() => undefined);
        if (!this.follows(sessionId, feed, look)) {
          return;
        }
        if (after) {
          settled = withoutProvisionalEnding(paged, [after.activeTurnId], null);
        } else {
          // Nothing says whether the turn is running, so its ending is not taken at its word: it is
          // held back, the position stays before it, and the next look asks again.
          const turn = (paged[paged.length - 1] as TailEvent).params["turnId"];
          settled = withoutProvisionalEnding(paged, [typeof turn === "string" ? turn : null], null);
          failed = true;
          this.fail(feed, UNREADABLE);
        }
      }
      paged = settled;
      for (const event of paged) {
        reached = cursorOf(event.params) ?? reached;
      }
    } catch (error) {
      if (!this.follows(sessionId, feed, look)) {
        return;
      }
      failed = true;
      this.fail(feed, error instanceof Error ? error.message : String(error));
      if (refused !== null) {
        // Pages from further back are only news once the refused position has been found in them.
        paged = [];
      }
    }
    if (!this.follows(sessionId, feed, look)) {
      return;
    }
    // The record was read before the page, so a page that reached the end covers everything it describes.
    feed.settled = !failed && ended && record ? record.stamp : null;
    // That includes a reported hole, unless another was reported meanwhile. Until a look gets that
    // far the hole stays pending, so a look that failed is not the end of it.
    if (!failed && ended && !feed.urgent) {
      feed.gap = false;
    }
    if (reached !== null) {
      feed.paged = reached;
      // A gap reported mid-look may have moved the position back, to a hole behind where this look
      // began; the next look starts from there. Otherwise everything up to here is delivered.
      if (feed.cursor === from) {
        feed.cursor = reached;
      }
    }
    const delivered = this.handOver(sessionId, feed, paged);
    if (!failed && record && !delivered) {
      this.check(sessionId, feed, record);
    }
  }

  /**
   * Gives up on a look Muse has not answered. Nothing came of it, so the pushes held for it are
   * passed on as they arrived, and the session is looked at again in its turn.
   */
  private abandon(sessionId: string, feed: Feed): void {
    feed.look += 1;
    feed.settled = null;
    this.fail(feed, "the look went unanswered");
    this.handOver(sessionId, feed, []);
  }

  private fail(feed: Feed, reason: string): void {
    feed.stats.failures += 1;
    feed.stats.lastError = reason;
  }

  /**
   * Ends a look, and answers whether anything was delivered. The handover is synchronous: the paged
   * prefix, then whatever was pushed meanwhile, minus the overlap, with no await in between for a
   * live frame to slip ahead of the tail.
   */
  private handOver(sessionId: string, feed: Feed, paged: TailEvent[]): boolean {
    feed.stats.lastWalkMs = this.now() - feed.began;
    feed.walking = false;
    // A push held during the look is the twin of an event the page hands over first. Push did not
    // lose that one, so it is not counted against the feed.
    const twins = new Set<string>();
    for (const event of feed.held) {
      const key = keyOf(event);
      if (key !== null) {
        twins.add(key);
      }
    }
    let fresh = 0;
    let recovered = 0;
    for (const event of paged) {
      const key = keyOf(event);
      if (key !== null && feed.seen.has(key)) {
        continue;
      }
      this.accept(feed, event, key, false);
      this.hooks.deliver(sessionId, event);
      fresh += 1;
      if (key === null || !twins.has(key)) {
        recovered += 1;
      }
    }
    const held = feed.held.splice(0);
    let released = 0;
    for (const event of held) {
      const key = keyOf(event);
      if (key !== null && feed.seen.has(key)) {
        continue;
      }
      this.accept(feed, event, key, isPaged(event));
      this.hooks.deliver(sessionId, event);
      released += 1;
    }
    feed.heardAt = this.now();
    if (fresh > 0 || released > 0) {
      feed.aliveAt = feed.heardAt;
    }
    if (fresh > 0) {
      feed.disagreed = null;
    }
    if (recovered > 0) {
      feed.suspect = true;
      feed.stats.recovered += recovered;
      feed.stats.lastRecoveredAt = feed.heardAt;
    }
    feed.empty = fresh > 0 || released > 0 ? 0 : feed.empty + 1;
    return fresh > 0 || released > 0;
  }

  /**
   * A running turn with nothing new in its view is either working quietly or over without the view
   * saying so. Muse's own session record settles which. Agreement is passed on, so a quiet turn is
   * known to be alive rather than assumed to be; a disagreement that survives a second look is
   * passed on too, since nothing else will ever end a turn whose ending the view lost.
   */
  private check(sessionId: string, feed: Feed, record: SessionRecordView): void {
    const turn = this.hooks.believed(sessionId).activeTurnId;
    if (turn === null) {
      feed.disagreed = null;
      return;
    }
    if (record.activeTurnId === turn) {
      feed.disagreed = null;
      const now = this.now();
      if (now - feed.statusAt >= this.timing.statusMs) {
        feed.statusAt = now;
        this.hooks.confirmed(sessionId, turn);
      }
      return;
    }
    if (feed.disagreed && feed.disagreed.turn === record.activeTurnId) {
      feed.disagreed = null;
      this.hooks.log(`session ${sessionId}: the view never ended turn ${turn}; Muse's record says ${record.activeTurnId ?? "none is running"}`);
      this.hooks.corrected(sessionId, record.activeTurnId);
      return;
    }
    // Once can be the turn ending just after the page was read, with its events one pass away.
    feed.disagreed = { turn: record.activeTurnId };
    feed.empty = 0;
  }
}
