import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { costOf, formatCost, listedPrice } from "../src/model/pricing.js";

describe("pricing", () => {
  it("prices the contributor tier apart from the model it mirrors", () => {
    assert.deepEqual(listedPrice("muse-spark-1.3"), { input: 1.25, output: 4.25, cached: 0.15, currency: "USD" });
    assert.deepEqual(listedPrice("muse-spark-1.3-contributor"), { input: 0.1, output: 0.2, cached: 0.002, currency: "USD" });
    assert.equal(listedPrice("muse-spark-9.9")?.input, 1.25, "an unlisted version falls back to its family");
    assert.equal(listedPrice("muse-spark-9.9-contributor")?.output, 0.2);
    assert.equal(listedPrice("some-other-model"), null);
    assert.equal(listedPrice(null), null);
  });

  it("prices Muse Wonder at the published rate and leaves Wonder Full unpriced", () => {
    assert.deepEqual(listedPrice("muse-wonder-1.0"), { input: 4, output: 20, cached: 0.2, currency: "USD" });
    assert.equal(listedPrice("muse-wonder-9.9")?.input, 4, "an unlisted Wonder version falls back to its family");
    assert.equal(listedPrice("muse-wonder-1.0-contributor"), null, "Meta publishes no Contributor rate for Muse Wonder");
    assert.equal(listedPrice("muse-wonder-full-1.0"), null, "Muse Wonder Full is subscription-only, with no per-token rate");
    assert.equal(listedPrice("muse-wonder-full-1.0-contributor"), null);
    assert.equal(listedPrice("muse-wonder-full-9.9"), null);
  });

  it("counts cached prompt tokens at the cached rate", () => {
    const price = listedPrice("muse-spark-1.3");
    assert.ok(price);
    assert.equal(costOf(price, { promptTokens: 1_000_000, outputTokens: 0 }), 1.25);
    assert.equal(costOf(price, { promptTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 }), 0.15);
    assert.equal(costOf(price, { promptTokens: 0, outputTokens: 1_000_000 }), 4.25);
    assert.equal(costOf(price, { promptTokens: 100, outputTokens: 0, cachedTokens: 500 }), 0.15 * 100 / 1_000_000, "cached never exceeds the prompt");
  });

  it("shows a cheap turn without rounding it away", () => {
    assert.equal(formatCost(0), "$0");
    assert.equal(formatCost(0.00123), "$0.0012");
    assert.equal(formatCost(0.4321), "$0.432");
    assert.equal(formatCost(12.3456), "$12.35");
  });
});
