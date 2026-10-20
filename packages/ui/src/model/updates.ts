/**
 * App updates for the desktop shell. The shell supplies an `AppUpdater` (Tauri's updater plugin);
 * a browser has none, so none of this runs there.
 */

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  date: string | null;
}

export interface AppUpdater {
  currentVersion(): Promise<string>;
  /** Asks the release feed for a newer version. */
  check(): Promise<AvailableUpdate | null>;
  /** Downloads the update the last check found. `fraction` runs from 0 to 1 when the size is known. */
  download(onProgress: (fraction: number | null) => void): Promise<void>;
  /** Installs the downloaded update. On Windows the app quits and the installer takes over; `restart` reopens Muse Code GUI after. */
  install(options: { restart: boolean }): Promise<void>;
  /** Reopens the app, for platforms where installing does not. */
  relaunch(): Promise<void>;
  /** Runs `handler` as the window closes, before it goes. Returns an unsubscribe. */
  onClose(handler: () => Promise<void>): () => void;
}

export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  update: AvailableUpdate | null;
  /** Download progress from 0 to 1, when the size is known. */
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
}

export const NO_UPDATE: UpdateState = { status: "idle", currentVersion: null, update: null, progress: null, error: null, checkedAt: null };

export interface UpdateSettings {
  /** Download new versions as they appear, and install them when the app closes. */
  autoUpdate: boolean;
  /** No checking, downloading or installing until resumed. */
  paused: boolean;
}

const FIRST_CHECK_MS = 5_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "Something went wrong.";
}

/** Tauri throws this when latest.json exists but this OS is not in it yet (Windows publishes first). */
export function isMissingPlatformFeed(error: unknown): boolean {
  return /fallback platforms/i.test(messageOf(error));
}

export class UpdateManager {
  private state: UpdateState = NO_UPDATE;
  private queue: Promise<void> = Promise.resolve();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopClose: (() => void) | null = null;

  constructor(
    private readonly updater: AppUpdater,
    private readonly settings: () => UpdateSettings,
    private readonly publish: (state: UpdateState) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get current(): UpdateState {
    return this.state;
  }

  /** Reads the running version, installs on close when one is due, and checks soon after launch and every six hours. */
  start(schedule = true): void {
    this.updater.currentVersion().then(
      (version) => this.set({ currentVersion: version }),
      () => undefined,
    );
    this.stopClose = this.updater.onClose(() => this.installOnClose());
    if (schedule) {
      this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_MS));
      this.timers.push(setInterval(() => void this.check(), RECHECK_MS));
    }
  }

  stop(): void {
    for (const timer of this.timers.splice(0)) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.stopClose?.();
    this.stopClose = null;
  }

  /** Looks for a new version. Scheduled checks skip while paused; asking directly always checks. */
  check(manual = false): Promise<void> {
    return this.run(async () => {
      const { paused } = this.settings();
      const busy = this.state.status === "downloading" || this.state.status === "ready" || this.state.status === "installing";
      if ((paused && !manual) || busy) {
        return;
      }
      this.set({ status: "checking", error: null });
      let update: AvailableUpdate | null;
      try {
        update = await this.updater.check();
      } catch (error) {
        if (isMissingPlatformFeed(error)) {
          this.set({ status: "upToDate", update: null, error: null, checkedAt: this.now() });
          return;
        }
        this.set({ status: "error", error: messageOf(error), checkedAt: this.now() });
        return;
      }
      this.set({ status: update ? "available" : "upToDate", update, progress: null, checkedAt: this.now() });
      const settings = this.settings();
      if (update && settings.autoUpdate && !settings.paused) {
        await this.fetch();
      }
    });
  }

  /** Downloads the available update now, whether or not updates are automatic. */
  download(): Promise<void> {
    return this.run(() => this.fetch());
  }

  /** Installs the downloaded update and reopens Muse Code GUI on the new version. */
  restart(): Promise<void> {
    return this.run(async () => {
      if (this.state.status !== "ready") {
        return;
      }
      this.set({ status: "installing", error: null });
      try {
        await this.updater.install({ restart: true });
        await this.updater.relaunch();
      } catch (error) {
        this.set({ status: "ready", error: messageOf(error) });
      }
    });
  }

  private async fetch(): Promise<void> {
    if (this.state.status !== "available") {
      return;
    }
    this.set({ status: "downloading", progress: 0, error: null });
    try {
      await this.updater.download((fraction) => this.set({ progress: fraction }));
      this.set({ status: "ready", progress: 1 });
    } catch (error) {
      // Still available: the menu offers the download again.
      this.set({ status: "available", progress: null, error: messageOf(error) });
    }
  }

  /** A downloaded update installs as the app closes, when updates are automatic and not paused. */
  private async installOnClose(): Promise<void> {
    const { autoUpdate, paused } = this.settings();
    if (this.state.status !== "ready" || !autoUpdate || paused) {
      return;
    }
    this.set({ status: "installing" });
    try {
      await this.updater.install({ restart: false });
    } catch {
      // The window closes regardless; the next launch finds the update again.
    }
  }

  /** One task at a time, so a check never races a download. */
  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
}
