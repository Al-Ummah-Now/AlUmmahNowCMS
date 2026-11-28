/** The model can return a short Arabic query. Its output never becomes content or markup. */
export function suggestedQuery(raw: unknown): string | null {
   const query = (raw as { query?: unknown } | null)?.query;
   if (typeof query !== "string" || query.length > 200) return null;
   const text = query.replace(/<[^<>]*>/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[*_`#~\\[\]{}]/g, " ").replace(/\s+/gu, " ").trim();
   if (!/[\u0621-\u064A]/u.test(text) || !/^[\p{L}\p{M}\p{N} ،؟'-]+$/u.test(text) || text.split(" ").length > 12) return null;
   return text;
}
