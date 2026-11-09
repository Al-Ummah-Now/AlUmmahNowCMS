/**
 * Video picker (SPEC §5): an SSO-gated page plus a server-side proxy to the public videos API.
 * Picking creates a `curated_videos` row (draft or published) with a snapshot taken server-side.
 */
import { Hono } from "hono";
import { embedUrl } from "../lib/embeds.ts";
import { esc, page } from "../lib/html.ts";
import { pickLang, STRINGS, type Lang } from "../lib/i18n.ts";
import { lookupItem, searchVideos, VIDEO_KINDS, type VideoKind } from "../lib/videos.ts";
import type { AppEnv, Deps } from "../types.ts";

const CSS = `
form.search{display:grid;grid-template-columns:minmax(8rem,12rem) 1fr auto;gap:.75rem;align-items:end}
@media (max-width:40rem){form.search{grid-template-columns:1fr}}
label{display:block;font-weight:600;margin-bottom:.25rem}
input,select{font:inherit;width:100%;padding:.5rem;border:1px solid var(--border);border-radius:.375rem;min-height:44px;background:var(--bg);color:var(--fg)}
.hint{color:var(--muted);font-size:.875rem;margin:.25rem 0 0}
ul.results,ul.current{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}
ul.results li,ul.current li{display:flex;gap:.75rem;align-items:center;border:1px solid var(--border);border-radius:.5rem;padding:.5rem}
ul.results img,ul.current img{width:96px;height:54px;object-fit:cover;border-radius:.25rem;background:var(--panel);flex:none}
.grow{flex:1;min-width:0}
.meta{color:var(--muted);font-size:.875rem}
section{margin-top:2rem}
fieldset{border:1px solid var(--border);border-radius:.5rem;padding:1rem;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))}
legend{font-weight:700;padding:0 .25rem}
.status{min-height:1.5rem;margin:.5rem 0}
.status.error{color:var(--danger)}
.status.ok{color:var(--ok)}
iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:.5rem;background:var(--panel)}
.badge{display:inline-block;font-size:.75rem;border:1px solid var(--border);border-radius:1rem;padding:0 .5rem;margin-inline-start:.5rem}
`;

interface CurrentRow {
   id: number;
   kind: string;
   ref_id: string;
   placement: string;
   locale: string | null;
   title_override: string | null;
   status: string;
   sort: number | null;
   snapshot: string | null;
}

function pickerHtml(o: { lang: Lang; nonce: string; current: CurrentRow[]; isAdmin: boolean }): string {
   const t = STRINGS[o.lang].picker;
   const s = STRINGS[o.lang];
   const other: Lang = o.lang === "ar" ? "en" : "ar";
   const current = o.current.length
      ? `<ul class="current">${o.current
           .map((r) => {
              let snap: { title?: string; thumbnail_url?: string | null } = {};
              try {
                 snap = r.snapshot ? JSON.parse(r.snapshot) : {};
              } catch {
                 /* display only */
              }
              const title = r.title_override || snap.title || r.ref_id;
              const kind = (t.kinds as Record<string, string>)[r.kind] ?? r.kind;
              const placement = (t.placements as Record<string, string>)[r.placement] ?? r.placement;
              const status = (t.statuses as Record<string, string>)[r.status] ?? r.status;
              return `<li>${snap.thumbnail_url ? `<img src="${esc(snap.thumbnail_url)}" alt="">` : ""}
<div class="grow"><div><a href="/data/entity/curated_videos/edit/${r.id}">${esc(title)}</a><span class="badge">${esc(status)}</span></div>
<div class="meta">${esc(kind)} · ${esc(placement)} · ${esc((t.locales as Record<string, string>)[r.locale ?? "all"] ?? r.locale)} · ${esc(t.sort)}: ${esc(r.sort ?? 0)}</div></div></li>`;
           })
           .join("")}</ul>`
      : `<p>${esc(t.empty)}</p>`;

   const opts = (values: Record<string, string>, selected?: string) =>
      Object.entries(values)
         .map(([v, label]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label)}</option>`)
         .join("");

   const body = `<a class="skip" href="#main">${o.lang === "ar" ? "انتقل إلى المحتوى" : "Skip to content"}</a>
<header class="top">
<a class="brand" href="/">${esc(s.cms)}</a>
<nav class="top" aria-label="${o.lang === "ar" ? "التنقل" : "Navigation"}">
<a href="/">${esc(t.backToAdmin)}</a>
<a href="/picker?lang=${other}" lang="${other}" hreflang="${other}">${esc(s.switchLang)}</a>
<a href="/sso/accounts?return=%2Fpicker">${esc(s.accounts.nav)}</a>
<a href="/sso/logout">${esc(s.signOut)}</a>
</nav>
</header>
<main id="main" class="wrap">
<h1>${esc(t.title)}</h1>
<p>${esc(t.intro)}</p>
<form class="search" id="search" role="search" novalidate>
<div><label for="kind">${esc(t.kind)}</label><select id="kind" name="kind">${opts(t.kinds as Record<string, string>)}</select></div>
<div><label for="q">${esc(t.query)}</label><input id="q" name="q" type="search" minlength="2" maxlength="100" required aria-describedby="q-hint" autocomplete="off">
<p class="hint" id="q-hint">${esc(t.queryHint)}</p></div>
<div><button class="btn" type="submit">${esc(t.search)}</button></div>
</form>
<section aria-labelledby="results-h">
<h2 id="results-h">${esc(t.results)}</h2>
<p id="search-status" class="status" role="status" aria-live="polite"></p>
<ul class="results" id="results"></ul>
</section>
<section id="add" aria-labelledby="add-h" hidden>
<h2 id="add-h" tabindex="-1"></h2>
<div id="preview"></div>
<form id="add-form" novalidate>
<fieldset>
<legend>${esc(t.add)}</legend>
<div><label for="placement">${esc(t.placement)}</label><select id="placement" name="placement">${opts(t.placements as Record<string, string>, "home")}</select></div>
<div><label for="locale">${esc(t.locale)}</label><select id="locale" name="locale">${opts(t.locales as Record<string, string>, "all")}</select></div>
<div><label for="sort">${esc(t.sort)}</label><input id="sort" name="sort" type="number" inputmode="numeric" value="0" min="0" max="100000" step="1"></div>
<div><label for="status">${esc(t.status)}</label><select id="status" name="status">${opts(t.statuses as Record<string, string>, "draft")}</select></div>
<div><label for="title_override">${esc(t.titleOverride)}</label><input id="title_override" name="title_override" type="text" maxlength="200"></div>
</fieldset>
<p><button class="btn" type="submit">${esc(t.save)}</button> <button class="btn secondary" type="button" id="cancel">${esc(t.cancel)}</button></p>
<p id="add-status" class="status" role="status" aria-live="polite"></p>
</form>
</section>
<section aria-labelledby="current-h">
<h2 id="current-h">${esc(t.current)}</h2>
<p><a href="/data/entity/curated_videos">${esc(t.manage)}</a></p>
${current}
</section>
</main>`;

   const i18n = JSON.stringify({
      searching: t.searching,
      noResults: t.noResults,
      add: t.add,
      added: t.added,
      failed: t.failed,
      preview: t.preview,
      by: t.by,
      queryHint: t.queryHint,
      kinds: t.kinds,
      lang: o.lang,
   }).replace(/</g, "\\u003c");

   const script = `(() => {
const T = ${i18n};
const $ = (id) => document.getElementById(id);
const results = $("results"), status = $("search-status"), add = $("add"), addStatus = $("add-status");
let picked = null;
const el = (tag, attrs, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text) e.textContent = text; return e; };
$("search").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = $("q").value.trim(), kind = $("kind").value;
  if (q.length < 2) { status.className = "status error"; status.textContent = T.queryHint; $("q").focus(); return; }
  status.className = "status"; status.textContent = T.searching; results.replaceChildren();
  try {
    const res = await fetch("/picker/api/search?kind=" + encodeURIComponent(kind) + "&q=" + encodeURIComponent(q), { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const { items } = await res.json();
    status.textContent = items.length ? items.length + " · " + T.kinds[kind] : T.noResults;
    for (const it of items) {
      const li = el("li");
      if (it.thumbnail_url) li.append(el("img", { src: it.thumbnail_url, alt: "" }));
      const box = el("div", { class: "grow" });
      box.append(el("div", {}, it.title));
      if (it.channel_name) box.append(el("div", { class: "meta" }, T.by + " " + it.channel_name));
      li.append(box);
      const btn = el("button", { type: "button", class: "btn secondary", "aria-label": T.add + ": " + it.title }, T.add);
      btn.addEventListener("click", () => choose(it));
      li.append(btn);
      results.append(li);
    }
  } catch (e) { status.className = "status error"; status.textContent = T.failed; }
});
function choose(it) {
  picked = it; add.hidden = false; addStatus.textContent = "";
  const h = $("add-h"); h.textContent = T.kinds[it.kind] + ": " + it.title;
  const prev = $("preview"); prev.replaceChildren();
  if (it.embed_url) prev.append(el("iframe", { src: it.embed_url, title: T.preview + ": " + it.title, loading: "lazy", allow: "fullscreen; picture-in-picture" }));
  h.focus();
}
$("cancel").addEventListener("click", () => { add.hidden = true; picked = null; $("q").focus(); });
$("add-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!picked) return;
  const f = new FormData(ev.target);
  const body = { kind: picked.kind, ref_id: picked.id, placement: f.get("placement"), locale: f.get("locale"), sort: Number(f.get("sort") || 0), status: f.get("status"), title_override: String(f.get("title_override") || "").trim() || null };
  addStatus.className = "status"; addStatus.textContent = "…";
  try {
    const res = await fetch("/picker/api/items", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    addStatus.className = "status ok"; addStatus.textContent = T.added;
    setTimeout(() => location.reload(), 1200);
  } catch (e) { addStatus.className = "status error"; addStatus.textContent = T.failed; }
});
})();`;

   return page({ lang: o.lang, nonce: o.nonce, title: `${t.title} · ${s.cms}`, body, extraCss: CSS, script });
}

const PLACEMENTS = ["home", "videos"];
const LOCALES = ["en", "ar", "all"];
const STATUSES = ["draft", "published"];

export function pickerRoutes(deps: Deps): Hono<AppEnv> {
   const picker = new Hono<AppEnv>();

   picker.get("/", async (c) => {
      const lang = pickLang(new URL(c.req.url), c.req.header("Accept-Language") ?? null);
      const { results } = await c.env.DB.prepare(
         "SELECT id, kind, ref_id, placement, locale, title_override, status, sort, snapshot FROM curated_videos ORDER BY placement, sort, id LIMIT 200",
      ).all<CurrentRow>();
      const user = c.get("user");
      return c.html(pickerHtml({ lang, nonce: c.get("nonce"), current: results, isAdmin: user.role === "admin" }));
   });

   picker.get("/api/search", async (c) => {
      const cfg = c.get("cfg");
      const kind = (c.req.query("kind") ?? "video") as VideoKind;
      const q = (c.req.query("q") ?? "").trim();
      if (!VIDEO_KINDS.includes(kind)) return c.json({ error: "bad_request", message: "kind must be video, playlist or channel" }, 400);
      if (q.length < 2 || q.length > 100) return c.json({ error: "bad_request", message: "q must be 2–100 characters" }, 400);
      try {
         const items = await searchVideos(cfg.videosApiUrl, kind, q, deps.fetch);
         return c.json({
            items: items.map((it) => ({ ...it, embed_url: embedUrl(cfg.videosWebUrl, it.kind, it.id) })),
         });
      } catch (error) {
         console.warn("picker search failed", (error as Error).message);
         return c.json({ error: "upstream_error" }, 502);
      }
   });

   picker.post("/api/items", async (c) => {
      const cfg = c.get("cfg");
      if (!(c.req.header("content-type") ?? "").includes("application/json")) {
         return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      }
      const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!b) return c.json({ error: "bad_request" }, 400);
      const kind = b.kind as VideoKind;
      const refId = typeof b.ref_id === "string" ? b.ref_id : "";
      const placement = String(b.placement ?? "");
      const locale = String(b.locale ?? "all");
      const status = String(b.status ?? "draft");
      const sort = Number(b.sort ?? 0);
      const titleOverride = typeof b.title_override === "string" && b.title_override.trim() ? b.title_override.trim().slice(0, 200) : null;
      if (
         !VIDEO_KINDS.includes(kind) ||
         !refId ||
         !PLACEMENTS.includes(placement) ||
         !LOCALES.includes(locale) ||
         !STATUSES.includes(status) ||
         !Number.isInteger(sort) ||
         sort < 0 ||
         sort > 100_000
      ) {
         return c.json({ error: "bad_request" }, 400);
      }
      let item;
      try {
         item = await lookupItem(cfg.videosApiUrl, kind, refId, deps.fetch);
      } catch (error) {
         console.warn("picker lookup failed", (error as Error).message);
         return c.json({ error: "upstream_error" }, 502);
      }
      if (!item) return c.json({ error: "not_found", message: "not found or not public" }, 404);

      const app = await deps.getApp(c);
      const { data } = await app.em.mutator("curated_videos").insertOne({
         kind,
         ref_id: item.id,
         placement,
         locale,
         sort,
         status,
         title_override: titleOverride,
         snapshot: { title: item.title, thumbnail_url: item.thumbnail_url, channel_name: item.channel_name },
      } as never);
      return c.json({ data }, 201);
   });

   return picker;
}
