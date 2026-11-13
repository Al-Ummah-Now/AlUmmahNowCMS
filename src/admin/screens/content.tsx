/** @jsxImportSource hono/jsx */
/** Pages and posts: list (search, filters, sort, paging) and editor (docs/ADMIN_UI_SPEC.md E1–E16, A1–A12). */
import { AiCard, AiCheckButton, AiDialogs, AiSeoButton, AiSeoPanel, aiClientStrings } from "../ui/ai.tsx";
import { TrFlagsCard, TrFlagsDialogs, TrFlagsPopover, trFlagsClientStrings } from "../ui/translation-flags.tsx";
import { openCounts } from "../../lib/translation-flags/store.ts";
import type { Data, Row } from "../data.ts";
import { relative } from "../format.ts";
import { publishState, timeOf, type PublishState } from "../../lib/schedule.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, isAdmin, isWriter, PageHead, type View } from "../ui/layout.tsx";
import { PickerDialog } from "../ui/picker.tsx";
import { Autocomplete, comboboxProps } from "../ui/autocomplete.tsx";
import { blockMediaIds, blockPostIds, blockVideoRefs, bodyAsBlocks, storedBlocks, storedSlides, type Block, type Slide } from "../../lib/blocks.ts";
import { getSnapshots } from "../../lib/video-snapshots.ts";
import { stableSnapshot } from "../../lib/stable-thumb.ts";
import { PageTypeField, PageTypePanels, pageTypeOf } from "./page-type.tsx";
import { BlocksEditor, emptyRefs, MediaDialog, mediaInfoOf, PostsDialog, SlidesEditor, type Refs } from "./blocks.tsx";
import { ConfirmDialog, I18nScript, LocalTime, StateBadge } from "../ui/parts.tsx";
import { historyCard } from "./history.tsx";
import { MainSiteCard } from "./scholars.tsx";
import { scholarName, scholarOfSub } from "../../lib/scholars/profiles.ts";

export type ContentKind = "pages" | "posts";
const PAGE_SIZE = 20;
/** www serves posts in its Articles section, `/{locale}/articles/{slug}` (it was `/news/` until 2026-11; www 301s the old urls). */
const WWW_POSTS = "articles";
const SORTS = { updated: "-updated_at", published: "-published_at", title: "title", slug: "slug" } as const;
type SortKey = keyof typeof SORTS;

export interface ListParams {
   q: string;
   status: "" | PublishState;
   locale: "" | "en" | "ar";
   sort: SortKey;
   page: number;
}

export function parseListParams(url: URL): ListParams {
   const g = (k: string) => url.searchParams.get(k) ?? "";
   const status = g("status");
   const locale = g("locale");
   const sort = g("sort");
   const page = Number.parseInt(g("page"), 10);
   return {
      q: g("q").trim().slice(0, 100),
      status: status === "draft" || status === "scheduled" || status === "published" ? status : "",
      locale: locale === "en" || locale === "ar" ? locale : "",
      sort: sort in SORTS ? (sort as SortKey) : "updated",
      page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
   };
}

export interface ListBranch {
   where: Record<string, unknown>;
   /** Kept rows (time checks bknd can't do, see below); absent = every row the where returns. */
   keep?: PublishState;
}

/**
 * bknd 0.21 joins `$or` to its sibling conditions with OR (`status = 'draft' OR title LIKE …`), so
 * every "either" is separate AND-only queries merged here (docs/ADMIN_UI_SPEC.md §0): a search
 * (title, address). Its guard also accepts only numbers for `$gt`/`$lte`, so the schedule filters
 * (#7) ask bknd for "has a schedule" (`$isnull`) and compare the time in the Worker (`keep`).
 */
export function listWheres(p: Pick<ListParams, "q" | "status" | "locale">): ListBranch[] {
   const where: Record<string, unknown> = {};
   if (p.locale) where.locale = p.locale;
   let byStatus: ListBranch[] = [{ where: {} }];
   if (p.status === "draft") byStatus = [{ where: { status: "draft" } }];
   else if (p.status === "scheduled") byStatus = [{ where: { status: "published", publish_at: { $isnull: false } }, keep: "scheduled" }];
   else if (p.status === "published") {
      byStatus = [{ where: { status: "published", publish_at: { $isnull: true } } }, { where: { status: "published", publish_at: { $isnull: false } }, keep: "published" }];
   }
   const like = `*${p.q.replace(/\*/g, "")}*`;
   const byText: Record<string, unknown>[] = p.q ? [{ title: { $like: like } }, { slug: { $like: like } }] : [{}];
   return byStatus.flatMap((st) => byText.map((tx) => ({ where: { ...where, ...st.where, ...tx }, keep: st.keep })));
}

const SEARCH_CAP = 500;

async function searchList(data: Data, kind: ContentKind, p: ListParams, select: string[], scope: Record<string, unknown> = {}): Promise<{ data: Row[]; total: number }> {
   const branches = listWheres(p).map((b) => ({ ...b, where: { ...b.where, ...scope } }));
   if (branches.length === 1 && !branches[0].keep) {
      return data.list(kind, { limit: PAGE_SIZE, offset: (p.page - 1) * PAGE_SIZE, sort: SORTS[p.sort], where: branches[0].where, select });
   }
   const now = Date.now();
   const parts = await Promise.all(
      branches.map(async (b) => {
         const res = await data.list(kind, { limit: SEARCH_CAP, sort: SORTS[p.sort], where: b.where, select });
         return b.keep ? res.data.filter((r) => publishState(r, now) === b.keep) : res.data;
      }),
   );
   const seen = new Map<string, Row>();
   for (const r of parts.flat()) seen.set(String(r.id), r);
   const key = SORTS[p.sort].replace(/^-/, "");
   const desc = SORTS[p.sort].startsWith("-");
   const all = [...seen.values()].sort((a, b) => {
      const c = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
      return (desc ? -c : c) || Number(b.id) - Number(a.id);
   });
   return { data: all.slice((p.page - 1) * PAGE_SIZE, p.page * PAGE_SIZE), total: all.length };
}

const qs = (p: ListParams, over: Partial<ListParams>) => {
   const m = { ...p, ...over };
   const s = new URLSearchParams();
   if (m.q) s.set("q", m.q);
   if (m.status) s.set("status", m.status);
   if (m.locale) s.set("locale", m.locale);
   if (m.sort !== "updated") s.set("sort", m.sort);
   if (m.page > 1) s.set("page", String(m.page));
   const out = s.toString();
   return out ? `?${out}` : "";
};

export async function contentList(v: View, data: Data, kind: ContentKind, p: ListParams, db?: D1Database) {
   const { t } = v;
   const select = ["id", "title", "slug", "locale", "status", "updated_at", "published_at", "publish_at", ...(kind === "posts" ? ["author_name", "author_sub", "featured_at"] : ["list_kind"])];
   // A writer lists only their own posts (docs/SCHOLARS.md §2); data.list reads bknd directly.
   const writer = isWriter(v);
   if (writer && (kind !== "posts" || !v.user.sub)) return <Empty icon="pen" title={t.common.notFound} />;
   // Scholar post references are not edited here (docs/SCHOLARS.md §7): they are on the Featuring screen.
   const scope: Record<string, unknown> = { ...(writer ? { author_sub: v.user.sub } : {}), ...(kind === "posts" ? { ref_post_id: { $isnull: true } } : {}) };
   const res = await searchList(data, kind, p, select, scope);
   const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
   const base = `/${kind}`;
   // Open translation flags per row (docs/TRANSLATION_FLAGS.md): a badge on the list.
   const flagCounts = db ? await openCounts(db, kind, res.data.map((r: Row) => Number(r.id))).catch(() => new Map<number, number>()) : new Map<number, number>();
   const filtered = !!(p.q || p.status || p.locale);
   const seg = <K extends "status" | "locale">(key: K, values: ListParams[K][], label: (x: ListParams[K]) => string) => (
      <div class="seg" role="group" aria-label={key === "status" ? t.common.filters : t.common.language}>
         {values.map((x) => (
            <a href={base + qs(p, { [key]: x, page: 1 } as Partial<ListParams>)} aria-current={p[key] === x ? "true" : undefined}>
               {label(x)}
            </a>
         ))}
      </div>
   );
   return (
      <>
         <PageHead title={writer ? t.scholars.myArticles : t.entities[kind].many} intro={writer ? t.scholars.myArticlesIntro : kind === "pages" ? t.content.pagesIntro : t.content.postsIntro}>
            <a class="btn primary" href={`${base}/new`}>
               <Icon name={kind === "pages" ? "file" : "pen"} size={18} /> {writer ? t.scholars.writeArticle : kind === "pages" ? t.content.newPage : t.content.newPost}
            </a>
         </PageHead>
         <form class="toolbar" method="get" action={base} role="search">
            <Autocomplete kind={kind} listId="list-q-list" label={t.common.search} locale={p.locale}>
            <div class="search">
               <label class="vh" for="list-q">
                  {t.common.search}
               </label>
               <input id="list-q" name="q" type="search" value={p.q} placeholder={t.common.search} maxlength={100} {...comboboxProps("list-q-list")} />
               {p.status ? <input type="hidden" name="status" value={p.status} /> : null}
               {p.locale ? <input type="hidden" name="locale" value={p.locale} /> : null}
               {p.sort !== "updated" ? <input type="hidden" name="sort" value={p.sort} /> : null}
               <button type="submit" aria-label={t.common.search}>
                  <Icon name="search" />
               </button>
            </div>
            </Autocomplete>
            {seg("status", ["", "draft", "scheduled", "published"], (x) => (x ? t.status[x] : t.common.all))}
            {seg("locale", ["", "en", "ar"], (x) => (x ? t.locales[x] : t.common.all))}
            <label class="vh" for="list-sort">
               {t.common.sort}
            </label>
            <select id="list-sort" class="select" style="width:auto" name="sort" data-autosubmit aria-label={t.common.sort}>
               {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <option value={k} selected={p.sort === k}>
                     {{ updated: t.common.sortUpdated, published: t.common.sortPublished, title: t.common.sortTitle, slug: t.common.sortSlug }[k]}
                  </option>
               ))}
            </select>
            {filtered ? (
               <a class="btn ghost sm" href={base}>
                  {t.common.clear}
               </a>
            ) : null}
         </form>
         <p class="muted" role="status" style="margin:0 0 12px;font-size:14px">
            {t.common.results(res.total)}
         </p>
         {res.data.length ? (
            <ul class="list" data-list={kind}>
               {res.data.map((r: Row) => (
                  <li class="li" style="grid-template-columns:minmax(0,1fr) auto">
                     <div class="li-body">
                        <a class="li-title" href={`${base}/${r.id}`} lang={String(r.locale)} dir="auto">
                           {String(r.title ?? "")}
                        </a>
                        <div class="li-meta">
                           <span class="badge loc">{String(r.locale).toUpperCase()}</span>
                           {kind === "pages" && (r.list_kind === "curated" || r.list_kind === "filter") ? <span class="badge loc">{r.list_kind === "curated" ? t.pageList.badgeCurated : t.pageList.badgeFilter}</span> : null}
                           <span dir="ltr">/{kind === "posts" ? `${WWW_POSTS}/` : ""}{String(r.slug)}</span>
                           {r.author_name ? <span>{String(r.author_name)}</span> : null}
                           {r.author_sub && !writer ? <span class="badge loc">{t.scholars.badge}</span> : null}
                           {r.author_sub && r.featured_at ? <span class="badge published">{t.featuring.featured}</span> : null}
                           {flagCounts.get(Number(r.id)) ? (
                              <span class="badge trf" data-trf-badge>
                                 <Icon name="flag" size={12} />
                                 <span class="vh">{t.trFlags.card}: </span>
                                 {t.trFlags.openCount.replace("{0}", String(flagCounts.get(Number(r.id))))}
                              </span>
                           ) : null}
                           {publishState(r) === "scheduled" ? (
                              <span class="when">
                                 <Icon name="clock" size={14} /> {t.content.goesLive} <LocalTime iso={r.publish_at} lang={v.prefs.lang} />
                              </span>
                           ) : (
                              <span>
                                 {t.common.updated} {relative(r.updated_at, v.prefs.lang)}
                              </span>
                           )}
                        </div>
                     </div>
                     <StateBadge v={v} state={publishState(r)} />
                  </li>
               ))}
            </ul>
         ) : (
            <Empty icon={kind === "pages" ? "file" : "pen"} title={filtered ? t.common.emptySearch : t.common.empty}>
               {filtered ? null : (
                  <a class="btn primary" href={`${base}/new`}>
                     <Icon name={kind === "pages" ? "file" : "pen"} size={18} /> {kind === "pages" ? t.content.newPage : t.content.newPost}
                  </a>
               )}
            </Empty>
         )}
         {pages > 1 ? (
            <nav class="pager" aria-label={t.common.page(p.page, pages)}>
               {p.page > 1 ? (
                  <a class="btn sm" href={base + qs(p, { page: p.page - 1 })} rel="prev">
                     <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                  </a>
               ) : (
                  <span />
               )}
               <span class="muted">{t.common.page(p.page, pages)}</span>
               {p.page < pages ? (
                  <a class="btn sm" href={base + qs(p, { page: p.page + 1 })} rel="next">
                     {t.common.next} <Icon name="chevronEnd" size={16} class="flip" />
                  </a>
               ) : (
                  <span />
               )}
            </nav>
         ) : null}
      </>
   );
}

interface MediaRow {
   id: number;
   path: string;
   metadata?: unknown;
}

function altOf(m: MediaRow | undefined): string {
   if (!m) return "";
   const meta = typeof m.metadata === "string" ? safeJson(m.metadata) : m.metadata;
   return meta && typeof meta === "object" && typeof (meta as Row).alt === "string" ? String((meta as Row).alt) : "";
}
function safeJson(s: string): unknown {
   try {
      return JSON.parse(s);
   } catch {
      return null;
   }
}

function tagsOf(v: unknown): string[] {
   const raw = typeof v === "string" ? safeJson(v) : v;
   return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Placeholders for numeric string templates (rendered as "{0}" / "{1}"). */
const P0 = "{0}" as unknown as number;
const P1 = "{1}" as unknown as number;

function Counter(props: { for: string; max: number }) {
   return <span class="muted" style="font-size:12px" data-counter={props.for} data-max={String(props.max)} aria-hidden="true" />;
}

/** Media, posts and video snapshots the blocks and slides refer to (for thumbnails and titles). */
async function loadRefs(data: Data, db: D1Database | undefined, blocks: Block[], slides: Slide[], videosWebUrl: string): Promise<Refs> {
   const refs = emptyRefs();
   const mediaIds = [...new Set([...blockMediaIds(blocks), ...slides.flatMap((x) => (x.media_id ? [x.media_id] : []))])];
   const postIds = blockPostIds(blocks);
   const videoRefs = blockVideoRefs(blocks);
   const [media, posts, snaps] = await Promise.all([
      mediaIds.length ? data.list<{ id: number; path: string; metadata?: unknown }>("media", { limit: mediaIds.length, where: { id: { $in: mediaIds } }, select: ["id", "path", "metadata"] }) : Promise.resolve({ data: [], total: 0 }),
      postIds.length ? data.list("posts", { limit: postIds.length, where: { id: { $in: postIds } }, select: ["id", "title", "locale", "status"] }) : Promise.resolve({ data: [] as Row[], total: 0 }),
      db && videoRefs.length ? getSnapshots(db, videoRefs) : Promise.resolve(new Map<string, Record<string, unknown>>()),
   ]);
   for (const m of media.data) if (m.path) refs.media.set(Number(m.id), mediaInfoOf(m));
   for (const p of posts.data) refs.posts.set(Number(p.id), { title: String(p.title ?? ""), locale: String(p.locale ?? ""), status: String(p.status ?? "") });
   for (const [k, stored] of snaps) {
      // Shown with a stable thumbnail, so a signed URL stored before they were made stable never breaks.
      const [kind, refId] = k.split(":");
      const snap = stableSnapshot(videosWebUrl, stored, kind, refId);
      refs.videos.set(k, {
         title: typeof snap.title === "string" ? snap.title : k.split(":")[1],
         thumbnail_url: typeof snap.thumbnail_url === "string" ? snap.thumbnail_url : null,
         channel_name: typeof snap.channel_name === "string" ? snap.channel_name : null,
      });
   }
   return refs;
}

export async function contentEditor(v: View, data: Data, kind: ContentKind, id: number | null, newLocale: "en" | "ar", db?: D1Database) {
   const { t } = v;
   const writer = isWriter(v);
   if (writer && kind !== "posts") return null;
   const row: Row | null = id ? await data.one(kind, id) : null;
   if (id && !row) return null;
   // A writer edits only their own posts (docs/SCHOLARS.md §2): someone else's is "not found".
   if (writer && row && (!v.user.sub || row.author_sub !== v.user.sub)) return null;
   // A scholar post reference: written in Studio, featured on the Featuring screen (docs/SCHOLARS.md §7).
   if (kind === "posts" && row && typeof row.ref_post_id === "string" && row.ref_post_id) {
      const www = `${v.wwwUrl}/${String(row.locale)}/${WWW_POSTS}/${encodeURIComponent(String(row.slug))}/`;
      const studio = row.ref_channel_id ? `${v.videosWebUrl ?? ""}/${v.prefs.lang}/settings/channel/${encodeURIComponent(String(row.ref_channel_id))}/community` : null;
      return (
         <>
            <PageHead title={String(row.title ?? "")} intro={t.refs.intro} back={{ href: "/featuring", label: t.nav.featuring }} />
            <section class="card" style="max-width:640px" data-ref-post={String(row.ref_post_id)}>
               <p style="display:flex;gap:16px;flex-wrap:wrap">
                  <a href={www}>{t.refs.viewOnWww}</a>
                  {studio ? <a href={studio}>{t.refs.openInStudio}</a> : null}
                  <a href={`/featuring?q=${encodeURIComponent(String(row.title ?? "").slice(0, 100))}`}>{t.nav.featuring}</a>
               </p>
            </section>
         </>
      );
   }
   const scholarPost = kind === "posts" && !!(row?.author_sub || writer);
   const scholar = scholarPost && db ? await scholarOfSub(db, writer ? v.user.sub ?? null : String(row?.author_sub ?? "")) : null;
   const locale = (row?.locale as "en" | "ar") ?? newLocale;
   const other: "en" | "ar" = locale === "en" ? "ar" : "en";
   const [covers, translations] = await Promise.all([
      id ? data.list<MediaRow>("media", { limit: 1, sort: "id", where: { reference: `${kind}.cover`, entity_id: String(id) } }) : Promise.resolve({ data: [] as MediaRow[], total: 0 }),
      row?.translation_key
         ? data.list(kind, {
              limit: 5,
              where: { translation_key: String(row.translation_key), locale: other, ...(writer ? { author_sub: v.user.sub } : {}) },
              select: ["id", "title", "slug", "locale", "status", "publish_at"],
           })
         : Promise.resolve({ data: [] as Row[], total: 0 }),
   ]);
   const cover = covers.data[0];
   const history = id ? await historyCard({ v, data, kind, id }) : null;
   // Translation flags (docs/TRANSLATION_FLAGS.md): on a saved row with a version in the other language.
   const flags = !!row && translations.data.length > 0;
   const canResolveFlags = flags && !writer;
   // Blocks (pages) and slides (card posts), with what the editor shows for their references.
   const blocks: Block[] = kind === "pages" ? (row ? (storedBlocks(row.blocks).length ? storedBlocks(row.blocks) : bodyAsBlocks(row.body)) : []) : [];
   const slides: Slide[] = kind === "posts" ? storedSlides(row?.slides) : [];
   const postKind = kind === "posts" && row?.kind === "cards" ? "cards" : "article";
   const pageType = kind === "pages" ? pageTypeOf(row?.list_kind) : "";
   const refs = await loadRefs(data, db, blocks, slides, v.videosWebUrl ?? "");
   const s = (k: string) => (row && row[k] != null ? String(row[k]) : "");
   const state = publishState(row);
   const published = state === "published";
   const scheduled = state === "scheduled";
   const firstPublished = timeOf(row?.published_at);
   const wentLive = firstPublished !== null && firstPublished <= Date.now();
   const publishAt = scheduled ? new Date(timeOf(row?.publish_at)!).toISOString() : "";
   const base = `/${kind}`;
   const sitePath = `${v.wwwUrl}/${locale}/${kind === "posts" ? `${WWW_POSTS}/` : ""}${s("slug")}`;
   const title = row ? s("title") : kind === "pages" ? t.content.newPage : t.content.newPost;
   const strings = {
      // Functions don't survive JSON: the client gets "{0}"/"{1}" templates (src/admin/client/blocks.ts fmt).
      blocks: {
         ...t.blocks,
         position: t.blocks.position(P0, P1),
         moved: t.blocks.moved(P0, P1),
         added: t.blocks.added("{0}"),
         duplicated: t.blocks.duplicated("{0}"),
         removed: t.blocks.removed("{0}"),
         mediaUseMany: t.blocks.mediaUseMany(P0),
         mediaUseOne: t.blocks.mediaUseMany(1),
         mediaUploading: t.blocks.mediaUploading("{0}"),
      },
      slides: { ...t.slides, count: t.slides.count(P0), count1: t.slides.count(1), count2: t.slides.count(2), count10: t.slides.count(3) },
      invalid: t.blocks.invalid,
      status: t.status,
      slugBad: t.content.slugBad,
      slugHome: t.content.slugHome,
      slugTaken: t.content.slugTaken,
      slugNumeric: t.content.slugNumeric,
      slugChangeTitle: t.content.slugChangeTitle,
      slugChangeBody: t.content.slugChangeBody,
      slugChangeOk: t.content.slugChangeOk,
      slugSuggesting: t.content.slugSuggesting,
      slugTranslated: t.content.slugTranslated,
      slugTransliterated: t.content.slugTransliterated,
      required: t.common.required,
      saved: t.common.saved,
      saving: t.common.saving,
      failed: t.common.failed,
      conflict: t.common.conflict,
      unsaved: t.common.unsaved,
      published: t.content.published,
      unpublished: t.content.unpublished,
      draftSaved: t.content.draftSaved,
      deleted: t.content.deleted,
      previewEmpty: t.content.previewEmpty,
      videoLine: t.content.videoLine,
      removeTag: t.content.removeTag,
      coverTooBig: t.content.coverTooBig,
      coverBadType: t.content.coverBadType,
      coverUploading: t.content.coverUploading,
      schedulePast: t.content.schedulePast,
      scheduleRequired: t.content.scheduleRequired,
      previewSaveFirst: t.common.previewSaveFirst,
      unpublish: t.common.unpublish,
      unpublishTitle: t.common.unpublishTitle,
      unpublishBody: t.common.unpublishBody,
      unschedule: t.content.unschedule,
      unscheduleTitle: t.common.unscheduleTitle,
      unscheduleBody: t.common.unscheduleBody,
      coverRemove: t.content.coverRemove,
      coverRemoveTitle: t.common.coverRemoveTitle,
      coverRemoveBody: t.common.coverRemoveBody,
      picker: t.picker,
      pageList: { ...t.pageList, previewCount: t.pageList.previewCount(-1).replace("-1", "{0}"), previewCount1: t.pageList.previewCount(1), tagCount: undefined },
      ai: v.ai ? aiClientStrings(v) : undefined,
      trFlags: flags ? trFlagsClientStrings(v) : undefined,
   };
   return (
      <>
         <I18nScript nonce={v.nonce} strings={strings} />
         <PageHead title={title} back={{ href: base, label: t.entities[kind].many }}>
            {published ? (
               <a class="btn ghost" href={sitePath} target="_blank" rel="noopener">
                  <Icon name="external" size={18} class="flip" /> {t.common.viewOnSite}
               </a>
            ) : id ? (
               // Mints a signed, 30-minute token for this row and opens www (src/routes/preview.ts).
               <a class="btn ghost" href={`/preview/${kind}/${id}`} target="_blank" rel="noopener" data-preview aria-describedby="preview-help">
                  <Icon name="eye" size={18} /> {t.common.previewOnSite}
               </a>
            ) : null}
         </PageHead>
         <form
            class="split"
            data-editor={kind}
            data-id={id ? String(id) : ""}
            data-updated={s("updated_at")}
            data-slug={s("slug")}
            data-locale={locale}
            data-translation-key={s("translation_key")}
            data-state={state}
            data-publish-at={publishAt}
            data-ai={v.ai ? "1" : undefined}
            data-trf={flags ? "1" : undefined}
            data-trf-resolve={canResolveFlags ? "1" : undefined}
            data-ui-lang={v.prefs.lang}
            data-page-type={kind === "pages" ? pageType : undefined}
            novalidate
         >
            <div class="stack">
               <section class="card stack">
                  <div class="field">
                     <label for="f-title">{t.content.title}</label>
                     <input id="f-title" spellcheck={true} class="input" name="title" required maxlength={200} value={s("title")} placeholder={t.content.titlePh} lang={locale} dir="auto" style="font-size:20px;font-weight:700" />
                     <p class="err" id="f-title-err" hidden />
                  </div>
                  <div class="field">
                     <label for="f-slug">{t.content.slug}</label>
                     <div class="search" style="background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border);border-radius:var(--r-md)" dir="ltr">
                        <span class="muted" style="display:flex;align-items:center;padding-inline-start:14px;white-space:nowrap">
                           /{locale}/{kind === "posts" ? `${WWW_POSTS}/` : ""}
                        </span>
                        <input id="f-slug" name="slug" required maxlength={120} value={s("slug")} pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck={false} aria-describedby={wentLive ? "f-slug-locked f-slug-help f-slug-err" : "f-slug-help f-slug-err"} style="padding-inline-start:2px;color:var(--fanous-c-form-input-text)" data-auto-slug={row ? undefined : "1"} readonly={wentLive} data-slug-live={wentLive ? "1" : undefined} />
                     </div>
                     {wentLive ? (
                        <p class="help" id="f-slug-locked" data-slug-locked>
                           {t.content.slugLocked}
                        </p>
                     ) : null}
                     <p class="help" id="f-slug-help">
                        {t.content.slugHelp}
                     </p>
                     <p class="help" data-slug-source aria-live="polite" hidden />
                     <div style="display:flex;gap:8px;flex-wrap:wrap">
                        {wentLive ? (
                           <button type="button" class="btn sm" data-slug-unlock>
                              {t.content.slugChange}
                           </button>
                        ) : null}
                        <button type="button" class="btn sm" data-slug-regen hidden={!row}>
                           {t.content.slugRegen}
                        </button>
                     </div>
                     <p class="err" id="f-slug-err" hidden />
                  </div>
                  <div class="field">
                     <label for="f-summary">{kind === "pages" ? t.content.summary : t.content.excerpt}</label>
                     <textarea id="f-summary" spellcheck={true} class="textarea" name={kind === "pages" ? "summary" : "excerpt"} rows={3} maxlength={500} lang={locale} dir="auto" aria-describedby="f-summary-help" style="min-height:84px">
                        {kind === "pages" ? s("summary") : s("excerpt")}
                     </textarea>
                     <p class="help" id="f-summary-help">
                        {kind === "pages" ? t.content.summaryHelp : t.content.excerptHelp}
                     </p>
                  </div>
                  {kind === "pages" ? <PageTypeField v={v} type={pageType} /> : null}
                  {kind === "posts" ? (
                     <div class="field">
                        <span class="label" id="f-kind-l">
                           {t.content.kind}
                        </span>
                        <div class="seg" role="radiogroup" aria-labelledby="f-kind-l" aria-describedby="f-kind-help">
                           <label>
                              <input type="radio" name="kind" value="article" checked={postKind === "article"} data-post-kind />
                              <Icon name="text" size={16} /> {t.content.kindArticle}
                           </label>
                           <label>
                              <input type="radio" name="kind" value="cards" checked={postKind === "cards"} data-post-kind />
                              <Icon name="layers" size={16} /> {t.content.kindCards}
                           </label>
                        </div>
                        <p class="help" id="f-kind-help">
                           {t.content.kindHelp}
                        </p>
                     </div>
                  ) : null}
                  {kind === "posts" ? (
                     <div data-kind-panel="article" hidden={postKind !== "article"}>
                  <div class="field" data-md>
                        <span class="label" id="f-body-label">
                           {t.content.body}
                        </span>
                        <div class="md-bar" role="toolbar" aria-label={t.content.toolbar} aria-controls="f-body">
                           <div class="seg" role="tablist">
                              <button type="button" role="tab" aria-selected="true" data-md-tab="write">
                                 {t.content.write}
                              </button>
                              <button type="button" role="tab" aria-selected="false" data-md-tab="preview">
                                 {t.content.preview}
                              </button>
                           </div>
                           <span class="md-tools">
                              <button type="button" class="btn ghost sm icon-only" data-md="h2" title={t.content.h2} aria-label={t.content.h2}>
                                 <Icon name="heading" size={18} />
                              </button>
                              <button type="button" class="btn ghost sm icon-only" data-md="bold" title={t.content.bold} aria-label={t.content.bold}>
                                 <Icon name="bold" size={18} />
                              </button>
                              <button type="button" class="btn ghost sm icon-only" data-md="italic" title={t.content.italic} aria-label={t.content.italic}>
                                 <Icon name="italic" size={18} />
                              </button>
                              <button type="button" class="btn ghost sm icon-only" data-md="quote" title={t.content.quote} aria-label={t.content.quote}>
                                 <Icon name="quote" size={18} />
                              </button>
                              <button type="button" class="btn ghost sm icon-only" data-md="list" title={t.content.bullets} aria-label={t.content.bullets}>
                                 <Icon name="listBullet" size={18} />
                              </button>
                              <button type="button" class="btn ghost sm icon-only" data-md="link" title={t.content.link} aria-label={t.content.link}>
                                 <Icon name="link" size={18} />
                              </button>
                              <button type="button" class="btn sm" data-md="video" data-open-picker="insert">
                                 <Icon name="film" size={18} /> {t.content.insertVideo}
                              </button>
                           </span>
                        </div>
                        <textarea id="f-body" spellcheck={true} class="textarea code" name="body" aria-labelledby="f-body-label" aria-describedby="f-body-help" lang={locale} dir="auto">
                           {s("body")}
                        </textarea>
                        <div class="md-preview card flat" data-md-preview hidden lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} tabindex={0} />
                        <p class="help" id="f-body-help">
                           {t.content.bodyHelp}
                        </p>
                     </div>
                     </div>
                  ) : null}
                  {kind === "posts" ? (
                     <div class="row2">
                        {scholarPost ? (
                           <div class="field">
                              <span class="label">{t.content.author}</span>
                              <p class="help" style="margin:0" data-scholar-byline>
                                 {scholar ? scholarName(scholar, locale) : t.scholars.noProfile}
                              </p>
                           </div>
                        ) : (
                           <div class="field">
                              <label for="f-author">{t.content.author}</label>
                              <input id="f-author" class="input" name="author_name" maxlength={120} value={s("author_name")} lang={locale} dir="auto" />
                           </div>
                        )}
                        <div class="field">
                           <label for="f-tag-input">{t.content.tags}</label>
                           <div class="tags input" data-tags>
                              {tagsOf(row?.tags).map((tag) => (
                                 <span class="tag" data-tag={tag}>
                                    <span dir="auto">{tag}</span>
                                    <button type="button" aria-label={`${t.content.removeTag}: ${tag}`} data-remove-tag>
                                       <Icon name="x" size={14} />
                                    </button>
                                 </span>
                              ))}
                              <input id="f-tag-input" spellcheck={true} maxlength={40} aria-describedby="f-tags-help" autocomplete="off" lang={locale} dir="auto" />
                           </div>
                           <p class="help" id="f-tags-help">
                              {t.content.tagsHelp}
                           </p>
                        </div>
                     </div>
                  ) : null}
               </section>

               {kind === "pages" ? (
                  <PageTypePanels v={v} type={pageType} id={id} locale={locale} filter={row?.list_filter ?? null} blocks={<BlocksEditor v={v} locale={locale} blocks={blocks} refs={refs} />} />
               ) : null}
               {kind === "posts" ? <SlidesEditor v={v} locale={locale} slides={slides} refs={refs} hidden={postKind !== "cards"} /> : null}

               <section class="card stack" aria-labelledby="seo-h">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                     <h2 id="seo-h" style="margin:0">
                        {t.content.seo}
                     </h2>
                     <AiSeoButton v={v} />
                  </div>
                  <div class="field">
                     <span style="display:flex;justify-content:space-between;gap:8px">
                        <label for="f-seo-title">{t.content.seoTitle}</label>
                        <Counter for="f-seo-title" max={60} />
                     </span>
                     <input id="f-seo-title" spellcheck={true} class="input" name="seo_title" maxlength={200} value={s("seo_title")} lang={locale} dir="auto" aria-describedby="f-seo-title-help" />
                     <p class="help" id="f-seo-title-help">
                        {t.content.seoTitleHelp}
                     </p>
                  </div>
                  <div class="field">
                     <span style="display:flex;justify-content:space-between;gap:8px">
                        <label for="f-seo-desc">{t.content.seoDescription}</label>
                        <Counter for="f-seo-desc" max={160} />
                     </span>
                     <textarea id="f-seo-desc" spellcheck={true} class="textarea" name="seo_description" maxlength={400} rows={2} lang={locale} dir="auto" aria-describedby="f-seo-desc-help" style="min-height:72px">
                        {s("seo_description")}
                     </textarea>
                     <p class="help" id="f-seo-desc-help">
                        {t.content.seoDescriptionHelp}
                     </p>
                  </div>
                  <div class="serp" aria-label={t.content.seoPreview} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
                     <span class="serp-url" dir="ltr">
                        {v.wwwUrl.replace(/^https:\/\//, "")} › {locale} › {kind === "posts" ? `${WWW_POSTS} › ` : ""}
                        <span data-serp-slug>{s("slug")}</span>
                     </span>
                     <span class="serp-title" data-serp-title>
                        {s("seo_title") || s("title")}
                     </span>
                     <span class="serp-desc" data-serp-desc>
                        {s("seo_description") || (kind === "pages" ? s("summary") : s("excerpt"))}
                     </span>
                  </div>
                  {kind === "posts" && !writer ? (
                     <div class="field">
                        <label class="switch">
                           <input type="checkbox" name="show_on_timeline" aria-describedby="f-timeline-help" checked={row ? row.show_on_timeline !== false && row.show_on_timeline !== 0 : true} />
                           {t.content.onTimeline}
                        </label>
                        <p class="help" id="f-timeline-help">
                           {t.content.onTimelineHelp}
                        </p>
                     </div>
                  ) : null}
                  <AiSeoPanel v={v} locale={locale} />
                  {kind === "pages" ? (
                     <label class="switch">
                        <input type="checkbox" name="show_in_sitemap" checked={row ? row.show_in_sitemap !== false && row.show_in_sitemap !== 0 : true} />
                        {t.content.sitemap}
                     </label>
                  ) : null}
               </section>
            </div>

            <aside class="stack sticky" aria-label={t.content.publishing}>
               <section class="card stack raised" aria-labelledby="pub-h" style="gap:14px">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                     <h2 id="pub-h" style="margin:0">
                        {t.content.publishing}
                     </h2>
                     <StateBadge v={v} state={state} attrs={{ "data-status-badge": "" }} />
                  </div>
                  {scheduled ? (
                     <div class="sched" data-schedule-callout>
                        <span class="sched-ic" aria-hidden="true">
                           <Icon name="clock" size={22} />
                        </span>
                        <span class="sched-l">{t.content.scheduledFor}</span>
                        <LocalTime class="sched-t" iso={publishAt} lang={v.prefs.lang} />
                        <p class="sched-note">{t.content.scheduledNote}</p>
                     </div>
                  ) : null}
                  {row ? null : (
                     <div class="field">
                        <span class="label">{t.content.newIn}</span>
                        <div class="seg" role="radiogroup" aria-label={t.content.newIn}>
                           {(["en", "ar"] as const).map((l) => (
                              <a href={`${base}/new?locale=${l}`} role="radio" aria-checked={l === locale ? "true" : "false"} aria-current={l === locale ? "true" : undefined}>
                                 {t.locales[l]}
                              </a>
                           ))}
                        </div>
                     </div>
                  )}
                  <dl class="meta-dl">
                     <dt>{t.common.language}</dt>
                     <dd>{t.locales[locale]}</dd>
                     <dt>{t.common.updated}</dt>
                     <dd>{row ? relative(row.updated_at, v.prefs.lang) : "—"}</dd>
                     <dt>{t.common.firstPublished}</dt>
                     <dd>{wentLive ? <LocalTime iso={row?.published_at} lang={v.prefs.lang} /> : t.common.never}</dd>
                  </dl>
                  <div class="pub-actions">
                     {published ? (
                        <>
                           <button class="btn primary" type="submit" data-action="published">
                              <Icon name="check" size={18} /> {t.common.save}
                           </button>
                           <button class="btn" type="submit" data-action="draft">
                              <Icon name="eyeOff" size={18} /> {t.common.unpublish}
                           </button>
                        </>
                     ) : scheduled ? (
                        <>
                           <button class="btn primary" type="submit" data-action="schedule">
                              <Icon name="check" size={18} /> {t.common.save}
                           </button>
                           <button class="btn" type="submit" data-action="published">
                              <Icon name="globe" size={18} /> {t.content.publishNow}
                           </button>
                           <button class="btn ghost" type="submit" data-action="draft">
                              <Icon name="x" size={18} /> {t.content.unschedule}
                           </button>
                        </>
                     ) : (
                        <>
                           <button class="btn primary" type="submit" data-action="published">
                              <Icon name="globe" size={18} /> {t.common.publish}
                           </button>
                           <button class="btn" type="submit" data-action="draft">
                              {t.common.saveDraft}
                           </button>
                        </>
                     )}
                  </div>
                  {published ? null : (
                     <details class="later" data-later>
                        <summary>
                           <Icon name="calendar" size={18} /> {scheduled ? t.content.changeTime : t.content.later}
                        </summary>
                        <div class="later-b">
                           <div class="field">
                              <label for="f-publish-at">{t.content.goLiveAt}</label>
                              <input id="f-publish-at" class="input" type="datetime-local" name="publish_at" data-iso={publishAt} aria-describedby="f-publish-at-help f-publish-at-err" />
                              <p class="help" id="f-publish-at-help">
                                 {t.content.timeZone} <span data-tz>UTC</span>
                              </p>
                              <p class="err" id="f-publish-at-err" hidden />
                           </div>
                           {scheduled ? null : (
                              <button class="btn" type="submit" data-action="schedule">
                                 <Icon name="clock" size={18} /> {t.content.scheduleButton}
                              </button>
                           )}
                        </div>
                     </details>
                  )}
                  <p class="help" data-dirty hidden role="status">
                     {t.common.unsaved}
                  </p>
                  {row && !published ? (
                     <p class="help" id="preview-help" data-preview-help>
                        {t.common.previewHelp}
                     </p>
                  ) : null}
                  <AiCheckButton v={v} />
                  {row && (isAdmin(v) || writer) ? (
                     <button class="btn danger sm" type="button" data-delete style="justify-self:start">
                        <Icon name="trash" size={16} /> {t.common.delete}
                     </button>
                  ) : null}
               </section>

               {scholarPost && row ? <MainSiteCard v={v} row={row} scholar={scholar} locale={locale} sitePath={sitePath} /> : null}

               <section class="card stack" aria-labelledby="cover-h" data-cover={cover ? String(cover.id) : ""} data-cover-path={cover?.path ?? ""}>
                  <h2 id="cover-h">{t.content.cover}</h2>
                  {!id ? (
                     <p class="help">{t.content.coverAfterSave}</p>
                  ) : (
                     <>
                        {cover ? (
                           <img class="cover-img" src={`/api/public/v1/media/${cover.path.split("/").map(encodeURIComponent).join("/")}`} alt={altOf(cover)} />
                        ) : null}
                        <label class="drop" data-drop>
                           <Icon name="upload" size={22} />
                           <span>{cover ? t.content.coverReplace : t.content.coverDrop}</span>
                           <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-cover-input class="vh" />
                        </label>
                        <p class="help">{t.content.coverHelp}</p>
                        <p class="err" data-cover-err hidden role="alert" />
                        {cover ? (
                           <>
                              <div class="field">
                                 <label for="f-alt">{t.content.alt}</label>
                                 <input id="f-alt" spellcheck={true} class="input" maxlength={300} value={altOf(cover)} lang={locale} dir="auto" aria-describedby="f-alt-help" data-alt-input />
                                 <p class="help" id="f-alt-help">
                                    {t.content.altHelp}
                                 </p>
                              </div>
                              <div class="ph-actions">
                                 <button class="btn sm" type="button" data-alt-save>
                                    {t.content.altSave}
                                 </button>
                                 {isAdmin(v) ? (
                                    <button class="btn ghost sm" type="button" data-cover-remove>
                                       <Icon name="trash" size={16} /> {t.content.coverRemove}
                                    </button>
                                 ) : null}
                              </div>
                           </>
                        ) : null}
                     </>
                  )}
               </section>

               <section class="card stack" aria-labelledby="tr-h">
                  <h2 id="tr-h">{t.content.translations}</h2>
                  <p class="help">{t.content.translationsHelp}</p>
                  {translations.data.length ? (
                     <ul class="list">
                        {translations.data.map((r: Row) => (
                           <li class="li" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 12px">
                              <div class="li-body">
                                 <a class="li-title" href={`${base}/${r.id}`} lang={String(r.locale)} dir="auto" data-translation-link>
                                    {String(r.title ?? "")}
                                 </a>
                                 <div class="li-meta">
                                    <span class="badge loc">{String(r.locale).toUpperCase()}</span>
                                 </div>
                              </div>
                              <StateBadge v={v} state={publishState(r)} />
                           </li>
                        ))}
                     </ul>
                  ) : row ? (
                     <button class="btn" type="button" data-add-translation={other}>
                        <Icon name="languages" size={18} /> {t.content.addTranslation(t.locales[other])}
                     </button>
                  ) : (
                     <p class="help">{t.content.noTranslation}</p>
                  )}
                  {row ? <p class="help">{t.content.lockedLocale}</p> : null}
               </section>
               {history}
               <AiCard v={v} locale={locale} other={other} saved={!!row} siblingId={translations.data[0] ? Number(translations.data[0].id) : null} />
               {flags ? <TrFlagsCard v={v} canResolve={canResolveFlags} /> : null}
            </aside>
            <div class="actbar" role="group" aria-label={t.content.publishing}>
               <button class="btn primary" type="submit" data-action={scheduled ? "schedule" : "published"}>
                  {published || scheduled ? t.common.save : t.common.publish}
               </button>
               <button class="btn" type="submit" data-action="draft">
                  {published ? t.common.unpublish : scheduled ? t.content.unschedule : t.common.saveDraft}
               </button>
            </div>
         </form>
         <PickerDialog v={v} kinds={kind === "pages" ? ["video", "playlist", "channel"] : undefined} />
         <MediaDialog v={v} />
         {kind === "pages" ? <PostsDialog v={v} locale={locale} /> : null}
         <AiDialogs v={v} locale={locale} other={other} kind={kind} />
         {flags ? (
            <>
               <TrFlagsDialogs v={v} locale={locale} other={other} />
               <TrFlagsPopover v={v} />
            </>
         ) : null}
         <ConfirmDialog v={v} title={t.common.confirmDelete} body={t.common.confirmDeleteBody} reason />
      </>
   );
}
