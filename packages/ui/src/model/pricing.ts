/**
 * What a thread would have cost at API rates. Muse's own catalog carries a `cost` block, but today every
 * row comes back without one, so these published prices stand in. A catalog price always wins over this
 * table, which only fills the gap.
 *
 * Meta's rates, dollars per million tokens: ai.developer.meta.com/docs/pricing-rate-limits
 */
export interface TokenPrice {
  input: number;
  output: number;
  cached: number;
  currency: string;
}

const USD = "USD";

const PRICES: Record<string, TokenPrice> = {
  "muse-spark-1.1": { input: 1.25, output: 4.25, cached: 0.15, currency: USD },
  "muse-spark-1.2": { input: 1.25, output: 4.25, cached: 0.15, currency: USD },
  "muse-spark-1.3": { input: 1.25, output: 4.25, cached: 0.15, currency: USD },
  "muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cached: 0.002, currency: USD },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2, cached: 0.002, currency: USD },
  "muse-wonder-1.0": { input: 4, output: 20, cached: 0.2, currency: USD },
};

/** The published price for a model id, or null when none is known. Unknown minor versions fall back by family. */
export function listedPrice(modelId: string | null): TokenPrice | null {
  if (!modelId) {
    return null;
  }
  const exact = PRICES[modelId];
  if (exact) {
    return exact;
  }
  // Muse Wonder Full is subscription-only and Meta publishes no per-token rate for it; never price it as standard Wonder.
  if (/^muse-wonder-full-/i.test(modelId)) {
    return null;
  }
  const contributor = /contributor/i.test(modelId);
  const family = Object.keys(PRICES).find(
    (id) => /contributor/i.test(id) === contributor && modelId.startsWith(id.replace("-contributor", "").slice(0, 11)),
  );
  return family ? (PRICES[family] as TokenPrice) : null;
}

/** Dollars for one call's tokens, at a given price. */
export function costOf(
  price: TokenPrice,
  tokens: { promptTokens: number; outputTokens: number; cachedTokens?: number },
): number {
  const cached = Math.max(0, Math.min(tokens.cachedTokens ?? 0, tokens.promptTokens));
  const fresh = Math.max(0, tokens.promptTokens - cached);
  return (fresh * price.input + cached * price.cached + tokens.outputTokens * price.output) / 1_000_000;
}

/** Money as the transcript shows it: enough decimals to see a cheap turn, never more than four. */
export function formatCost(amount: number, currency = USD): string {
  const symbol = currency === USD ? "$" : `${currency} `;
  if (amount === 0) {
    return `${symbol}0`;
  }
  if (amount < 0.01) {
    return `${symbol}${amount.toFixed(4)}`;
  }
  if (amount < 1) {
    return `${symbol}${amount.toFixed(3)}`;
  }
  return `${symbol}${amount.toFixed(2)}`;
}
