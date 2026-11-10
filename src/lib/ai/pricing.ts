/**
 * Estimated cost per call for the usage log (docs/AI_ASSIST_SPEC.md §5). USD per million tokens,
 * Anthropic first-party list prices (2026-10). Fallback models are listed so a server-side fallback
 * is priced as the model that answered. Unknown models are priced as Opus 5.5 (the most expensive we
 * call) so an estimate never under-reports.
 */
export interface Price {
   input: number;
   output: number;
   cacheRead: number;
   cacheWrite: number;
}

export const PRICES: Record<string, Price> = {
   "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
   "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
   "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
   "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
   "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export interface TokenCounts {
   input: number;
   output: number;
   cacheRead?: number;
   cacheWrite?: number;
}

export function costUsd(model: string, t: TokenCounts): number {
   const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
   const usd = (t.input * p.input + t.output * p.output + (t.cacheRead ?? 0) * p.cacheRead + (t.cacheWrite ?? 0) * p.cacheWrite) / 1_000_000;
   return Math.round(usd * 1_000_000) / 1_000_000;
}
