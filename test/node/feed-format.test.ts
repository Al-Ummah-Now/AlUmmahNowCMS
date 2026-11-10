/**
 * The feed format bump rule (docs/FEED.md "Format version"): the stored feed's shape, read from the
 * TypeScript types, must match FEED_FORMAT_HISTORY[FEED_FORMAT]; the history is append-only.
 */
import { describe, expect, it } from "vitest";
import { FEED_FORMAT, FEED_FORMAT_HISTORY, headFormat } from "../../src/lib/feed/format.ts";
import { feedShape } from "../../scripts/lib/feed-shape.ts";
import { formatProblems, parseFormatFile } from "../../scripts/check-feed-format.ts";
import { deleteTokenSql, insertTokenSql, sha256Hex, waitCurrent, type FormatState } from "../../scripts/release/feed-format.ts";
import { readFileSync } from "node:fs";

describe("feed format", () => {
   it("the stored feed's shape matches FEED_FORMAT (bump it when the shape changes)", () => {
      const { shape, fingerprint } = feedShape();
      expect(shape).toContain("slides:"); // it really walks PostSummary
      expect(
         fingerprint,
         `The home timeline's stored shape changed (feed item, PostSummary, snapshot or head/week/year docs).\n` +
            `Bump FEED_FORMAT in src/lib/feed/format.ts to ${FEED_FORMAT + 1} and append  ${FEED_FORMAT + 1}: "${fingerprint}"  to FEED_FORMAT_HISTORY.\n` +
            `Every env then rebuilds its feed automatically after the deploy (docs/FEED.md "Format version"). Shape now:\n${shape}`,
      ).toBe(FEED_FORMAT_HISTORY[FEED_FORMAT]);
   }, 60_000);

   it("the history has exactly the entries 1..FEED_FORMAT, all different", () => {
      expect(Object.keys(FEED_FORMAT_HISTORY).map(Number)).toEqual(Array.from({ length: FEED_FORMAT }, (_, i) => i + 1));
      expect(new Set(Object.values(FEED_FORMAT_HISTORY)).size).toBe(FEED_FORMAT);
      expect(formatProblems(null, parseFormatFile(readFileSync("src/lib/feed/format.ts", "utf8")))).toEqual([]);
   });

   it("headFormat: a head from before formats is format 0", () => {
      expect(headFormat({ v: 1 })).toBe(0);
      expect(headFormat({ v: 1, format: 3 })).toBe(3);
      expect(headFormat(null)).toBe(0);
      expect(headFormat({ format: "2" })).toBe(0);
   });
});

describe("check-feed-format (append-only history)", () => {
   const file = (format: number, entries: Record<number, string>) =>
      `export const FEED_FORMAT = ${format};\nexport const FEED_FORMAT_HISTORY: Readonly<Record<number, string>> = {\n${Object.entries(entries)
         .map(([k, v]) => `   ${k}: "${v}",`)
         .join("\n")}\n};\n`;
   const base = parseFormatFile(file(1, { 1: "aaaa" }));

   it("a bump with a new entry passes", () => {
      expect(formatProblems(base, parseFormatFile(file(2, { 1: "aaaa", 2: "bbbb" })))).toEqual([]);
   });
   it("editing the current entry instead of bumping fails", () => {
      expect(formatProblems(base, parseFormatFile(file(1, { 1: "bbbb" })))).toEqual([expect.stringContaining("entry 1 was edited")]);
   });
   it("removing an entry, going down, or a gap fails", () => {
      expect(formatProblems(parseFormatFile(file(2, { 1: "aaaa", 2: "bbbb" })), parseFormatFile(file(1, { 1: "aaaa" })))).toEqual(
         expect.arrayContaining([expect.stringContaining("went down"), expect.stringContaining("entry 2 was removed")]),
      );
      expect(formatProblems(null, parseFormatFile(file(3, { 1: "aaaa", 3: "cccc" })))).toEqual([expect.stringContaining("exactly the entries 1..3")]);
   });
});

describe("release step (scripts/release/feed-format.ts)", () => {
   it("only interpolates a hex hash and an ISO date", () => {
      const h = sha256Hex("t");
      expect(insertTokenSql(h, new Date("2026-11-10T12:00:00.000Z"), new Date("2026-11-10T11:30:00.000Z"))).toBe(
         `INSERT INTO system_tokens (token_hash, purpose, expires_at, created_at) VALUES ('${h}', 'feed-format', '2026-11-10T12:00:00.000Z', '2026-11-10T11:30:00.000Z')`,
      );
      expect(() => insertTokenSql("x'; DROP TABLE posts; --", new Date())).toThrow();
      expect(() => deleteTokenSql("abc")).toThrow();
   });

   it("polls until current, or fails after the timeout", async () => {
      const s = (current: boolean): FormatState => ({
         code: 2,
         heads: { en: current ? 2 : 1, ar: 2 },
         built: current ? 2 : 1,
         rebuilding: !current,
         current,
      });
      let n = 0;
      let t = 0;
      const log: string[] = [];
      const done = await waitCurrent(async () => s(++n >= 3), {
         timeoutMs: 60_000,
         sleep: async (ms) => void (t += ms),
         now: () => t,
         log: (l) => log.push(l),
      });
      expect(done.current).toBe(true);
      expect(log[0]).toBe("code format 2; stored: en=1, ar=2, last full rebuild 1; rebuilding");
      t = 0;
      await expect(
         waitCurrent(async () => s(false), {
            timeoutMs: 30_000,
            sleep: async (ms) => void (t += ms),
            now: () => t,
         }),
      ).rejects.toThrow(/not in format 2 after 30 s/);
   });
});
