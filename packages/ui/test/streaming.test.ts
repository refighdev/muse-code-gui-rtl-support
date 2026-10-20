import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STREAM_SAMPLE_LIMIT, STREAM_WORD_LIMIT, streamRenderMode } from "../src/model/streaming.js";

describe("streaming render modes", () => {
  it("renders finished text as a still, whatever its size", () => {
    assert.equal(streamRenderMode(0, false), "static");
    assert.equal(streamRenderMode(STREAM_WORD_LIMIT, false), "static");
    assert.equal(streamRenderMode(STREAM_SAMPLE_LIMIT + 1_000_000, false), "static");
  });

  it("animates short streams per word", () => {
    assert.equal(streamRenderMode(0, true), "words");
    assert.equal(streamRenderMode(STREAM_WORD_LIMIT, true), "words");
  });

  it("renders medium streams plain, without per-word spans", () => {
    assert.equal(streamRenderMode(STREAM_WORD_LIMIT + 1, true), "plain");
    assert.equal(streamRenderMode(STREAM_SAMPLE_LIMIT, true), "plain");
  });

  it("samples huge streams so no flush costs a full re-parse", () => {
    assert.equal(streamRenderMode(STREAM_SAMPLE_LIMIT + 1, true), "sampled");
    assert.equal(streamRenderMode(5_000_000, true), "sampled");
  });
});
