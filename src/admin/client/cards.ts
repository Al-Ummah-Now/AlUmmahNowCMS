import { $, $$, api } from "./dom.ts";

type Job = { id: string; status: string };
type Preview = { html: string; width: number; height: number };

function displayPreview(host: HTMLElement, preview: Preview) {
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
   if (!document.querySelector("[data-card-fonts]")) {
      const fonts = document.createElement("style");
      fonts.dataset.cardFonts = "";
      fonts.textContent = styles.match(/@font-face[^}]+}/g)?.join("\n") ?? "";
      document.head.append(fonts);
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
   const text = canvas.querySelector("blockquote");
   if (!text) return;
   void Promise.all([document.fonts.load("32px Amiri", "ع"), document.fonts.load("32px SourceSerif", "A")]).then(() => {
      for (let size = 76; size >= 22; size -= 2) {
         text.style.fontSize = `${size}px`;
         if (text.scrollHeight <= text.clientHeight) break;
      }
   });
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
   const reset = () => { draft = null; publish.disabled = true; host.hidden = true; status.textContent = ""; };
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
      if (!response.ok) throw new Error("Card request failed");
      return response.json();
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
         displayPreview(host, await request(`${endpoint}/preview`, payload) as Preview);
         draft = payload;
      } catch {
         status.textContent = translate("Could not preview the card. Check the source and try again.", "تعذّرت معاينة البطاقة. تحقّق من المصدر وحاول مجددًا.");
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
