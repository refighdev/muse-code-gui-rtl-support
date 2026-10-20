/**
 * Failures that leave a thread stuck rather than merely failing once. Each turn sends the whole thread, so a
 * piece of history the provider will not take fails every later turn the same way, however many times it is
 * retried. Compacting summarizes the history and drops the part that cannot be sent.
 */
export type StuckKind = "image" | "reasoning";
/**
 * Compacting drops what cannot be sent for some failures; for others only a new thread will do. `none` is
 * the case where nothing about the thread is wrong: the file just sent is the one the model could not read.
 */
export type StuckRemedy = "compact" | "fresh" | "none";

export interface StuckThread {
  kind: StuckKind;
  remedy: StuckRemedy;
  /** Said in place of the provider's own wording, which explains nothing about what to do. */
  message: string;
}

const PATTERNS: { kind: StuckKind; remedy: StuckRemedy; test: RegExp; message: string }[] = [
  {
    kind: "image",
    remedy: "compact",
    test: /invalid image data at input\[|payload could not be decoded/i,
    message:
      "An image earlier in this thread is unreadable to the model. Every turn sends the whole thread, so the next one fails the same way. Compacting summarizes what happened and leaves the image behind.",
  },
  {
    // Compacting keeps the recent turns as they are, reasoning included, so it does not clear this one.
    kind: "reasoning",
    remedy: "fresh",
    test: /provider-private history is incompatible|reasoning replay .* has no provider attribution/i,
    message:
      "This thread's stored reasoning belongs to the provider it ran on before, and cannot be replayed after the switch. Compacting will not clear it, because the recent turns are kept as they are. A new thread starts without that history.",
  },
];

/**
 * What is wrong with this thread's history, when a failure says a later turn cannot succeed either.
 *
 * `ownImages` says the failed turn carried images of its own. The provider words a rejected image exactly as
 * it words an unreadable one from earlier, and the difference matters: compacting a thread over the image
 * just sent would drop it and retry the prompt alone, quietly asking something else. Only images count:
 * any other file is written into the workspace and cannot cause an image-decoding failure.
 */
export function stuckThread(
  message: string | null | undefined,
  options: { ownImages?: boolean } = {},
): StuckThread | null {
  const text = message ?? "";
  const found = text ? PATTERNS.find((pattern) => pattern.test.test(text)) : undefined;
  if (!found) {
    return null;
  }
  if (found.kind === "image" && options.ownImages) {
    // Every request carries the whole thread, so a current image does not prove which one the model choked
    // on. Say both, and leave the thread's own repair available rather than pretending to know.
    return {
      kind: "image",
      remedy: "none",
      message:
        "The model could not read one of this thread's images. Most likely the one sent with this message: try it again as a PNG or JPEG. If it opens fine elsewhere, an older image in the thread is the unreadable one, and compacting leaves that behind.",
    };
  }
  return { kind: found.kind, remedy: found.remedy, message: found.message };
}

/**
 * A turn that failed because the muse CLI is signed out. `muse serve` starts fine without credentials, so this is
 * where a new user first finds out: the first turn fails with kind `authRequired` and "not logged in: run /login to
 * add an API key". `/login` is the terminal UI's command and means nothing in Muse Code GUI, so the turn says what to run.
 * The wording is matched too, for a host that reports the failure without a kind.
 * Opening a thread made under the `:auto-review` profile fails the same way: the host builds that profile's reviewer
 * from the stored credentials, so a signed-out host refuses the session with "the automated reviewer is unavailable".
 */
export function signedOut(error: { kind?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) {
    return false;
  }
  if (error.kind === "authRequired") {
    return true;
  }
  return /\bnot logged in\b|missing meta credentials|automated reviewer is unavailable/i.test(error.message ?? "");
}
