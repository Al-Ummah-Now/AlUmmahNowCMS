/**
 * Key Arabic admin screens render formatted values (counts, dates, times, page numbers) in Eastern
 * Arabic (Hindi) numerals ٠–٩, never 0–9 (owner decision 2026-11-15, AlUmmahNow #1488 / #1496).
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ASCII = /[0-9]/;
const EASTERN = /[٠-٩]/;
const texts = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
/** What a reader sees: no scripts, styles, tags or attributes. */
const visible = (html: string) =>
   html
      .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

describe("Arabic admin numerals", () => {
   it("overview counts and the posts list (dates, result count) use Eastern Arabic (Hindi) numerals", async () => {
      const at = new Date(Date.UTC(2026, 10, 15, 14, 5)).toISOString();
      for (let i = 0; i < 12; i++) {
         await env.DB.prepare("INSERT INTO posts (slug, locale, title, body, status, kind, created_at, updated_at) VALUES (?1, 'ar', ?2, 'x', 'draft', 'article', ?3, ?3)")
            .bind(`digits-${i}`, `منشور ${"أبجدهوزحطيكل"[i]}`, at)
            .run();
      }
      const { callback } = await signIn(["Admin"], { id: "digits-ar", email: "digits-ar@example.com" });
      const cookie = `${cookiesOf(callback)}; cms_lang=ar`;
      const f = makeWorker();

      const overview = await (await f("/", { headers: { cookie } })).text();
      const stats = texts(overview, /<span class="stat-n">([\s\S]*?)<\/span>/g);
      expect(stats.length).toBeGreaterThan(0);
      for (const s of stats) {
         expect(s).toMatch(EASTERN);
         expect(s).not.toMatch(ASCII);
      }

      const list = await (await f("/posts", { headers: { cookie } })).text();
      // Everything a reader sees on the list (titles here have no digits; slugs are code and stay 0–9).
      const page = visible(list).replace(/\/articles\/[a-z0-9-]+/g, " ");
      expect(page).toMatch(EASTERN);
      expect(page.match(/\S*[0-9]\S*/g) ?? []).toEqual([]);
      // The result count line (e.g. «١٢ نتيجة») is there and formatted.
      expect(list).toMatch(/[٠-٩]+ نتيجة/);
   });
});
