/** @jsxImportSource hono/jsx */
/**
 * Scholars (docs/SCHOLARS.md): a scholar's own profile, the staff Scholars list and profile editor,
 * the Featuring screen (featured candidates: recent scholar articles and channel videos), and the
 * "Main site" card on a scholar post's editor.
 */
import { trimSlash, type Env } from "../../env.ts";
import { stableImageUrl } from "../../lib/stable-thumb.ts";
import { mediaUrl } from "../../lib/media-ref.ts";
import { articleCandidates, featuredVideoKeys } from "../../lib/scholars/featuring.ts";
import { BIO_MAX, listScholars, NAME_MAX, scholarName, SLUG_MAX, type Scholar } from "../../lib/scholars/profiles.ts";
import type { OwnedChannel } from "../../lib/scholars/videos-internal.ts";
import { channelVideos, type ItemDetail } from "../../lib/videos.ts";
import { errText, log } from "../../lib/log.ts";
import type { Row } from "../data.ts";
import { Autocomplete, comboboxProps } from "../ui/autocomplete.tsx";
import { Icon } from "../ui/icons.tsx";
import { Empty, isAdmin, isWriter, PageHead, type View } from "../ui/layout.tsx";
import { PickerDialog } from "../ui/picker.tsx";
import { ConfirmDialog, I18nScript, LocalTime } from "../ui/parts.tsx";
import { MediaDialog } from "./blocks.tsx";

/** www's scholar page for a profile. */
export const scholarPageUrl = (v: View, s: Pick<Scholar, "slug">, locale: "en" | "ar" = v.prefs.lang) => `${v.wwwUrl}/${locale}/scholars/${encodeURIComponent(s.slug)}/`;

/**
 * Strings for the media dialog (avatar) and the video picker, which reuse the editor's client code.
 * The scholars client's own strings are in the shell (#i18n-shell `sch`).
 */
function clientStrings(v: View) {
   const { t } = v;
   const P0 = "{0}" as unknown as number;
   return {
      blocks: { ...t.blocks, position: "", moved: "", added: "", duplicated: "", removed: "", mediaUseMany: t.blocks.mediaUseMany(P0), mediaUseOne: t.blocks.mediaUseMany(1), mediaUploading: t.blocks.mediaUploading("{0}") },
      picker: t.picker,
   };
}

/* ── Profile (the scholar's own, or staff editing one) ─────────────────────────────────────────── */

export function profileScreen(
   v: View,
   o: {
      scholar: Scholar;
      channels: OwnedChannel[] | null;
      avatarPath: string | null;
      endpoint: string;
      publicUrl: string;
      posts?: number;
      /** The account's name per language (display name, else first + last): the hint on an empty name field. */
      accountNames?: { en: string; ar: string };
   },
) {
   const { t } = v;
   const s = o.scholar;
   const tt = t.scholars;
   const own = isWriter(v);
   const avatar = o.avatarPath ? mediaUrl(o.publicUrl, o.avatarPath) : null;
   const linked = new Set(s.channel_ids);
   // Channels linked earlier that the videos API no longer lists as theirs stay visible (unchecked on save).
   // An empty name field shows the account's name (display name, else first + last) as its hint.
   const hintEn = !s.name_en?.trim() ? (o.accountNames?.en ?? "") : "";
   const hintAr = !s.name_ar?.trim() ? (o.accountNames?.ar ?? "") : "";
   const nameHint = (l: "en" | "ar") => {
      const h = l === "en" ? hintEn : hintAr;
      return h ? { placeholder: h, "aria-describedby": `sp-name-${l}-hint` } : {};
   };
   const channels: OwnedChannel[] = o.channels ? [...o.channels, ...s.channel_ids.filter((id) => !o.channels!.some((c) => c.id === id)).map((id) => ({ id, name: tt.channelGone, handle: null, avatarUrl: null, isPublic: false }))] : [];
   return (
      <>
         <PageHead title={own ? tt.myProfile : scholarName(s, v.prefs.lang)} intro={own ? tt.myProfileIntro : tt.profileIntro} back={own ? undefined : { href: "/scholars", label: tt.title }}>
            <a class="btn ghost" href={scholarPageUrl(v, s)} target="_blank" rel="noopener">
               <Icon name="external" size={18} class="flip" /> {tt.viewPage}
            </a>
         </PageHead>
         <form class="stack" data-scholar-form data-endpoint={o.endpoint} data-updated={s.updated_at} novalidate style="max-width:820px">
            <section class="card stack" aria-labelledby="sp-who">
               <h2 id="sp-who">{tt.identity}</h2>
               <div class="row2">
                  <div class="field">
                     <label for="sp-name-en">{tt.nameEn}</label>
                     <input id="sp-name-en" class="input" name="name_en" maxlength={NAME_MAX} value={s.name_en ?? ""} lang="en" dir="ltr" autocomplete="off" {...nameHint("en")} />
                     {hintEn ? (
                        <p class="help" id="sp-name-en-hint">
                           {tt.accountName(hintEn)}
                        </p>
                     ) : null}
                  </div>
                  <div class="field">
                     <label for="sp-name-ar">{tt.nameAr}</label>
                     <input id="sp-name-ar" class="input" name="name_ar" maxlength={NAME_MAX} value={s.name_ar ?? ""} lang="ar" dir="rtl" autocomplete="off" {...nameHint("ar")} />
                     {hintAr ? (
                        <p class="help" id="sp-name-ar-hint">
                           {tt.accountName(hintAr)}
                        </p>
                     ) : null}
                  </div>
               </div>
               <div class="field">
                  <label for="sp-slug">{tt.slug}</label>
                  <input id="sp-slug" class="input" name="slug" maxlength={SLUG_MAX} value={s.slug} dir="ltr" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="sp-slug-help sp-slug-err" autocomplete="off" />
                  <p class="help" id="sp-slug-help">
                     {tt.slugHelp} <span dir="ltr">{`${v.wwwUrl.replace(/^https:\/\//, "")}/${v.prefs.lang}/scholars/`}</span>
                  </p>
                  <p class="err" id="sp-slug-err" hidden />
               </div>
               <div class="field">
                  <label for="sp-bio-en">{tt.bioEn}</label>
                  <textarea id="sp-bio-en" class="textarea" name="bio_en" maxlength={BIO_MAX} rows={5} lang="en" dir="ltr" spellcheck={true}>
                     {s.bio_en ?? ""}
                  </textarea>
               </div>
               <div class="field">
                  <label for="sp-bio-ar">{tt.bioAr}</label>
                  <textarea id="sp-bio-ar" class="textarea" name="bio_ar" maxlength={BIO_MAX} rows={5} lang="ar" dir="rtl" spellcheck={true}>
                     {s.bio_ar ?? ""}
                  </textarea>
               </div>
            </section>

            <section class="card stack" aria-labelledby="sp-avatar-h" data-avatar={s.avatar_media_id ? String(s.avatar_media_id) : ""}>
               <h2 id="sp-avatar-h">{tt.avatar}</h2>
               <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
                  <img class="avatar-lg" data-avatar-img src={avatar ?? ""} alt="" width={96} height={96} hidden={!avatar} style="width:96px;height:96px;border-radius:50%;object-fit:cover" />
                  <div class="ph-actions">
                     <button class="btn sm" type="button" data-avatar-choose aria-haspopup="dialog">
                        <Icon name="image" size={16} /> {tt.avatarChoose}
                     </button>
                     <button class="btn ghost sm" type="button" data-avatar-remove hidden={!avatar}>
                        <Icon name="x" size={16} /> {tt.avatarRemove}
                     </button>
                  </div>
               </div>
               <p class="help">{tt.avatarHelp}</p>
            </section>

            <section class="card stack" aria-labelledby="sp-ch-h">
               <h2 id="sp-ch-h">{tt.channels}</h2>
               <p class="help" id="sp-ch-help">
                  {tt.channelsHelp}
               </p>
               {o.channels === null ? (
                  <p class="notice bad" role="status">
                     {tt.channelsUnavailable}
                  </p>
               ) : channels.length ? (
                  <fieldset class="stack" style="border:0;padding:0;margin:0" aria-describedby="sp-ch-help" data-channels>
                     <legend class="vh">{tt.channels}</legend>
                     {channels.map((ch) => (
                        <label class="switch">
                           <input type="checkbox" name="channel_ids" value={ch.id} checked={linked.has(ch.id)} />
                           <span dir="auto">{ch.name}</span>
                           {ch.handle ? (
                              <span class="muted" dir="ltr">
                                 @{ch.handle}
                              </span>
                           ) : null}
                        </label>
                     ))}
                  </fieldset>
               ) : (
                  <p class="help">{tt.noChannels}</p>
               )}
            </section>

            <div class="ph-actions">
               <button class="btn primary" type="submit">
                  <Icon name="check" size={18} /> {t.common.save}
               </button>
               {!own && isAdmin(v) ? (
                  <button class="btn danger sm" type="button" data-scholar-delete data-endpoint={o.endpoint}>
                     <Icon name="trash" size={16} /> {tt.deleteProfile}
                  </button>
               ) : null}
            </div>
         </form>
         <MediaDialog v={v} />
         <ConfirmDialog v={v} title={tt.deleteTitle} body={tt.deleteBody} reason />
         <I18nScript nonce={v.nonce} strings={clientStrings(v)} />
      </>
   );
}

/* ── Staff: Scholars list ──────────────────────────────────────────────────────────────────────── */

const PAGE = 30;

export async function scholarsListScreen(v: View, db: D1Database, q: string, page: number) {
   const { t } = v;
   const tt = t.scholars;
   const res = await listScholars(db, { q, limit: PAGE, offset: (page - 1) * PAGE });
   const pages = Math.max(1, Math.ceil(res.total / PAGE));
   return (
      <>
         <PageHead title={tt.title} intro={tt.intro} />
         <form class="toolbar" method="get" action="/scholars" role="search">
            <Autocomplete kind="scholars" listId="sch-q-list" label={tt.search}>
               <div class="search">
                  <label class="vh" for="sch-q">
                     {tt.search}
                  </label>
                  <input id="sch-q" name="q" type="search" value={q} placeholder={tt.search} maxlength={100} {...comboboxProps("sch-q-list")} />
               </div>
            </Autocomplete>
            {q ? (
               <a class="btn ghost sm" href="/scholars">
                  {t.common.clear}
               </a>
            ) : null}
         </form>
         <p class="muted" role="status" style="margin:0 0 12px;font-size:14px">
            {t.common.results(res.total)}
         </p>
         {res.items.length ? (
            <ul class="list" data-list="scholars">
               {res.items.map((s) => (
                  <li class="li" style="grid-template-columns:minmax(0,1fr) auto">
                     <div class="li-body">
                        <a class="li-title" href={`/scholars/${s.id}`} dir="auto">
                           {scholarName(s, v.prefs.lang)}
                        </a>
                        <div class="li-meta">
                           <span dir="ltr">/scholars/{s.slug}</span>
                           <span>{tt.postsCount(s.posts)}</span>
                           <span>{tt.channelsCount(s.channel_ids.length)}</span>
                        </div>
                     </div>
                     <a class="btn ghost sm" href={scholarPageUrl(v, s)} target="_blank" rel="noopener">
                        <Icon name="external" size={16} class="flip" /> {tt.viewPage}
                     </a>
                  </li>
               ))}
            </ul>
         ) : (
            <Empty icon="users" title={q ? t.common.emptySearch : tt.empty} body={q ? undefined : tt.emptyHelp} />
         )}
         {pages > 1 ? (
            <nav class="pager" aria-label={t.common.page(page, pages)}>
               {page > 1 ? (
                  <a class="btn sm" href={`/scholars?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`} rel="prev">
                     <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                  </a>
               ) : (
                  <span />
               )}
               <span class="muted">{t.common.page(page, pages)}</span>
               {page < pages ? (
                  <a class="btn sm" href={`/scholars?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} rel="next">
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

/* ── Staff: Featuring (featured candidates) ────────────────────────────────────────────────────── */

export interface FeaturingParams {
   tab: "articles" | "videos";
   q: string;
   state: "all" | "featured" | "not_featured";
   page: number;
}

export function parseFeaturingParams(url: URL): FeaturingParams {
   const g = (k: string) => url.searchParams.get(k) ?? "";
   const state = g("state");
   const page = Number.parseInt(g("page"), 10);
   return {
      tab: g("tab") === "videos" ? "videos" : "articles",
      q: g("q").trim().slice(0, 100),
      state: state === "featured" || state === "not_featured" ? state : "all",
      page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
   };
}

/** Scholars (with channels) shown per Videos page, and videos per scholar. */
const VIDEO_SCHOLARS = 6;
const VIDEOS_EACH = 6;

export async function featuringScreen(v: View, env: Env, p: FeaturingParams, videosApiUrl: string, fetchImpl: typeof fetch) {
   const { t } = v;
   const tf = t.featuring;
   const tab = (id: FeaturingParams["tab"], label: string) => (
      <a href={`/featuring?tab=${id}`} aria-current={p.tab === id ? "page" : undefined}>
         {label}
      </a>
   );
   const head = (
      <>
         <PageHead title={tf.title} intro={tf.intro} />
         <nav class="seg" aria-label={tf.title} style="margin-block-end:16px">
            {tab("articles", tf.articles)}
            {tab("videos", tf.videos)}
         </nav>
      </>
   );
   if (p.tab === "articles") {
      const res = await articleCandidates(env, { q: p.q, state: p.state, limit: PAGE, offset: (p.page - 1) * PAGE });
      const pages = Math.max(1, Math.ceil(res.total / PAGE));
      const qs = (over: Partial<FeaturingParams>) => {
         const m = { ...p, ...over };
         const s = new URLSearchParams();
         if (m.q) s.set("q", m.q);
         if (m.state !== "all") s.set("state", m.state);
         if (m.page > 1) s.set("page", String(m.page));
         return `/featuring${s.toString() ? `?${s}` : ""}`;
      };
      return (
         <>
            {head}
            <form class="toolbar" method="get" action="/featuring" role="search">
               <Autocomplete kind="scholar-posts" listId="ft-q-list" label={tf.search}>
                  <div class="search">
                     <label class="vh" for="ft-q">
                        {tf.search}
                     </label>
                     <input id="ft-q" name="q" type="search" value={p.q} placeholder={tf.search} maxlength={100} {...comboboxProps("ft-q-list")} />
                     {p.state !== "all" ? <input type="hidden" name="state" value={p.state} /> : null}
                  </div>
               </Autocomplete>
               <div class="seg" role="group" aria-label={t.common.filters}>
                  {(["all", "not_featured", "featured"] as const).map((st) => (
                     <a href={qs({ state: st, page: 1 })} aria-current={p.state === st ? "true" : undefined}>
                        {st === "all" ? tf.all : st === "featured" ? tf.featured : tf.notFeatured}
                     </a>
                  ))}
               </div>
            </form>
            <p class="muted" role="status" style="margin:0 0 12px;font-size:14px">
               {t.common.results(res.total)}
            </p>
            {res.items.length ? (
               <ul class="list" data-list="featuring">
                  {res.items.map((a) => (
                     <li class="li" style="grid-template-columns:minmax(0,1fr) auto" data-candidate={String(a.id)}>
                        <div class="li-body">
                           {a.ref ? (
                              // A reference: scholars edit the post in Studio; editors only feature it.
                              <a class="li-title" href={`${trimSlash(env.WWW_URL || "https://www.alummahnow.net")}/${a.locale}/articles/${encodeURIComponent(a.slug)}/`} lang={a.locale} dir="auto">
                                 {a.title}
                              </a>
                           ) : (
                              <a class="li-title" href={`/posts/${a.id}`} lang={a.locale} dir="auto">
                                 {a.title}
                              </a>
                           )}
                           <div class="li-meta">
                              <span class="badge loc">{a.locale.toUpperCase()}</span>
                              {a.scholar ? (
                                 <a href={`/scholars/${a.scholar.id}`} dir="auto">
                                    {scholarName(a.scholar, v.prefs.lang)}
                                 </a>
                              ) : null}
                              {a.kind !== "article" ? <span>{tf.kinds[a.kind] ?? a.kind}</span> : null}
                              {a.ref && a.ref.channel_id ? (
                                 <a href={`${trimSlash(env.VIDEOS_WEB_URL)}/${v.prefs.lang}/settings/channel/${encodeURIComponent(a.ref.channel_id)}/community`} data-open-studio>
                                    {tf.openInStudio}
                                 </a>
                              ) : null}
                              {a.published_at ? <LocalTime iso={a.published_at} lang={v.prefs.lang} /> : null}
                              {a.featured_at ? (
                                 <span class="badge published">
                                    {tf.featured}
                                    {a.featured_by ? ` · ${a.featured_by}` : ""}
                                 </span>
                              ) : null}
                           </div>
                        </div>
                        <FeatureButton v={v} id={a.id} featured={!!a.featured_at} title={a.title} />
                     </li>
                  ))}
               </ul>
            ) : (
               <Empty icon="star" title={p.q || p.state !== "all" ? t.common.emptySearch : tf.empty} body={p.q ? undefined : tf.emptyHelp} />
            )}
            {pages > 1 ? (
               <nav class="pager" aria-label={t.common.page(p.page, pages)}>
                  {p.page > 1 ? (
                     <a class="btn sm" href={qs({ page: p.page - 1 })} rel="prev">
                        <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                     </a>
                  ) : (
                     <span />
                  )}
                  <span class="muted">{t.common.page(p.page, pages)}</span>
                  {p.page < pages ? (
                     <a class="btn sm" href={qs({ page: p.page + 1 })} rel="next">
                        {t.common.next} <Icon name="chevronEnd" size={16} class="flip" />
                     </a>
                  ) : (
                     <span />
                  )}
               </nav>
            ) : null}
            <I18nScript nonce={v.nonce} strings={clientStrings(v)} />
         </>
      );
   }

   // Videos: the latest public videos of scholars' channels (most recently updated profiles first).
   const { results } = await env.DB.prepare(
      `SELECT * FROM scholars WHERE json_valid(channel_ids) AND json_array_length(channel_ids) > 0 ORDER BY updated_at DESC, id DESC LIMIT ?1 OFFSET ?2`,
   )
      .bind(VIDEO_SCHOLARS + 1, (p.page - 1) * VIDEO_SCHOLARS)
      .all<Row>();
   const more = results.length > VIDEO_SCHOLARS;
   const scholars = results.slice(0, VIDEO_SCHOLARS).map((r) => ({ id: Number(r.id), slug: String(r.slug), name_en: (r.name_en as string | null) ?? null, name_ar: (r.name_ar as string | null) ?? null, channel: (JSON.parse(String(r.channel_ids)) as string[])[0] }));
   const lists = await Promise.all(
      scholars.map(async (s) => {
         try {
            return { s, items: (await channelVideos(videosApiUrl, s.channel, { limit: VIDEOS_EACH }, fetchImpl)).items, failed: false };
         } catch (error) {
            log.warn("featuring: channel videos unavailable", { channel: s.channel, error: errText(error) });
            return { s, items: [] as ItemDetail[], failed: true };
         }
      }),
   );
   const keys = await featuredVideoKeys(
      env.DB,
      lists.flatMap((l) => l.items.map((i) => i.id)),
   );
   return (
      <>
         {head}
         <div class="toolbar">
            <button class="btn primary" type="button" data-feature-pick aria-haspopup="dialog">
               <Icon name="search" size={18} /> {tf.pickVideo}
            </button>
            <p class="help" style="margin:0">
               {tf.pickVideoHelp}
            </p>
         </div>
         {lists.length ? (
            lists.map(({ s, items, failed }) => (
               <section class="card stack" aria-labelledby={`fv-${s.id}`} style="margin-block-end:16px">
                  <h2 id={`fv-${s.id}`} style="margin:0" dir="auto">
                     <a href={`/scholars/${s.id}`}>{scholarName(s, v.prefs.lang)}</a>
                  </h2>
                  {failed ? (
                     <p class="notice bad" role="status">
                        {tf.videosUnavailable}
                     </p>
                  ) : items.length ? (
                     <ul class="list">
                        {items.map((it) => {
                           const key = keys.get(it.id);
                           const thumb = stableImageUrl(trimSlash(env.VIDEOS_WEB_URL), it.thumbnail_url, it.id);
                           return (
                              <li class="li" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center">
                                 {thumb ? <img src={thumb} alt="" width={96} height={54} loading="lazy" style="width:96px;height:54px;object-fit:cover;border-radius:6px" /> : <span />}
                                 <div class="li-body">
                                    <span class="li-title" dir="auto">
                                       {it.title}
                                    </span>
                                    <div class="li-meta">
                                       {it.upload_date ? <LocalTime iso={it.upload_date} lang={v.prefs.lang} /> : null}
                                       {key ? <span class="badge published">{tf.featured}</span> : null}
                                    </div>
                                 </div>
                                 {key ? (
                                    <button class="btn sm" type="button" data-unfeature-video={key} aria-label={`${tf.unfeature}: ${it.title}`}>
                                       <Icon name="x" size={16} /> {tf.unfeature}
                                    </button>
                                 ) : (
                                    <button class="btn primary sm" type="button" data-feature-video={it.id} aria-label={`${tf.feature}: ${it.title}`}>
                                       <Icon name="star" size={16} /> {tf.feature}
                                    </button>
                                 )}
                              </li>
                           );
                        })}
                     </ul>
                  ) : (
                     <p class="help">{tf.noVideos}</p>
                  )}
               </section>
            ))
         ) : (
            <Empty icon="play" title={tf.noScholarVideos} />
         )}
         {p.page > 1 || more ? (
            <nav class="pager" aria-label={t.common.page(p.page, p.page + (more ? 1 : 0))}>
               {p.page > 1 ? (
                  <a class="btn sm" href={`/featuring?tab=videos&page=${p.page - 1}`} rel="prev">
                     <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                  </a>
               ) : (
                  <span />
               )}
               <span />
               {more ? (
                  <a class="btn sm" href={`/featuring?tab=videos&page=${p.page + 1}`} rel="next">
                     {t.common.next} <Icon name="chevronEnd" size={16} class="flip" />
                  </a>
               ) : (
                  <span />
               )}
            </nav>
         ) : null}
         <ConfirmDialog v={v} title={tf.unfeatureVideoTitle} body={tf.unfeatureVideoBody} ok={tf.unfeature} okIcon="x" />
         <PickerDialog v={v} kinds={["video"]} />
         <I18nScript nonce={v.nonce} strings={clientStrings(v)} />
      </>
   );
}

function FeatureButton(props: { v: View; id: number; featured: boolean; title: string }) {
   const tf = props.v.t.featuring;
   return props.featured ? (
      <button class="btn sm" type="button" data-feature-post={String(props.id)} data-on="false" aria-label={`${tf.unfeature}: ${props.title}`}>
         <Icon name="x" size={16} /> {tf.unfeature}
      </button>
   ) : (
      <button class="btn primary sm" type="button" data-feature-post={String(props.id)} data-on="true" aria-label={`${tf.feature}: ${props.title}`}>
         <Icon name="star" size={16} /> {tf.feature}
      </button>
   );
}

/* ── Editor: the "Main site" card on a scholar's post ──────────────────────────────────────────── */

export function MainSiteCard(props: { v: View; row: Row; scholar: Scholar | null; locale: "en" | "ar"; sitePath: string }) {
   const { v, row, scholar } = props;
   const tf = v.t.featuring;
   const featured = !!row.featured_at;
   return (
      <section class="card stack" aria-labelledby="ms-h" data-main-site>
         <h2 id="ms-h">{tf.mainSite}</h2>
         <p class="help" style="margin:0">
            {featured ? tf.featuredHelp : isWriter(v) ? tf.notFeaturedWriterHelp : tf.notFeaturedHelp}
         </p>
         {featured ? (
            <p style="margin:0">
               <span class="badge published">{tf.featured}</span>
            </p>
         ) : null}
         {scholar ? (
            <a class="btn ghost sm" href={scholarPageUrl(v, scholar, props.locale)} target="_blank" rel="noopener" style="justify-self:start">
               <Icon name="external" size={16} class="flip" /> {v.t.scholars.viewPage}
            </a>
         ) : (
            <p class="help">{v.t.scholars.noProfile}</p>
         )}
         {row.community_post_id ? <p class="help" style="margin:0">{v.t.scholars.onCommunity}</p> : null}
         {isWriter(v) ? null : <FeatureButton v={v} id={Number(row.id)} featured={featured} title={String(row.title ?? "")} />}
      </section>
   );
}
