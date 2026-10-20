import { PLACEHOLDER_TITLE } from "@musegui/daemon";

/** First meaningful line of the opening prompt, capped for the sidebar. */
export function deriveTitle(text: string): string | null {
  let line: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    // Skip code fences: a bare ``` line, a ```lang info line, or a fence
    // sharing its line with the start of the prompt. Inline code (one or
    // two backticks) is left alone.
    const fenceFree = raw.trim().replace(/^```[^\s]*\s*/, "");
    if (fenceFree.length > 0) {
      line = fenceFree;
      break;
    }
  }
  if (!line) {
    return null;
  }
  const clean = line.replace(/^[#>*\-\s]+/, "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return null;
  }
  if (clean.length <= 72) {
    return clean;
  }
  const cut = clean.slice(0, 72);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** How much of the opening prompt a title request may carry. */
export const TITLE_PROMPT_MAX_CHARS = 8_000;

const TRUNCATED = "\n[Content truncated]\n";

/** Keep the request and its final constraints when the text is too long. */
export function limitTitleText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget <= TRUNCATED.length) return "";
  const available = budget - TRUNCATED.length;
  const head = Math.ceil(available / 2);
  const tail = available - head;
  return `${text.slice(0, head)}${TRUNCATED}${tail > 0 ? text.slice(-tail) : ""}`;
}

const TITLE_PROMPT_HEAD = `Generate a title that will help the user recognize this Muse Code GUI thread weeks later.
Reply with ONLY the title text: no quotes, no JSON, no labels, no trailing punctuation.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3-8 words.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Name the product change, not the mock, plan, report, branch, or PR used to produce it.
- Models, subagents, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- Do not claim the work is complete.
- Do not copy and truncate the user's message.
- Avoid project names already visible in the UI, quotes, labels, and filler.`;

/**
 * The one-shot title prompt. It always leads with the fixed instruction so the
 * raw user text never sits first in argv, where a leading dash would read as a flag.
 */
export function buildThreadTitlePrompt(firstUserText: string): string {
  return `${TITLE_PROMPT_HEAD}\n\nUser message:\n${limitTitleText(firstUserText.trim(), TITLE_PROMPT_MAX_CHARS)}`;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * The final answer of `muse exec --json`: the last `run.terminal.completed`
 * text wins, concatenated `run.output.delta` chunks stand in when the
 * terminal record is missing, and anything that is not JSON is skipped.
 */
export function parseExecTitle(stdout: string): string | null {
  let terminal: string | null = null;
  let deltas = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const record = recordOf(event);
    const payload = record ? recordOf(record["payload"]) : null;
    if (!record || !payload) {
      continue;
    }
    const text = typeof payload["text"] === "string" ? payload["text"] : "";
    if (record["payload_type"] === "run.terminal.completed" || payload["kind"] === "run_terminal") {
      if (payload["terminal"] !== undefined && payload["terminal"] !== "completed") {
        continue;
      }
      if (text) {
        terminal = text;
      }
    } else if (record["payload_type"] === "run.output.delta" || payload["kind"] === "run_output_delta") {
      deltas += text;
    }
  }
  if (terminal) {
    return terminal;
  }
  return deltas ? deltas : null;
}

/** A derived title only counts when it honors the prompt's 3–8 words. */
function acceptTitle(candidate: string | null): string | null {
  if (!candidate || candidate === PLACEHOLDER_TITLE) {
    return null;
  }
  const words = candidate.split(/\s+/).filter(Boolean).length;
  return words >= 3 && words <= 8 ? candidate : null;
}

/**
 * A model answer into a sidebar title: unwrap JSON, drop a `Title:` label and
 * surrounding quotes, then cap like any other derived title. An out-of-range
 * answer falls back to the opening prompt, and null keeps whatever the
 * session already shows.
 */
export function sanitizeThreadTitle(raw: string, fallbackText: string): string | null {
  let text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const title = recordOf(JSON.parse(text))?.["title"];
      if (typeof title === "string") {
        text = title;
      }
    } catch {
      /* not JSON; treat the braces as literal text */
    }
  }
  text = text
    .trim()
    .replace(/^title\s*:\s*/i, "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  return acceptTitle(deriveTitle(text)) ?? acceptTitle(deriveTitle(fallbackText));
}
