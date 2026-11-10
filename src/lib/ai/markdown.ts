/**
 * Markdown helpers for translation (docs/AI_ASSIST_SPEC.md §1.1): split a long body into chunks at
 * blank lines outside code fences, and check that a translation kept the parts that must not change
 * (`::video[ID]` lines, URLs).
 */

export const CHUNK_MAX_CHARS = 12_000;

const FENCE = /^\s{0,3}(```|~~~)/;

/** Splits `body` into trimmed chunks of at most `max` characters (a single longer block is split by lines). Join with "\n\n". */
export function chunkMarkdown(body: string, max = CHUNK_MAX_CHARS): string[] {
   const text = body.replace(/\r\n?/g, "\n").trim();
   if (!text) return [];
   // Blocks: runs of lines separated by blank lines that are outside a fence.
   const blocks: string[] = [];
   let cur: string[] = [];
   let inFence = false;
   for (const line of text.split("\n")) {
      if (FENCE.test(line)) inFence = !inFence;
      if (!inFence && line.trim() === "") {
         if (cur.length) blocks.push(cur.join("\n"));
         cur = [];
         continue;
      }
      cur.push(line);
   }
   if (cur.length) blocks.push(cur.join("\n"));

   const pieces: string[] = [];
   for (const b of blocks) {
      if (b.length <= max) {
         pieces.push(b);
         continue;
      }
      // One oversized block (a huge list or fence): split by lines, never inside a line.
      let part = "";
      for (const line of b.split("\n")) {
         if (part && part.length + 1 + line.length > max) {
            pieces.push(part);
            part = line;
         } else part = part ? `${part}\n${line}` : line;
      }
      if (part) pieces.push(part);
   }

   const chunks: string[] = [];
   let acc = "";
   for (const p of pieces) {
      if (acc && acc.length + 2 + p.length > max) {
         chunks.push(acc);
         acc = p;
      } else acc = acc ? `${acc}\n\n${p}` : p;
   }
   if (acc) chunks.push(acc);
   return chunks;
}

export const VIDEO_LINE = /^::video\[([^\]\n]{1,80})\]\s*$/gm;
const URL_RE = /https?:\/\/[^\s)<>\]"']+/g;

export function videoIds(md: string): string[] {
   return [...md.matchAll(VIDEO_LINE)].map((m) => m[1]);
}

export function urls(md: string): string[] {
   return (md.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")).sort();
}

export type InvariantWarning = "videos_changed" | "links_changed";

/** What a translation changed that it should have kept. Empty = all kept. */
export function invariantWarnings(source: string, translated: string): InvariantWarning[] {
   const out: InvariantWarning[] = [];
   if (videoIds(source).join("\n") !== videoIds(translated).join("\n")) out.push("videos_changed");
   if (urls(source).join("\n") !== urls(translated).join("\n")) out.push("links_changed");
   return out;
}
