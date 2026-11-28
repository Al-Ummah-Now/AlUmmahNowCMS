import { qafQuoteSpans } from "./model.ts";

/** Store literal quotations locally and give the model only opaque placeholders. */
export function guardQafTranslation(body: string) {
   const spans = qafQuoteSpans(body);
   if (!spans.length) return { body, markers: "", restore: (output: string) => output };
   let marker = "QAF_LITERAL_";
   while (body.includes(marker)) marker += "_";
   const quotes = spans.map(({ start, end }, i) => ({ token: `[${marker}${i}]`, body: body.slice(start, end) }));
   let cursor = 0;
   let redacted = "";
   for (const [i, span] of spans.entries()) {
      redacted += body.slice(cursor, span.start) + quotes[i].token;
      cursor = span.end;
   }
   return {
      body: redacted + body.slice(cursor),
      markers: "Keep each bracketed QAF_LITERAL_ placeholder exactly once on its own line, in the same order. It represents a quotation restored separately.",
      restore(output: string): string | null {
         let found = 0;
         const lines = output.split("\n").map((line) => {
            if (!line.includes(marker)) return line;
            const quote = quotes[found];
            if (!quote || line !== quote.token) return line;
            found++;
            return quote.body;
         });
         // A missing, altered, reordered or duplicated marker fails instead of changing a quote.
         return found === quotes.length && lines.every((line) => !line.includes(marker)) ? lines.join("\n") : null;
      },
   };
}
