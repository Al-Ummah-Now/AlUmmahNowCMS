import { cleanMarkdownAiText, isSafeAiLinkTarget } from "../ai/prompts.ts";

export type QafLocale = "en" | "ar";

export interface Passage {
   id: string;
   text: string;
   url: string;
   turathUrl: string;
   pages: { vol: string | null; page: number | null }[];
   book: { title: string; titleArabic: string };
   author: { name: string; nameArabic: string };
   footnotes?: string;
}
export interface ContextPassage extends Passage {
   before: Passage[];
   after: Passage[];
}
export type CatalogType = "author" | "book";
export interface Candidate {
   id: number | string;
   label: string;
   authorLabel?: string;
   deathYearAH: number | null;
   deathInexactLabel: string | null;
}

export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const QAF_WEEK_LIMIT = 2500;

/** Only link to the documented HTTPS readers. */
export function readerUrl(value: string, reader: "qaf" | "turath"): string | null {
   if (typeof value !== "string" || !isSafeAiLinkTarget(value) || value.includes("\\")) return null;
   try {
      const url = new URL(value);
      const host = reader === "qaf" ? "qaf.ai" : "app.turath.io";
      return url.origin === `https://${host}` && !url.username && !url.password ? url.href : null;
   } catch {
      return null;
   }
}

export function pageDigits(value: string | number, locale: QafLocale): string {
   return locale === "ar" ? String(value).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : String(value);
}

export function citation(passage: Passage, locale: QafLocale): string {
   const arabic = locale === "ar";
   const separator = arabic ? "، " : ", ";
   const book = arabic ? passage.book.titleArabic : passage.book.title;
   const author = arabic ? passage.author.nameArabic : passage.author.name;
   const pages = passage.pages.map(({ vol, page }) => [
      vol === null ? "" : `${arabic ? "ج" : "vol."} ${pageDigits(vol, locale)}`,
      page === null ? "" : `${arabic ? "ص" : "p."} ${pageDigits(page, locale)}`,
   ].filter(Boolean).join(separator)).filter(Boolean);
   return [`${book} — ${author}`, pages.join(arabic ? "؛ " : "; ")].filter(Boolean).join(separator);
}


export const QAF_QUOTE_OPEN = /^(~{3,})qaf-quote$/;

/** A literal Markdown fence keeps Qaf text inert in every Markdown renderer. */
export function citedQuotation(passage: Passage, locale: QafLocale): string | null {
   const url = readerUrl(passage.url, "qaf");
   if (!url) return null;
   let fenceLength = 3;
   for (const match of passage.text.matchAll(/~{3,}/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
   const fence = "~".repeat(fenceLength);
   const label = citation(passage, locale).replace(/\s+/gu, " ").replace(/[\\!*`_&~]/g, "\\$&")
      .replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
   const safeUrl = url.replace(/[()]/g, (c) => c === "(" ? "%28" : "%29");
   // Validate the Markdown citation; passage bytes stay inside the literal fence.
   const link = cleanMarkdownAiText(`[${label}](${safeUrl})`);
   return `${fence}qaf-quote\n${passage.text}\n${fence}\n\n${link}`;
}

/** Spans include the fence. Treat an unclosed quotation as protected through the end of the draft. */
export function qafQuoteSpans(body: string): { start: number; end: number }[] {
   const spans: { start: number; end: number }[] = [];
   let index = 0;
   let start = 0;
   let fence: string | undefined;
   for (const line of body.split("\n")) {
      if (!fence) {
         fence = QAF_QUOTE_OPEN.exec(line)?.[1];
         if (fence) start = index;
      } else if (line === fence) {
         spans.push({ start, end: index + line.length });
         fence = undefined;
      }
      index += line.length + 1;
   }
   if (fence) spans.push({ start, end: body.length });
   return spans;
}

export function withoutQafQuotes(body: string, start = 0, end = body.length): string {
   let cursor = start;
   let text = "";
   for (const span of qafQuoteSpans(body)) {
      if (span.end <= cursor || span.start >= end) continue;
      if (span.start > cursor) text += body.slice(cursor, span.start);
      cursor = span.end;
   }
   return text + (cursor < end ? body.slice(cursor, end) : "");
}
