/**
 * Cost of a call for the usage log (docs/AI_ASSIST_SPEC.md §5). Workers AI bills in Neurons at
 * $0.011 per 1,000 above the account's free 10,000 Neurons a day (developers.cloudflare.com/workers-ai/platform/pricing,
 * 2026-11-10). The binding reports the Neurons of each call; when it doesn't, they are estimated from
 * the token counts with the catalogue rates below. Unknown models are priced at the most expensive
 * rate we list, so an estimate never under-reports.
 */
export const USD_PER_1000_NEURONS = 0.011;

/** Neurons per million tokens. */
export interface Rate {
   input: number;
   cached: number;
   output: number;
}

export const RATES: Record<string, Rate> = {
   "@cf/deepseek-ai/deepseek-v4.1-flash-1017": { input: 27_273, cached: 545, output: 109_091 },
   "@cf/openai/gpt-oss-120b": { input: 31_818, cached: 31_818, output: 68_182 },
};

const MAX_RATE: Rate = { input: 31_818, cached: 31_818, output: 109_091 };

export interface TokenCounts {
   input: number;
   output: number;
   cached?: number;
}

export function estimateNeurons(model: string, t: TokenCounts): number {
   const r = RATES[model] ?? MAX_RATE;
   const cached = Math.min(t.cached ?? 0, t.input);
   const n = ((t.input - cached) * r.input + cached * r.cached + t.output * r.output) / 1_000_000;
   return Math.round(n * 1000) / 1000;
}

export function neuronsToUsd(neurons: number): number {
   return Math.round(((neurons * USD_PER_1000_NEURONS) / 1000) * 1e8) / 1e8;
}
