/**
 * Telling the user something happened while they were looking elsewhere. The shell supplies the
 * notifier: a browser has the Notifications API, a desktop shell has whatever its OS ships. Nothing
 * here touches either, so the decision of what is worth announcing stays testable on its own.
 */

export type NotifyPermission = "granted" | "denied" | "default";

export interface Notifier {
  /** What the user has already decided, without asking them again. */
  permission(): Promise<NotifyPermission>;
  /** Asks once. Browsers only honour this from a real user gesture, which is why it is not automatic. */
  request(): Promise<NotifyPermission>;
  show(note: { title: string; body: string; tag: string }): Promise<void>;
}

export interface NotifySettings {
  /** The user's switch. Off means nothing is raised, whatever happens. */
  enabled: boolean;
  /** True while the window has their attention: there is nothing to tell someone who is watching. */
  focused: boolean;
}

/** Something that happened in a thread which might be worth interrupting someone for. */
export type NotifyEvent =
  | { kind: "approval"; sessionId: string; thread: string }
  | { kind: "question"; sessionId: string; thread: string }
  | { kind: "finished"; sessionId: string; thread: string; failed: boolean }
  | { kind: "goal"; sessionId: string; thread: string; status: string };

/** One thread flapping between states should not buzz over and over. */
const REPEAT_MS = 20_000;

function copy(event: NotifyEvent): { title: string; body: string } {
  switch (event.kind) {
    case "approval":
      return { title: "Muse is waiting on you", body: `${event.thread} wants to run something.` };
    case "question":
      return { title: "Muse asked a question", body: `${event.thread} is waiting for an answer.` };
    case "finished":
      return event.failed
        ? { title: "A turn failed", body: `${event.thread} stopped with an error.` }
        : { title: "Muse finished", body: `${event.thread} is done.` };
    case "goal":
      return event.status === "complete"
        ? { title: "Goal complete", body: `${event.thread} reached its goal.` }
        : { title: "A goal needs attention", body: `${event.thread} is ${event.status}.` };
  }
}

/**
 * Decides what actually reaches the user. Everything is dropped while the window is focused or the
 * switch is off, nothing is raised without permission already granted, and the same thread saying
 * the same thing twice in quick succession is said once.
 */
export class NotificationManager {
  private readonly shown = new Map<string, number>();

  constructor(
    private readonly notifier: Notifier,
    private readonly settings: () => NotifySettings,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async announce(event: NotifyEvent): Promise<void> {
    const { enabled, focused } = this.settings();
    if (!enabled || focused) {
      return;
    }
    // Never asks here: a browser only grants permission from a user gesture, so the settings page asks.
    if ((await this.notifier.permission()) !== "granted") {
      return;
    }
    const tag = `${event.kind}:${event.sessionId}`;
    const at = this.now();
    if (at - (this.shown.get(tag) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      return;
    }
    this.shown.set(tag, at);
    const { title, body } = copy(event);
    try {
      await this.notifier.show({ title, body, tag });
    } catch {
      // A notifier that refuses is not worth breaking a turn over.
    }
  }

  /** Lets a thread announce itself again, once the user has dealt with whatever it said. */
  forget(sessionId: string): void {
    for (const key of [...this.shown.keys()]) {
      if (key.endsWith(`:${sessionId}`)) {
        this.shown.delete(key);
      }
    }
  }
}
