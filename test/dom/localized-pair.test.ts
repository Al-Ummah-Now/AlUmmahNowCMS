/**
 * The localized pair (src/admin/ui/localized-pair.tsx + client/localized-pair.ts): Translate fills the
 * other side and leaves it for review (no save), replacing text offers Undo, Qur'an refusal links the
 * official text, and validation marks the empty side with an error tied to its field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initLocalizedPairs, validatePair } from "../../src/admin/client/localized-pair.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { LocalizedPair } from "../../src/admin/ui/localized-pair.tsx";

const tick = () => new Promise((r) => setTimeout(r, 0));

function render(values: { en: string | null; ar: string | null }, lang: "en" | "ar" = "en") {
   const v = { t: ADMIN_STRINGS[lang] };
   document.body.innerHTML = String(LocalizedPair({ v, id: "p1", legend: "Title on the site", values, names: { en: "title_override", ar: "title_override_ar" }, max: 200 }));
   initLocalizedPairs();
   return document.querySelector<HTMLElement>("[data-l10n-pair]")!;
}
const input = (l: "en" | "ar") => document.querySelector<HTMLInputElement>(`[data-l10n-input="${l}"]`)!;
const status = () => document.querySelector<HTMLElement>("[data-l10n-status]")!;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
   fetchMock = vi.fn();
   vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("localized pair", () => {
   it("labels both sides with lang/dir and a Translate button each way", () => {
      render({ en: "", ar: "" });
      expect(input("en").getAttribute("lang")).toBe("en");
      expect(input("ar").getAttribute("dir")).toBe("rtl");
      expect(document.querySelector('[data-l10n-translate="en"]')!.textContent).toContain("Translate into Arabic");
      expect(document.querySelector('[data-l10n-translate="ar"]')!.textContent).toContain("Translate into English");
      expect(status().getAttribute("aria-live")).toBe("polite");
   });

   it("fills the empty side for review; replacing text offers Undo", async () => {
      const fs = render({ en: "Our talk", ar: "قديم" });
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "حديثنا" }), { status: 200, headers: { "content-type": "application/json" } }));
      document.querySelector<HTMLButtonElement>('[data-l10n-translate="en"]')!.click();
      await tick();
      await tick();
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ text: "Our talk", from: "en", to: "ar" });
      expect(input("ar").value).toBe("حديثنا");
      expect(fs.classList.contains("dirty")).toBe(true);
      const undo = status().querySelector<HTMLButtonElement>("[data-l10n-undo]")!;
      expect(undo.textContent).toBe("Undo");
      undo.click();
      expect(input("ar").value).toBe("قديم");
   });

   it("Qur'an: no text change, a link to the official text", async () => {
      render({ en: "", ar: "﴿ قل هو الله أحد ﴾" });
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "quran", quranUrl: "https://quran.com/search?q=x" }), { status: 422, headers: { "content-type": "application/json" } }));
      document.querySelector<HTMLButtonElement>('[data-l10n-translate="ar"]')!.click();
      await tick();
      await tick();
      expect(input("en").value).toBe("");
      expect(status().classList.contains("bad")).toBe(true);
      expect(status().querySelector("a")!.getAttribute("href")).toBe("https://quran.com/search?q=x");
   });

   it("both or neither: the empty side gets an error tied to it", () => {
      const fs = render({ en: "Only English", ar: "" });
      expect(validatePair(fs)).toBe(false);
      expect(input("ar").getAttribute("aria-invalid")).toBe("true");
      const err = document.getElementById(input("ar").getAttribute("aria-describedby")!.split(" ")[0])!;
      expect(err.hidden).toBe(false);
      expect(err.textContent).toBe("Arabic is required. Type it or use Translate.");
      input("ar").value = "إنجليزي فقط";
      expect(validatePair(fs)).toBe(true);
      expect(input("ar").hasAttribute("aria-invalid")).toBe(false);
   });
});
