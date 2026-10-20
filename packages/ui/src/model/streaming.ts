/**
 * How streaming text renders. A flush lands about every 24ms while a turn runs, and each one
 * re-parses the streaming text from scratch, so an unbounded stream is quadratic work: a 500KB
 * reply costs ~130ms a flush in plain markdown and ~500ms with per-word spans, which buries the
 * UI thread faster than React can drain it and the thread hangs for good. Past the limits below
 * a stream renders plain, then from a throttled snapshot, and the full text still lands on
 * completion.
 */

/** Per-word streaming animation only below this many characters; beyond it words mount plain. */
export const STREAM_WORD_LIMIT = 10_000;

/** Streaming text beyond this many characters renders from a throttled snapshot. */
export const STREAM_SAMPLE_LIMIT = 30_000;

/** How often a huge streaming text re-renders, in milliseconds. */
export const STREAM_SAMPLE_MS = 500;

export type StreamRenderMode = "static" | "words" | "plain" | "sampled";

/** Which rendering a text gets: stills and short streams animate per word, huge streams sample. */
export function streamRenderMode(textLength: number, streaming: boolean): StreamRenderMode {
  if (!streaming) {
    return "static";
  }
  if (textLength <= STREAM_WORD_LIMIT) {
    return "words";
  }
  if (textLength <= STREAM_SAMPLE_LIMIT) {
    return "plain";
  }
  return "sampled";
}
