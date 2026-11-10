/** @jsxImportSource hono/jsx */
/** Overview: counts, recent edits, quick actions, the active theme. */
import { AiFailuresCard } from "../ui/ai.tsx";
import { raw } from "hono/html";
import type { Data, Row } from "../data.ts";
import { relative } from "../format.ts";
import { publishState } from "../../lib/schedule.ts";
import { LocalTime, StateBadge } from "../ui/parts.tsx";
import { THEMES } from "../theme/vendor.generated.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty, isAdmin, withParam, type View } from "../ui/layout.tsx";
import { deadSnapshots, type DeadSnapshot } from "../../lib/video-snapshots.ts";
import { feedStatus, type FeedStatus } from "../../lib/feed/jobs.ts";

interface Tile {
   entity: "pages" | "posts" | "curated_videos" | "nav_items";
   href: string;
   icon: IconName;
   label: string;
}

/** Failures flag staff: block videos the refresh queue gave up on (src/lib/video-snapshots.ts). */
function VideoFlag(props: { v: View; dead: { items: DeadSnapshot[]; total: number } }) {
   const { t } = props.v;
   if (!props.dead.total) return null;
   return (
      <section class="notice bad" role="alert" aria-labelledby="vflag-h" style="margin-block-end:20px;display:grid;gap:10px" data-video-flag>
         <div style="display:flex;gap:10px;align-items:flex-start">
            <Icon name="alert" />
            <div>
               <h2 id="vflag-h" style="margin:0;font-size:16px">
                  {t.overview.videoFlag(props.dead.total)}
               </h2>
               <p style="margin:4px 0 0">{t.overview.videoFlagBody}</p>
               <ul style="margin:8px 0 0;padding-inline-start:18px">
                  {props.dead.items.slice(0, 5).map((d) => (
                     <li dir="auto">{d.title}</li>
                  ))}
               </ul>
            </div>
         </div>
         <div>
            <button type="button" class="btn sm" data-retry-videos data-done-one={t.overview.retried(1)} data-done={t.overview.retried(P0)} data-failed={t.common.failed}>
               <Icon name="refresh" size={16} /> {t.overview.retry}
            </button>
         </div>
      </section>
   );
}
const P0 = "{0}" as unknown as number;

/** The home timeline's KV build ended in the DLQ: the reason and a Retry (src/lib/feed/jobs.ts). */
function FeedFlag(props: { v: View; s: FeedStatus | null }) {
   const { t } = props.v;
   if (!props.s?.deadAt) return null;
   return (
      <section class="notice bad" role="alert" aria-labelledby="fflag-h" style="margin-block-end:20px;display:grid;gap:10px" data-feed-flag>
         <div style="display:flex;gap:10px;align-items:flex-start">
            <Icon name="alert" />
            <div>
               <h2 id="fflag-h" style="margin:0;font-size:16px">
                  {t.overview.feedFlag}
               </h2>
               <p style="margin:4px 0 0">
                  {t.overview.feedFlagBody} <span dir="auto">{props.s.lastError ?? "—"}</span>
               </p>
            </div>
         </div>
         <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn sm" data-feed-retry data-done={t.overview.feedRetried} data-failed={t.common.failed}>
               <Icon name="refresh" size={16} /> {t.overview.feedRetry}
            </button>
            <a class="btn ghost sm" href="/timeline">
               {t.timeline.title}
            </a>
         </div>
      </section>
   );
}

export async function overviewScreen(v: View, data: Data, db?: D1Database, aiFailures: Parameters<typeof AiFailuresCard>[0]["failures"] = null) {
   const { t } = v;
   const dead = db ? await deadSnapshots(db).catch(() => ({ items: [], total: 0 })) : { items: [], total: 0 };
   const feed = db ? await feedStatus(db).catch(() => null) : null;
   const tiles: Tile[] = [
      { entity: "pages", href: "/pages", icon: "file", label: t.nav.pages },
      { entity: "posts", href: "/posts", icon: "pen", label: t.nav.posts },
      { entity: "curated_videos", href: "/videos", icon: "play", label: t.nav.videos },
      { entity: "nav_items", href: "/navigation", icon: "list", label: t.nav.navigation },
   ];
   const select = ["id", "title", "slug", "locale", "status", "updated_at", "publish_at"];
   // Rows with a schedule, latest first; bknd's guard can't compare times (content.tsx listWheres),
   // so "still ahead" is decided here. Elapsed schedules sort after every future one.
   const withSchedule = { status: "published", publish_at: { $isnull: false } };
   const now = Date.now();
   const [pages, posts, schedPages, schedPosts] = await Promise.all([
      data.list("pages", { limit: 6, sort: "-updated_at", select }),
      data.list("posts", { limit: 6, sort: "-updated_at", select }),
      data.list("pages", { limit: 500, sort: "-publish_at", where: withSchedule, select }),
      data.list("posts", { limit: 500, sort: "-publish_at", where: withSchedule, select }),
   ]);
   const ahead = (rows: Row[], kind: "pages" | "posts") =>
      rows.filter((r) => publishState(r, now) === "scheduled").map((r): Row & { kind: "pages" | "posts" } => ({ ...r, kind }));
   const upPages = ahead(schedPages.data, "pages");
   const upPosts = ahead(schedPosts.data, "posts");
   const counts = await Promise.all(
      tiles.map(async (x) => {
         const scheduled = x.entity === "pages" ? upPages.length : x.entity === "posts" ? upPosts.length : 0;
         const [draft, published] = await Promise.all([data.count(x.entity, { status: "draft" }), data.count(x.entity, { status: "published" })]);
         // "Published" = on the site now; scheduled rows are counted on their own.
         return { draft, published: published - scheduled, scheduled };
      }),
   );
   const upNext = [...upPages, ...upPosts].sort((a, b) => String(a.publish_at ?? "").localeCompare(String(b.publish_at ?? ""))).slice(0, 5);
   const recent = [
      ...pages.data.map((r): Row & { kind: "pages" | "posts" } => ({ ...r, kind: "pages" })),
      ...posts.data.map((r): Row & { kind: "pages" | "posts" } => ({ ...r, kind: "posts" })),
   ]
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
      .slice(0, 6);
   // Image variants that failed (CMS-10): flagged here until fixed from the Library.
   const failedImages = await data.env.DB.prepare("SELECT COUNT(*) AS n FROM media_variants WHERE status = 'failed'")
      .first<{ n: number }>()
      .then((r) => Number(r?.n ?? 0))
      .catch(() => 0);
   const theme = THEMES[v.prefs.theme];
   const name = v.user.email.split("@")[0];

   return (
      <>
         <FeedFlag v={v} s={feed} />
         <VideoFlag v={v} dead={dead} />
         <section class="hero" aria-labelledby="ov-h">
            <div class="hero-copy">
               <p class="muted" style="margin:0 0 6px;font-weight:600">{t.overview.greeting}{v.prefs.lang === "ar" ? "، " : ", "}{name}</p>
               <h1 id="ov-h">{t.overview.title}</h1>
               <p>{t.overview.intro}</p>
               <div class="ph-actions" style="margin-top:20px">
                  <a class="btn primary" href="/pages/new">
                     <Icon name="file" size={18} /> {t.header.newPage}
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

         {failedImages ? (
            <div class="notice bad" role="status" style="margin-top:24px;align-items:center" data-variants-alert>
               <Icon name="alert" size={20} />
               <span style="flex:1">{t.library.variantsBanner(failedImages)}</span>
               <a class="btn sm" href="/library">
                  {t.library.variantsOpen}
               </a>
            </div>
         ) : null}

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
                     {counts[i].scheduled ? (
                        <span data-stat-scheduled>
                           <span class="stat-n">{counts[i].scheduled}</span> <span class="stat-l">{t.overview.scheduled}</span>
                        </span>
                     ) : null}
                  </span>
               </a>
            ))}
         </div>

         <AiFailuresCard v={v} failures={aiFailures} />
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
                           <StateBadge v={v} state={publishState(r)} />
                        </li>
                     ))}
                  </ul>
               ) : (
                  <Empty icon="pen" title={t.common.empty} body={t.overview.recentEmpty} />
               )}
            </section>

            <section class="card" aria-labelledby="up-h" data-up-next>
               <h2 id="up-h">
                  <Icon name="calendar" size={20} class="h-ic" /> {t.overview.upNext}
               </h2>
               {upNext.length ? (
                  <ol class="timeline">
                     {upNext.map((r: Row & { kind: "pages" | "posts" }) => (
                        <li class="tl">
                           <span class="tl-dot" aria-hidden="true" />
                           <LocalTime class="tl-when" iso={r.publish_at} lang={v.prefs.lang} />
                           <a class="li-title" href={`/${r.kind}/${r.id}`} lang={String(r.locale)} dir="auto">
                              {String(r.title ?? "")}
                           </a>
                           <span class="li-meta">
                              <span>{t.entities[r.kind].one}</span>
                              <span class="badge loc">{String(r.locale).toUpperCase()}</span>
                           </span>
                        </li>
                     ))}
                  </ol>
               ) : (
                  <p class="muted" style="margin:0">{t.overview.upNextEmpty}</p>
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
