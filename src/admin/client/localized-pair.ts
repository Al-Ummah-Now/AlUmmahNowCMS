/**
 * The localized pair's behaviour (src/admin/ui/localized-pair.tsx, docs/LOCALIZED_FIELDS.md):
 *   - Translate under each side fills the OTHER side from it (POST /admin/api/translate). The text stays
 *     in the field for the editor to check; nothing is saved here (the screen saves).
 *   - Replacing text that was already there offers Undo in the pair's live status.
 *   - Qur'an is refused by the server; the status links to the official text.
 *   - validatePair(): both sides, or neither (required pairs: both); errors tied to the field.
 * Screens listen for "l10n:dirty" on the fieldset to know it has unsaved changes.
 */
import { $, $$, api, ApiError, el } from "./dom.ts";

type L = "en" | "ar";
interface S {
   /** The languages' names in the screen's language, for messages ("Arabic is required"). */
   nameEn: string;
   nameAr: string;
   translating: string;
   filled: string;
   replaced: string;
   undo: string;
   undone: string;
   typeFirst: string;
   required: string;
   quran: string;
   officialText: string;
   busy: string;
   dailyCap: string;
   unavailable: string;
   failed: string;
   notSaved: string;
}

const fmt = (s: string, ...a: (string | number)[]) => a.reduce<string>((out, v, i) => out.split(`{${i}}`).join(String(v)), s);
const other = (l: L): L => (l === "en" ? "ar" : "en");

function stringsOf(fs: HTMLElement): S {
   try {
      return JSON.parse(fs.dataset.l10nStrings || "{}") as S;
   } catch {
      return {} as S;
   }
}

export const pairInput = (fs: HTMLElement, l: L) => $<HTMLInputElement | HTMLTextAreaElement>(`[data-l10n-input="${l}"]`, fs)!;
const langName = (T: S, l: L) => (l === "en" ? T.nameEn : T.nameAr);

function status(fs: HTMLElement, text: string, kind: "ok" | "bad" = "ok", extra?: Node) {
   const st = $("[data-l10n-status]", fs);
   if (!st) return;
   st.classList.toggle("bad", kind === "bad");
   st.replaceChildren(text);
   if (extra) st.append(" ", extra);
}

export function setError(fs: HTMLElement, l: L, msg: string | null) {
   const input = pairInput(fs, l);
   const err = $<HTMLElement>(`[data-l10n-err="${l}"]`, fs);
   if (msg) input.setAttribute("aria-invalid", "true");
   else input.removeAttribute("aria-invalid");
   if (err) {
      err.textContent = msg ?? "";
      err.hidden = !msg;
   }
}

export function pairValues(fs: HTMLElement): Record<L, string> {
   return { en: pairInput(fs, "en").value.trim(), ar: pairInput(fs, "ar").value.trim() };
}

/** Both sides or neither (required pairs: both). Marks the empty side and focuses it; true when valid. */
export function validatePair(fs: HTMLElement): boolean {
   const T = stringsOf(fs);
   const v = pairValues(fs);
   const required = fs.dataset.l10nRequired === "1";
   let first: L | null = null;
   for (const l of ["en", "ar"] as const) {
      const bad = !v[l] && (required || !!v[other(l)]);
      setError(fs, l, bad ? fmt(T.required, langName(T, l)) : null);
      if (bad && !first) first = l;
   }
   if (first) pairInput(fs, first).focus();
   return !first;
}

function markDirty(fs: HTMLElement) {
   fs.classList.add("dirty");
   fs.dispatchEvent(new CustomEvent("l10n:dirty", { bubbles: true }));
}

/** Fills `to` from the other side. Resolves true when the field was filled. */
export async function translateInto(fs: HTMLElement, to: L, o: { quiet?: boolean } = {}): Promise<boolean> {
   const T = stringsOf(fs);
   const from = other(to);
   const src = pairInput(fs, from);
   const dst = pairInput(fs, to);
   const text = src.value.trim();
   if (!text) {
      setError(fs, from, fmt(T.typeFirst, langName(T, from)));
      if (!o.quiet) src.focus();
      return false;
   }
   setError(fs, from, null);
   const btn = $<HTMLButtonElement>(`[data-l10n-translate="${from}"]`, fs);
   if (btn) btn.disabled = true;
   fs.setAttribute("aria-busy", "true");
   status(fs, T.translating);
   try {
      const res = await api<{ text: string }>("POST", "/admin/api/translate", { text, from, to });
      const before = dst.value;
      dst.value = res.text;
      setError(fs, to, null);
      markDirty(fs);
      if (before.trim() && before !== res.text) {
         const undo = el("button", { type: "button", class: "btn ghost sm", "data-l10n-undo": "" }, T.undo);
         undo.addEventListener("click", () => {
            dst.value = before;
            status(fs, T.undone);
            dst.focus();
         });
         status(fs, fmt(T.replaced, langName(T, to), langName(T, from)), "ok", undo);
      } else status(fs, fmt(T.filled, langName(T, to), langName(T, from)));
      if (!o.quiet) dst.focus();
      return true;
   } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; quranUrl?: string; retryAfter?: number } | null) : null;
      const code = body?.error;
      if (code === "quran") {
         const a = el("a", { href: String(body?.quranUrl ?? "https://quran.com"), target: "_blank", rel: "noopener" }, T.officialText);
         status(fs, T.quran, "bad", a);
      } else if (code === "rate_limited") status(fs, fmt(T.busy, body?.retryAfter ?? 60), "bad");
      else if (code === "daily_cap") status(fs, T.dailyCap, "bad");
      else if (e instanceof ApiError && e.status === 503) status(fs, T.unavailable, "bad");
      else status(fs, T.failed, "bad");
      return false;
   } finally {
      if (btn) btn.disabled = false;
      fs.removeAttribute("aria-busy");
   }
}

export function initLocalizedPairs(root: ParentNode = document): void {
   for (const fs of $$<HTMLFieldSetElement>("[data-l10n-pair]", root)) {
      if (fs.dataset.l10nReady) continue;
      fs.dataset.l10nReady = "1";
      fs.addEventListener("click", (ev) => {
         const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-l10n-translate]");
         if (!b) return;
         void translateInto(fs, b.dataset.l10nTo === "en" ? "en" : "ar");
      });
      fs.addEventListener("input", (ev) => {
         const l = (ev.target as HTMLElement).dataset?.l10nInput as L | undefined;
         if (!l) return;
         markDirty(fs);
         if (pairInput(fs, l).value.trim()) setError(fs, l, null);
      });
   }
}
