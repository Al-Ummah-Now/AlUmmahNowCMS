/** @jsxImportSource hono/jsx */
/** Overview: counts, recent edits, quick actions, the active theme. */
import { raw } from "hono/html";
import type { Data, Row } from "../data.ts";
import { relative } from "../format.ts";
import { THEMES } from "../theme/vendor.generated.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty, isAdmin, withParam, type View } from "../ui/layout.tsx";

interface Tile {
   entity: "pages" | "posts" | "curated_videos" | "nav_items";
   href: string;
   icon: IconName;
   label: string;
}

export async function overviewScreen(v: View, data: Data) {
   const { t } = v;
   const tiles: Tile[] = [
      { entity: "pages", href: "/pages", icon: "file", label: t.nav.pages },
      { entity: "posts", href: "/posts", icon: "pen", label: t.nav.posts },
      { entity: "curated_videos", href: "/videos", icon: "play", label: t.nav.videos },
      { entity: "nav_items", href: "/navigation", icon: "list", label: t.nav.navigation },
   ];
   const counts = await Promise.all(
      tiles.map(async (x) => ({
         draft: await data.count(x.entity, { status: "draft" }),
         published: await data.count(x.entity, { status: "published" }),
      })),
   );
   const select = ["id", "title", "slug", "locale", "status", "updated_at"];
   const [pages, posts] = await Promise.all([
      data.list("pages", { limit: 6, sort: "-updated_at", select }),
      data.list("posts", { limit: 6, sort: "-updated_at", select }),
   ]);
   const recent = [
      ...pages.data.map((r): Row & { kind: "pages" | "posts" } => ({ ...r, kind: "pages" })),
      ...posts.data.map((r): Row & { kind: "pages" | "posts" } => ({ ...r, kind: "posts" })),
   ]
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
      .slice(0, 6);
   const theme = THEMES[v.prefs.theme];
   const name = v.user.email.split("@")[0];

   return (
      <>
         <section class="hero" aria-labelledby="ov-h">
            <div class="hero-copy">
               <p class="muted" style="margin:0 0 6px;font-weight:600">{t.overview.greeting}{v.prefs.lang === "ar" ? "، " : ", "}{name}</p>
               <h1 id="ov-h">{t.overview.title}</h1>
               <p>{t.overview.intro}</p>
               <div class="ph-actions" style="margin-top:20px">
                  <a class="btn primary" href="/pages/new">
                     <Icon name="plus" size={18} /> {t.header.newPage}
                  </a>
                  <a class="btn" href="/posts/new">
                     <Icon name="pen" size={18} /> {t.header.newPost}
                  </a>
                  <a class="btn ghost" href="/videos?add=1">
                     <Icon name="play" size={18} /> {t.header.addVideo}
                  </a>
               </div>
            </div>
            <div class="hero-art theme-graphic demo-gfx" data-t={v.prefs.theme} aria-hidden="true">
               {raw(theme.graphic)}
            </div>
         </section>

         <div class="sec-h">
            <h2>{t.cms}</h2>
         </div>
         <div class="stats">
            {tiles.map((x, i) => (
               <a class="card stat" href={x.href} data-stat={x.entity}>
                  <span class="stat-top">
                     {x.label}
                     <span class="stat-ic">
                        <Icon name={x.icon} />
                     </span>
                  </span>
                  <span class="stat-nums">
                     <span>
                        <span class="stat-n">{counts[i].published}</span> <span class="stat-l">{t.overview.published}</span>
                     </span>
                     <span>
                        <span class="stat-n">{counts[i].draft}</span> <span class="stat-l">{t.overview.drafts}</span>
                     </span>
                  </span>
               </a>
            ))}
         </div>

         <div class="grid2" style="margin-top:32px">
            <section class="card" aria-labelledby="recent-h">
               <h2 id="recent-h">{t.overview.recent}</h2>
               {recent.length ? (
                  <ul class="list">
                     {recent.map((r: Row & { kind: "pages" | "posts" }) => (
                        <li class="li" style="grid-template-columns:minmax(0,1fr) auto">
                           <div class="li-body">
                              <a class="li-title" href={`/${r.kind}/${r.id}`} lang={String(r.locale)} dir="auto">
                                 {String(r.title ?? "")}
                              </a>
                              <div class="li-meta">
                                 <span>{t.entities[r.kind].one}</span>
                                 <span class="badge loc">{String(r.locale).toUpperCase()}</span>
                                 <span>{relative(r.updated_at, v.prefs.lang)}</span>
                              </div>
                           </div>
                           <span class={`badge ${r.status === "published" ? "published" : "draft"}`}>{t.status[r.status === "published" ? "published" : "draft"]}</span>
                        </li>
                     ))}
                  </ul>
               ) : (
                  <Empty icon="pen" title={t.common.empty} body={t.overview.recentEmpty} />
               )}
            </section>

            <section class="card" aria-labelledby="theme-h" data-theme-card>
               <h2 id="theme-h">{t.overview.theme}</h2>
               <p style="margin:0;font-size:22px;font-weight:700">{THEMES[v.prefs.siteTheme].name[v.prefs.lang]}</p>
               <div class="swatches" aria-hidden="true">
                  <span class="sw" style="background:var(--fanous-color-primary)" />
                  <span class="sw" style="background:var(--fanous-color-surface-raised)" />
                  <span class="sw" style="background:var(--fanous-color-background)" />
                  <span class="sw" style="background:var(--fanous-color-motif)" />
               </div>
               <p class="muted" style="margin:0 0 16px">{t.overview.themeBody}</p>
               <div class="ph-actions">
                  {isAdmin(v) ? (
                     <a class="btn" href={`${v.adminWebUrl}/site-theme`}>
                        <Icon name="palette" size={18} /> {t.overview.themeChange}
                     </a>
                  ) : null}
                  {v.prefs.previewing ? (
                     <a class="btn ghost" href={withParam(v, "theme", "site")}>
                        {t.overview.themeReset}
                     </a>
                  ) : null}
               </div>
            </section>
         </div>
      </>
   );
}
