import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildThreadTitlePrompt,
  limitTitleText,
  parseExecTitle,
  sanitizeThreadTitle,
  TITLE_PROMPT_MAX_CHARS,
} from "../src/threadTitles.js";

describe("limitTitleText", () => {
  it("passes short text through untouched", () => {
    assert.equal(limitTitleText("Fix login", 100), "Fix login");
  });

  it("keeps the head and tail around a marker", () => {
    const text = `${"a".repeat(100)}${"b".repeat(100)}`;
    const limited = limitTitleText(text, 100);
    assert.equal(limited.length, 100);
    assert.match(limited, /a+\n\[Content truncated\]\nb+/);
  });

  it("gives up when the budget cannot hold the marker", () => {
    assert.equal(limitTitleText("Fix login", 3), "");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("leads with the fixed instruction and carries the message", () => {
    const prompt = buildThreadTitlePrompt("Fix login redirect");
    assert.match(prompt, /^Generate a title/);
    assert.match(prompt, /Reply with ONLY the title text/);
    assert.match(prompt, /User message:\nFix login redirect$/);
  });

  it("caps a long message", () => {
    const prompt = buildThreadTitlePrompt("x".repeat(TITLE_PROMPT_MAX_CHARS + 500));
    assert.match(prompt, /\[Content truncated\]/);
    assert.ok(prompt.length < TITLE_PROMPT_MAX_CHARS + 2000);
  });

  it("never lets user text sit first, even when it looks like a flag", () => {
    const prompt = buildThreadTitlePrompt("--model evil\nFix login");
    assert.match(prompt, /^Generate a title/);
    assert.match(prompt, /--model evil/);
  });
});

describe("parseExecTitle", () => {
  const terminal = (text: string, terminal = "completed") =>
    JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal, text } });
  const delta = (text: string) =>
    JSON.stringify({ payload_type: "run.output.delta", payload: { kind: "run_output_delta", text } });

  it("takes the terminal text out of a full event stream", () => {
    const stdout = [
      "muse: workspace root: /tmp (cwd default)",
      JSON.stringify({ payload_type: "run.lifecycle.started", payload: { kind: "run_started" } }),
      delta("Fix log"),
      delta("in redirect"),
      terminal("Fix login redirect"),
      "not json at all",
    ].join("\n");
    assert.equal(parseExecTitle(stdout), "Fix login redirect");
  });

  it("prefers the last terminal record", () => {
    const stdout = [terminal("First guess"), terminal("Second guess")].join("\n");
    assert.equal(parseExecTitle(stdout), "Second guess");
  });

  it("concatenates deltas when the terminal record is missing", () => {
    const stdout = [delta("Fix log"), delta("in redirect")].join("\n");
    assert.equal(parseExecTitle(stdout), "Fix login redirect");
  });

  it("ignores a terminal record that did not complete", () => {
    const stdout = [terminal("aborted", "failed"), delta("Fix login")].join("\n");
    assert.equal(parseExecTitle(stdout), "Fix login");
  });

  it("returns null when nothing carries text", () => {
    assert.equal(parseExecTitle(""), null);
    assert.equal(parseExecTitle("muse: something broke\n{not json"), null);
    assert.equal(parseExecTitle(JSON.stringify({ payload_type: "run.lifecycle.started", payload: {} })), null);
  });
});

describe("sanitizeThreadTitle", () => {
  it("keeps a plain answer", () => {
    assert.equal(sanitizeThreadTitle("Fix login redirect", "fallback"), "Fix login redirect");
  });

  it("strips quotes, labels, and JSON wrappers", () => {
    assert.equal(sanitizeThreadTitle('"Fix login redirect"', "fallback"), "Fix login redirect");
    assert.equal(sanitizeThreadTitle("Title: Fix login redirect", "fallback"), "Fix login redirect");
    assert.equal(sanitizeThreadTitle('{"title": "Fix login redirect"}', "fallback"), "Fix login redirect");
  });

  it("rejects answers outside 3–8 words in favor of the prompt", () => {
    assert.equal(
      sanitizeThreadTitle("Fix login", "Repair the broken login redirect"),
      "Repair the broken login redirect",
    );
    assert.equal(
      sanitizeThreadTitle(
        "Refactor the session manager so that queries never mint command ids and paging works for long threads",
        "Add dark mode",
      ),
      "Add dark mode",
    );
  });

  it("falls back to the opening prompt on empty or placeholder answers", () => {
    assert.equal(sanitizeThreadTitle("", "Fix login redirect"), "Fix login redirect");
    assert.equal(sanitizeThreadTitle("New thread", "Fix login redirect"), "Fix login redirect");
    assert.equal(sanitizeThreadTitle("   ", "Fix login redirect"), "Fix login redirect");
  });

  it("returns null when neither answer nor prompt yields a title", () => {
    assert.equal(sanitizeThreadTitle("", "   "), null);
    assert.equal(sanitizeThreadTitle("New thread", "New thread"), null);
    assert.equal(sanitizeThreadTitle("Fix login", "Do it"), null);
  });
});
