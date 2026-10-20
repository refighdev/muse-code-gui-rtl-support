import { spawnMspConnection } from "@muse-code/sdk";
import type { CommandConnection } from "./sessions.js";

export type SpawnMspConnection = typeof spawnMspConnection;
export type MspHandshake = Awaited<ReturnType<SpawnMspConnection>>;
export type MspSession = Awaited<ReturnType<MspHandshake["initialize"]>>;

export interface ServeTarget {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface ServeExit {
  code: number | null;
  signal: string | null;
}

export const MUSEGUI_CLIENT_NAME = "musegui";
export const SDK_TIER_OFF_EXIT_CODE = 5;

export type ServeExitClass = "clean" | "sdk-tier-off" | "signalled" | "error";

export function classifyServeExit(code: number | null): ServeExitClass {
  if (code === 0) {
    return "clean";
  }
  if (code === SDK_TIER_OFF_EXIT_CODE) {
    return "sdk-tier-off";
  }
  if (code === null) {
    return "signalled";
  }
  return "error";
}

export function serveExitMessage(exitClass: ServeExitClass): string {
  switch (exitClass) {
    case "clean":
      return "The Muse host exited cleanly.";
    case "sdk-tier-off":
      return "This Muse build has its experimental SDK tier switched off, so no invocation of that binary will serve. Upgrade the CLI or use a build with MSP serving enabled.";
    case "signalled":
      return "The Muse host was killed by a signal before it reported an exit code.";
    case "error":
      return "The Muse host exited with an error. Check that you are logged in (muse login) and that the workspace is readable.";
  }
}

const STDERR_TAIL_LINES = 12;

export class MuseGuiMspHost {
  private handshake: MspHandshake | null = null;
  private msp: MspSession | null = null;
  private stderrTail: string[] = [];
  private exitHandlers: ((exit: ServeExit) => void)[] = [];
  private closing = false;

  constructor(
    private readonly target: ServeTarget,
    private readonly spawnFn: SpawnMspConnection = spawnMspConnection,
    private readonly onStderr: (chunk: string) => void = () => {},
  ) {}

  async start(
    clientVersion: string,
  ): Promise<{ initializeResult: unknown; fingerprintWarning: unknown }> {
    const onStderr = this.onStderr;
    this.handshake = this.spawnFn({
      command: this.target.command,
      args: this.target.args,
      cwd: this.target.cwd,
      env: this.target.env,
      onStderr: (chunk: unknown) => {
        const text = String(chunk);
        this.rememberStderr(text);
        onStderr(text);
      },
    } as Parameters<SpawnMspConnection>[0]);
    try {
      this.msp = await this.handshake.initialize({
        clientInfo: { name: MUSEGUI_CLIENT_NAME, version: clientVersion },
        // `!` commands in the composer run through session/userShell, which the host grants per connection.
        capabilities: { requestedCapabilities: ["userShell"] },
      });
    } catch (error) {
      const tail = this.stderrTail.join("\n").trim();
      throw new Error(tail ? `${String(error)}\n${tail}` : String(error));
    }
    const exited = (this.msp as { exited?: Promise<ServeExit> }).exited;
    if (exited) {
      void exited.then(
        (exit) => this.notifyExit({ code: exit.code, signal: exit.signal }),
        () => this.notifyExit({ code: null, signal: null }),
      );
    }
    return {
      initializeResult: this.msp.initializeResult,
      fingerprintWarning: this.msp.fingerprintWarning ?? null,
    };
  }

  get connection(): CommandConnection {
    if (!this.msp) {
      throw new Error("MuseGuiMspHost: call start() before using the connection.");
    }
    return this.msp.connection as unknown as CommandConnection;
  }

  /** Last lines the host wrote to stderr, for surfacing a crash to the user. */
  get recentStderr(): string {
    return this.stderrTail.join("\n").trim();
  }

  /** Called once when the host process ends for any reason other than our own close(). */
  onExit(handler: (exit: ServeExit) => void): void {
    this.exitHandlers.push(handler);
  }

  async close(): Promise<ServeExit> {
    if (!this.msp) {
      throw new Error("MuseGuiMspHost: call start() before close().");
    }
    this.closing = true;
    const exit = await this.msp.close();
    return { code: exit.code, signal: exit.signal };
  }

  private notifyExit(exit: ServeExit): void {
    if (this.closing) {
      return;
    }
    for (const handler of this.exitHandlers) {
      handler(exit);
    }
  }

  private rememberStderr(text: string): void {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    this.stderrTail.push(...lines);
    if (this.stderrTail.length > STDERR_TAIL_LINES) {
      this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_LINES);
    }
  }
}
