import { $, $$, api } from "./dom.ts";

type Job = { id: string; status: string };
type CardDocument = { html: string; width: number; height: number };
type Preview = { pages: string[]; width: number; height: number };

function displayPreview(host: HTMLElement, preview: CardDocument) {
   const doc = new DOMParser().parseFromString(preview.html, "text/html");
   const style = doc.querySelector("style");
   const main = doc.querySelector("main");
   if (!style || !main) throw new Error("Invalid card preview");
   const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
   const canvas = document.createElement("div");
   canvas.style.cssText = `width:${preview.width}px;height:${preview.height}px;transform-origin:top left;position:absolute;left:0;top:0;font-family:SourceSerif,Amiri,serif`;
   canvas.append(main);
   const css = document.createElement("style");
   const styles = style.textContent ?? "";
   for (const rule of styles.matchAll(/@font-face\s*{\s*font-family:(\w+);[^}]+}/g)) {
      const family = rule[1];
      if (document.querySelector(`[data-card-font="${family}"]`)) continue;
      const font = document.createElement("style");
      font.dataset.cardFont = family;
      font.textContent = rule[0];
      document.head.append(font);
   }
   css.textContent = styles.replace(/@font-face[^}]+}/g, "").replace("html {", ":host {");
   canvas.dir = doc.documentElement.dir;
   canvas.lang = doc.documentElement.lang;
   root.replaceChildren(css, canvas);
   host.hidden = false;
   host.style.aspectRatio = `${preview.width}/${preview.height}`;
   const resize = new ResizeObserver(([entry]) => {
      if (canvas.isConnected) canvas.style.transform = `scale(${entry.contentRect.width / preview.width})`;
      else resize.disconnect();
   });
   resize.observe(host);

}

export function initDesignedCards() {
   const panel = $<HTMLElement>("[data-designed-cards]");
   if (!panel) return;
   const endpoint = "/admin/api/cards";
   const lang = document.documentElement.lang === "ar" ? "ar" : "en";
   const translate = (en: string, ar: string) => lang === "ar" ? ar : en;
   const field = (name: string) => $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-card-${name}]`, panel)!;
   const status = $<HTMLElement>("[data-card-status]", panel)!;
   const host = $<HTMLElement>("[data-card-preview]", panel)!;
   const publish = $<HTMLButtonElement>("[data-card-action=publish]", panel)!;
   const preview = $<HTMLButtonElement>("[data-card-action=preview]", panel)!;
   let passageId = "";
   let draft: object | null = null;
   const reset = () => { draft = null; publish.disabled = true; host.hidden = true; host.style.display = "none"; status.textContent = ""; };
   for (const event of ["change", "input"]) panel.addEventListener(event, reset);
   field("kind").addEventListener("change", () => {
      for (const source of $$<HTMLElement>("[data-card-source]", panel)) source.hidden = source.dataset.cardSource !== field("kind").value;
   });
   panel.addEventListener("card-passage", (event) => {
      const passage = (event as CustomEvent<{ id: string; title: string }>).detail;
      passageId = passage.id;
      $<HTMLElement>("[data-card-passage]", panel)!.textContent = passage.title;
      reset();
   });

   const request = (url: string, body?: object) => fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
   }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) {
         if (result?.error === "card_slide_limit" && Number.isInteger(result.limit)) {
            const count = new Intl.NumberFormat(lang === "ar" ? "ar-u-nu-arab" : "en", { useGrouping: false }).format(result.limit);
            throw new RangeError(translate(`This passage needs more than ${count} cards. Choose a shorter passage.`, `يحتاج هذا المقطع إلى أكثر من ${count} بطاقة. اختر مقطعًا أقصر.`));
         }
         throw new Error("Card request failed");
      }
      return result;
   });

   const number = (name: string) => Number(field(name).value.replace(/[٠-٩۰-۹]/gu, (digit) => String(digit.charCodeAt(0) & 15)));
   const disable = (busy: boolean) => {
      for (const input of $$<HTMLInputElement>("input, select, textarea, button", panel)) input.disabled = busy;
      publish.disabled = busy || !draft;
   };
   preview.addEventListener("click", async () => {
      reset();
      const kind = field("kind").value;
      const source = kind === "quran" ? { kind, surah: number("surah"), ayah: number("ayah") } : kind === "qaf" ? { kind, passageId } : { kind, text: field("message").value };
      const payload = {
         id: crypto.randomUUID(), source, locale: $<HTMLElement>("form[data-editor]")?.dataset.locale ?? lang,
         design: { template: field("template").value, palette: number("palette"), format: field("format").value },
      };
      disable(true);
      try {
         const result = await request(`${endpoint}/preview`, payload) as Preview;
         host.style.cssText = "display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory";
         host.replaceChildren(...result.pages.map((html) => {
            const tile = document.createElement("div");
            tile.style.cssText = "position:relative;overflow:hidden;flex:0 0 100%;scroll-snap-align:start";
            host.append(tile);
            displayPreview(tile, { html, width: result.width, height: result.height });
            return tile;
         }));
         host.hidden = false;
         draft = payload;
      } catch (error) {
         status.textContent = error instanceof RangeError ? error.message : translate("Could not preview the card. Check the source and try again.", "تعذّرت معاينة البطاقة. تحقّق من المصدر وحاول مجددًا.");
      } finally {
         disable(false);
      }
   });
   publish.addEventListener("click", async () => {
      if (!draft) return;
      disable(true);
      status.textContent = translate("Publishing card…", "جارٍ نشر البطاقة…");
      try {
         let job = await request(`${endpoint}/publish`, draft) as Job;
         const deadline = Date.now() + 90_000;
         while (!["failed", "cancelled", "succeeded"].includes(job.status) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            job = await request(`${endpoint}/status?job=${encodeURIComponent(job.id)}`) as Job;
         }
         if (job.status !== "succeeded") throw new Error("Card publish did not finish");
         reset();
         status.textContent = translate("Card published to the community.", "نُشرت البطاقة في المجتمع.");
      } catch {
         status.textContent = translate("Could not finish publishing the card.", "تعذّر إكمال نشر البطاقة.");
      } finally {
         disable(false);
      }
   });
   void api<{ enabled: boolean }>("GET", `${endpoint}/availability`).then(({ enabled }) => { panel.hidden = !enabled; }).catch(() => {});
}
