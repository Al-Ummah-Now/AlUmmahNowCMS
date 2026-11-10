/**
 * AI writing assist in the editor (docs/AI_ASSIST_SPEC.md §1, §8): start a job, poll it, show the
 * suggestion. Nothing here saves content except "Create … draft" (always status draft), and no
 * suggestion is applied without a click. Also the Overview's "dismiss" for failed jobs (admins).
 */
import { $, $$, api, ApiError, el, strings, toast } from "./dom.ts";
import { AiFailure, aiErrorText, type AiErrorStrings } from "./ai-errors.ts";

interface AiStrings extends AiErrorStrings {
   translating: string;
   suggesting: string;
   checking: string;
   filled: string;
   warnings: string;
   copied: string;
   nothing: string;
   suggestion: string;
   verify: string;
   severity: Record<"info" | "warn" | "high", string>;
   categories: Record<string, string>;
   saveFirst: string;
}

type Feature = "translate" | "seo" | "check";

interface Job {
   id: string;
   feature: Feature;
   kind: "pages" | "posts";
   targetLocale: "en" | "ar" | null;
   status: "queued" | "running" | "done" | "failed";
   result: unknown;
   error: string | null;
}

interface Translation {
   title: string;
   summary: string;
   body: string;
   locale: "en" | "ar";
   warnings: string[];
}
interface Seo {
   seo_title: string;
   seo_description: string;
   social_summary: string;
}
interface Check {
   summary: string;
   tone: { quote: string; note: string; suggestion: string }[];
   claims: { quote: string; why: string; verify: string }[];
   policy: { category: string; severity: "info" | "warn" | "high"; quote: string; note: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(payload: Record<string, unknown>): Promise<Job> {
   let { job } = await api<{ job: Job }>("POST", "/admin/api/ai/jobs", payload);
   const started = Date.now();
   while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 25 * 60 * 1000) throw new AiFailure("timeout");
      await sleep(Date.now() - started < 20_000 ? 1500 : 3000);
      ({ job } = await api<{ job: Job }>("GET", `/admin/api/ai/jobs/${encodeURIComponent(job.id)}`));
   }
   if (job.status === "failed") throw new AiFailure(job.error ?? "failed");
   return job;
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
   if (!input) return;
   input.value = value;
   input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function initAiFailures(): void {
   for (const btn of $$<HTMLButtonElement>("[data-ai-dismiss]")) {
      btn.addEventListener("click", async () => {
         btn.disabled = true;
         try {
            await api("POST", `/admin/api/ai/failures/${encodeURIComponent(btn.dataset.aiDismiss!)}/dismiss`);
            const card = btn.closest("[data-ai-failures]");
            btn.closest("li")?.remove();
            if (card && !$("li", card)) card.remove();
         } catch {
            btn.disabled = false;
         }
      });
   }
}

export function initAi(): void {
   initAiFailures();
   const form = $<HTMLFormElement>("form[data-editor]");
   if (!form || form.dataset.ai !== "1") return;
   const T = strings<{ ai: AiStrings }>().ai;
   const kind = form.dataset.editor as "pages" | "posts";
   const id = form.dataset.id || "";
   const locale = form.dataset.locale as "en" | "ar";
   const ui = (form.dataset.uiLang as "en" | "ar") || "en";
   const title = $<HTMLInputElement>("#f-title", form)!;
   const summary = $<HTMLTextAreaElement>("#f-summary", form)!;
   const body = $<HTMLTextAreaElement>("#f-body", form)!;
   const slug = $<HTMLInputElement>("#f-slug", form)!;

   const payload = (feature: Feature) => ({
      feature,
      kind,
      id: id || null,
      locale,
      ui,
      fields: { title: title.value, summary: summary.value, body: body.value },
   });

   /** Runs `feature` with the button busy and a live status line; returns the job or null (error shown). */
   async function withStatus(feature: Feature, btn: HTMLButtonElement, working: string): Promise<Job | null> {
      const status = $(`[data-ai-status="${feature}"]`);
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      if (status) {
         status.classList.remove("err");
         status.replaceChildren(el("span", { class: "ai-spin", "aria-hidden": "true" }), working);
      }
      try {
         const job = await runJob(payload(feature));
         if (status) status.textContent = "";
         return job;
      } catch (e) {
         const msg = aiErrorText(T, e);
         if (status) {
            status.textContent = msg;
            status.classList.add("err");
         }
         toast(msg, "bad");
         return null;
      } finally {
         btn.disabled = false;
         btn.removeAttribute("aria-busy");
      }
   }

   // ---- Translate ----
   const trDlg = $<HTMLDialogElement>("#ai-translate");
   const trTitle = $<HTMLInputElement>("#ai-tr-title");
   const trSummary = $<HTMLTextAreaElement>("#ai-tr-summary");
   const trBody = $<HTMLTextAreaElement>("#ai-tr-body");
   const trCreate = $<HTMLButtonElement>("[data-ai-tr-create]");
   const trFill = $<HTMLButtonElement>("[data-ai-tr-fill]");
   const trBtn = $<HTMLButtonElement>("[data-ai-translate]");
   let trJob: Job | null = null;
   trBtn?.addEventListener("click", async () => {
      const job = await withStatus("translate", trBtn, T.translating);
      if (!job || !trDlg) return;
      trJob = job;
      const r = job.result as Translation;
      trTitle!.value = r.title;
      trSummary!.value = r.summary;
      trBody!.value = r.body;
      $("[data-ai-tr-warn]", trDlg)!.hidden = !(r.warnings?.length > 0);
      const sibling = trBtn.dataset.sibling || "";
      trFill!.hidden = !sibling;
      trCreate!.hidden = !!sibling || !id;
      $("[data-ai-tr-savefirst]", trDlg)!.hidden = !!sibling || !!id;
      trDlg.showModal();
   });
   trFill?.addEventListener("click", () => {
      if (!trJob) return;
      location.assign(`/${kind}/${trBtn!.dataset.sibling}?ai=${encodeURIComponent(trJob.id)}`);
   });
   trCreate?.addEventListener("click", async () => {
      if (!trJob || !id) return;
      const other = trBtn!.dataset.target as "en" | "ar";
      trCreate.disabled = true;
      try {
         let key = form.dataset.translationKey || "";
         if (!key) {
            key = crypto.randomUUID();
            await api("PATCH", `/api/data/entity/${kind}/${id}`, { translation_key: key });
            form.dataset.translationKey = key;
         }
         const row = {
            locale: other,
            title: trTitle!.value.trim() || title.value.trim(),
            [kind === "pages" ? "summary" : "excerpt"]: trSummary!.value.trim(),
            body: trBody!.value,
            translation_key: key,
            status: "draft", // never published by the AI
         };
         const create = (s: string) => api<{ data: { id: number } }>("POST", `/api/data/entity/${kind}`, { ...row, slug: s });
         let created;
         try {
            created = await create(slug.value.trim());
         } catch (e) {
            // The slug is unique per locale; the other language may already use it for another row.
            if (!(e instanceof ApiError) || e.status >= 500) throw e;
            created = await create(`${slug.value.trim()}-${other}`.slice(0, 120));
         }
         location.assign(`/${kind}/${created.data.id}?done=created`);
      } catch (e) {
         toast(aiErrorText(T, e), "bad");
         trCreate.disabled = false;
      }
   });

   // Arriving with ?ai=<job>: fill this (sibling) form from a translation, as unsaved changes.
   const url = new URL(location.href);
   const fromJob = url.searchParams.get("ai");
   if (fromJob) {
      url.searchParams.delete("ai");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      api<{ job: Job }>("GET", `/admin/api/ai/jobs/${encodeURIComponent(fromJob)}`)
         .then(({ job }) => {
            if (job.status !== "done" || job.feature !== "translate" || job.targetLocale !== locale) return;
            const r = job.result as Translation;
            setValue(title, r.title);
            setValue(summary, r.summary);
            setValue(body, r.body);
            toast(r.warnings?.length ? `${T.filled} ${T.warnings}` : T.filled);
            title.focus();
         })
         .catch((e) => toast(aiErrorText(T, e), "bad"));
   }

   // ---- SEO ----
   const seoBtn = $<HTMLButtonElement>("[data-ai-seo]");
   const panel = $("[data-ai-seo-panel]");
   seoBtn?.addEventListener("click", async () => {
      const job = await withStatus("seo", seoBtn, T.suggesting);
      if (!job || !panel) return;
      const r = job.result as Seo;
      setValue($<HTMLTextAreaElement>("#ai-seo_title"), r.seo_title);
      setValue($<HTMLTextAreaElement>("#ai-seo_description"), r.seo_description);
      setValue($<HTMLTextAreaElement>("#ai-social_summary"), r.social_summary);
      panel.hidden = false;
      $<HTMLTextAreaElement>("#ai-seo_title")?.focus();
   });
   const use = (btn: HTMLButtonElement) => {
      const from = document.getElementById(btn.dataset.from!) as HTMLTextAreaElement | null;
      setValue(document.getElementById(btn.dataset.use!) as HTMLInputElement | null, from?.value.trim() ?? "");
   };
   for (const b of $$<HTMLButtonElement>("[data-use]")) b.addEventListener("click", () => use(b));
   $("[data-use-all]")?.addEventListener("click", () => {
      for (const b of $$<HTMLButtonElement>("[data-use]")) use(b);
      $<HTMLInputElement>("#f-seo-title")?.focus();
   });
   $("[data-ai-seo-discard]")?.addEventListener("click", () => {
      if (panel) panel.hidden = true;
      seoBtn?.focus();
   });
   for (const b of $$<HTMLButtonElement>("[data-copy]")) {
      b.addEventListener("click", async () => {
         const from = document.getElementById(b.dataset.copy!) as HTMLTextAreaElement | null;
         try {
            await navigator.clipboard.writeText(from?.value ?? "");
            toast(T.copied);
         } catch {
            from?.select();
         }
      });
   }

   // ---- Check ----
   const ckBtn = $<HTMLButtonElement>("[data-ai-check]");
   const ckDlg = $<HTMLDialogElement>("#ai-check");
   ckBtn?.addEventListener("click", async () => {
      const job = await withStatus("check", ckBtn, T.checking);
      if (!job || !ckDlg) return;
      const r = job.result as Check;
      $("[data-ai-ck-summary]", ckDlg)!.textContent = r.summary;
      const quote = (q: string) => el("blockquote", { class: "ai-quote", lang: locale, dir: "auto" }, q);
      const fill = (key: string, items: HTMLElement[]) => {
         const list = $(`[data-ai-ck="${key}"]`, ckDlg)!;
         list.replaceChildren(...(items.length ? items : [el("li", { class: "muted" }, T.nothing)]));
      };
      fill(
         "tone",
         r.tone.map((t) => el("li", { class: "ai-item" }, quote(t.quote), el("p", { dir: "auto" }, t.note), el("p", { class: "help" }, `${T.suggestion}: `, el("span", { lang: locale, dir: "auto" }, t.suggestion)))),
      );
      fill(
         "claims",
         r.claims.map((t) => el("li", { class: "ai-item" }, quote(t.quote), el("p", { dir: "auto" }, t.why), el("p", { class: "help" }, `${T.verify}: `, el("span", { dir: "auto" }, t.verify)))),
      );
      fill(
         "policy",
         r.policy.map((t) =>
            el(
               "li",
               { class: "ai-item" },
               el("p", { class: "ai-item-h" }, el("span", { class: `badge sev-${t.severity}` }, T.severity[t.severity]), el("strong", {}, T.categories[t.category] ?? t.category)),
               quote(t.quote),
               el("p", { dir: "auto" }, t.note),
            ),
         ),
      );
      ckDlg.showModal();
   });
}
