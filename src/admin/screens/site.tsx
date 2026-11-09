/** @jsxImportSource hono/jsx */
/** Navigation, Videos, Site settings and Library (docs/ADMIN_UI_SPEC.md E17–E36, A8, A11–A13, X1). */
import type { Data, Row } from "../data.ts";
import { bytes, relative } from "../format.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty, isAdmin, PageHead, type View } from "../ui/layout.tsx";
import { ConfirmDialog, I18nScript } from "../ui/parts.tsx";
import { PickerDialog } from "../ui/picker.tsx";

const parse = (v: unknown): unknown => {
   if (typeof v !== "string") return v;
   try {
      return JSON.parse(v);
   } catch {
      return null;
   }
};

function Seg(props: { label: string; items: { href: string; label: string; on: boolean }[] }) {
   return (
      <div class="seg" role="group" aria-label={props.label}>
         {props.items.map((i) => (
            <a href={i.href} aria-current={i.on ? "true" : undefined}>
               {i.label}
            </a>
         ))}
      </div>
   );
}

function RowTools(props: { v: View; label: string }) {
   const { t } = props.v;
   return (
      <span class="row-tools">
         <button type="button" class="btn ghost sm icon-only" data-move="up" aria-label={`${t.common.moveUp}: ${props.label}`} title={t.common.moveUp}>
            <Icon name="up" size={18} />
         </button>
         <button type="button" class="btn ghost sm icon-only" data-move="down" aria-label={`${t.common.moveDown}: ${props.label}`} title={t.common.moveDown}>
            <Icon name="down" size={18} />
         </button>
         {isAdmin(props.v) ? (
            <button type="button" class="btn ghost sm icon-only danger-ic" data-row-delete aria-label={`${t.common.delete}: ${props.label}`} title={t.common.delete}>
               <Icon name="trash" size={18} />
            </button>
         ) : null}
      </span>
   );
}

function Visibility(props: { v: View; on: boolean; label: string }) {
   return (
      <label class="switch sm" title={props.v.t.common.visible}>
         <input type="checkbox" data-field="status" data-on="published" data-off="draft" checked={props.on} aria-label={`${props.v.t.common.visible}: ${props.label}`} />
         <span class="vis-label">{props.on ? props.v.t.status.published : props.v.t.status.draft}</span>
      </label>
   );
}

const rowStrings = (v: View, extra: Record<string, unknown> = {}) => ({
   failed: v.t.common.failed,
   saved: v.t.common.saved,
   reordered: v.t.common.reordered,
   published: v.t.status.published,
   draft: v.t.status.draft,
   urlBad: v.t.menus.urlBad,
   required: v.t.common.required,
   picker: v.t.picker,
   ...extra,
});

/* Navigation */

export async function navigationScreen(v: View, data: Data, menu: "header" | "footer", locale: "en" | "ar") {
   const { t } = v;
   const rows = await data.list("nav_items", { limit: 200, sort: "sort", where: { menu, locale } });
   const q = (m: string, l: string) => `/navigation?menu=${m}&locale=${l}`;
   const maxSort = rows.data.reduce((m, r) => Math.max(m, Number(r.sort ?? 0)), 0);
   return (
      <>
         <I18nScript nonce={v.nonce} strings={rowStrings(v)} />
         <PageHead title={t.menus.title} intro={t.menus.intro} />
         <div class="toolbar">
            <Seg label={t.menus.title} items={(["header", "footer"] as const).map((m) => ({ href: q(m, locale), label: t.menus[m], on: m === menu }))} />
            <Seg label={t.common.language} items={(["en", "ar"] as const).map((l) => ({ href: q(menu, l), label: t.locales[l], on: l === locale }))} />
         </div>
         <section class="card stack" aria-label={`${t.menus[menu]} · ${t.locales[locale]}`}>
            {rows.data.length ? (
               <ol class="rows" data-rows="nav_items" aria-describedby="drag-hint">
                  {rows.data.map((r: Row) => (
                     <li class="row" data-id={String(r.id)} data-sort={String(r.sort ?? 0)} draggable="true">
                        <span class="grip" aria-hidden="true">
                           <Icon name="grip" size={18} />
                        </span>
                        <div class="row-fields">
                           <div class="field">
                              <label class="vh" for={`nl-${r.id}`}>
                                 {t.menus.label}
                              </label>
                              <input id={`nl-${r.id}`} class="input" data-field="label" value={String(r.label ?? "")} required maxlength={80} lang={locale} dir="auto" placeholder={t.menus.label} />
                           </div>
                           <div class="field">
                              <label class="vh" for={`nu-${r.id}`}>
                                 {t.menus.url}
                              </label>
                              <input id={`nu-${r.id}`} class="input" data-field="url" data-validate="navurl" value={String(r.url ?? "")} required maxlength={2048} dir="ltr" placeholder="/about" />
                           </div>
                        </div>
                        <Visibility v={v} on={r.status === "published"} label={String(r.label ?? "")} />
                        <RowTools v={v} label={String(r.label ?? "")} />
                     </li>
                  ))}
               </ol>
            ) : (
               <Empty icon="list" title={t.menus.empty} />
            )}
            <p class="help" id="drag-hint">
               {t.common.dragHint}
            </p>
            <form class="row add-row" data-row-add="nav_items" novalidate>
               <input type="hidden" name="menu" value={menu} />
               <input type="hidden" name="locale" value={locale} />
               <input type="hidden" name="sort" value={String(maxSort + 10)} />
               <input type="hidden" name="status" value="published" />
               <div class="row-fields">
                  <div class="field">
                     <label for="new-label">{t.menus.label}</label>
                     <input id="new-label" class="input" name="label" required maxlength={80} lang={locale} dir="auto" />
                  </div>
                  <div class="field">
                     <label for="new-url">{t.menus.url}</label>
                     <input id="new-url" class="input" name="url" required maxlength={2048} dir="ltr" placeholder="/about" data-validate="navurl" aria-describedby="new-url-help" />
                  </div>
               </div>
               <button class="btn primary" type="submit">
                  <Icon name="plus" size={18} /> {t.menus.add}
               </button>
               <p class="help" id="new-url-help" style="grid-column:1/-1">
                  {t.menus.urlHelp}
               </p>
               <p class="err" data-add-err hidden role="alert" style="grid-column:1/-1" />
            </form>
         </section>
         <ConfirmDialog v={v} title={t.common.confirmDelete} body={t.common.confirmDeleteBody} />
      </>
   );
}

/* Videos */

interface Snap {
   title?: string;
   thumbnail_url?: string | null;
   channel_name?: string | null;
}

const KIND_ICON: Record<string, IconName> = { video: "film", playlist: "playlist", channel: "channel" };

export async function videosScreen(v: View, data: Data, placement: "home" | "videos", videosWebUrl: string, autoAdd: boolean) {
   const { t } = v;
   const rows = await data.list("curated_videos", { limit: 200, sort: "sort", where: { placement } });
   const maxSort = rows.data.reduce((m, r) => Math.max(m, Number(r.sort ?? 0)), 0);
   const kindLabel = (k: string) => (k === "playlist" ? t.videos.kindPlaylist : k === "channel" ? t.videos.kindChannel : t.videos.kindVideo);
   const watch = (k: string, id: string) => `${videosWebUrl}/${k === "video" ? "watch" : k}/${encodeURIComponent(id)}`;
   return (
      <>
         <I18nScript nonce={v.nonce} strings={rowStrings(v, { added: t.videos.added, already: t.videos.already })} />
         <PageHead title={t.videos.title} intro={t.videos.intro}>
            <button class="btn primary" type="button" data-videos-add={placement} data-sort={String(maxSort + 10)} data-auto-open={autoAdd ? "1" : undefined}>
               <Icon name="plus" size={18} /> {t.videos.add}
            </button>
         </PageHead>
         <div class="toolbar">
            <Seg
               label={t.videos.title}
               items={(["home", "videos"] as const).map((p) => ({ href: `/videos?placement=${p}`, label: p === "home" ? t.videos.home : t.videos.videosPage, on: p === placement }))}
            />
         </div>
         {rows.data.length ? (
            <ol class="rows vrows" data-rows="curated_videos" aria-describedby="drag-hint">
               {rows.data.map((r: Row) => {
                  const snap = (parse(r.snapshot) ?? {}) as Snap;
                  const title = String(r.title_override || snap.title || r.ref_id);
                  const locale = String(r.locale ?? "all");
                  return (
                     <li class="row vrow card" data-id={String(r.id)} data-sort={String(r.sort ?? 0)} data-kind={String(r.kind)} draggable="true">
                        <span class="grip" aria-hidden="true">
                           <Icon name="grip" size={18} />
                        </span>
                        <a class="vthumb" href={watch(String(r.kind), String(r.ref_id))} target="_blank" rel="noopener" aria-label={`${t.videos.watch}: ${title}`}>
                           {snap.thumbnail_url ? <img src={snap.thumbnail_url} alt="" loading="lazy" /> : <Icon name={KIND_ICON[String(r.kind)] ?? "film"} size={28} />}
                           <span class="vkind">
                              <Icon name={KIND_ICON[String(r.kind)] ?? "film"} size={14} /> {kindLabel(String(r.kind))}
                           </span>
                        </a>
                        <div class="vbody stack" style="gap:10px">
                           <div>
                              <div class="li-title" dir="auto">
                                 {title}
                              </div>
                              <div class="li-meta">
                                 {snap.channel_name ? <span dir="auto">{snap.channel_name}</span> : null}
                                 <span dir="ltr">{String(r.ref_id)}</span>
                                 <span>
                                    {t.common.updated} {relative(r.updated_at, v.prefs.lang)}
                                 </span>
                              </div>
                           </div>
                           <div class="row2" style="gap:12px">
                              <div class="field">
                                 <label for={`vo-${r.id}`}>{t.videos.override}</label>
                                 <input id={`vo-${r.id}`} class="input" data-field="title_override" data-nullable value={String(r.title_override ?? "")} placeholder={snap.title ?? ""} maxlength={200} dir="auto" />
                              </div>
                              <div class="field">
                                 <label for={`vl-${r.id}`}>{t.videos.showFor}</label>
                                 <select id={`vl-${r.id}`} class="select" data-field="locale">
                                    {(["all", "en", "ar"] as const).map((l) => (
                                       <option value={l} selected={locale === l}>
                                          {t.locales[l]}
                                       </option>
                                    ))}
                                 </select>
                              </div>
                           </div>
                        </div>
                        <div class="vend">
                           <Visibility v={v} on={r.status === "published"} label={title} />
                           <button type="button" class="btn sm" data-change-video={String(r.id)}>
                              <Icon name="swap" size={16} /> {t.videos.change}
                           </button>
                           <RowTools v={v} label={title} />
                        </div>
                     </li>
                  );
               })}
            </ol>
         ) : (
            <Empty icon="play" title={t.videos.empty}>
               <button class="btn primary" type="button" data-videos-add={placement} data-sort="10">
                  <Icon name="plus" size={18} /> {t.videos.add}
               </button>
            </Empty>
         )}
         <p class="help" id="drag-hint">
            {t.common.dragHint}
         </p>
         <PickerDialog v={v} kinds={["video", "playlist", "channel"]} />
         <ConfirmDialog v={v} title={t.common.confirmDelete} body={t.common.confirmDeleteBody} />
      </>
   );
}

/* Site settings */

const SOCIAL_KINDS = ["youtube", "x", "instagram", "facebook", "telegram", "whatsapp", "tiktok", "other"] as const;

function SocialRow(props: { v: View; kind: string; url: string; i: number }) {
   const { t } = props.v;
   return (
      <li class="row social-row" data-social>
         <div class="row-fields">
            <div class="field">
               <label class="vh" for={`sk-${props.i}`}>
                  {t.site.kind}
               </label>
               <select id={`sk-${props.i}`} class="select" name="social_kind">
                  {SOCIAL_KINDS.map((k) => (
                     <option value={k} selected={props.kind === k}>
                        {t.site.kinds[k]}
                     </option>
                  ))}
               </select>
            </div>
            <div class="field">
               <label class="vh" for={`su-${props.i}`}>
                  {t.site.url}
               </label>
               <input id={`su-${props.i}`} class="input" name="social_url" type="url" dir="ltr" value={props.url} placeholder="https://" maxlength={2048} />
            </div>
         </div>
         <button type="button" class="btn ghost sm icon-only" data-social-remove aria-label={t.site.removeSocial} title={t.site.removeSocial}>
            <Icon name="x" size={18} />
         </button>
      </li>
   );
}

export async function siteScreen(v: View, data: Data, locale: "en" | "ar") {
   const { t } = v;
   const res = await data.list("site_settings", { limit: 1, where: { locale } });
   const row = res.data[0] as Row | undefined;
   const s = (k: string) => (row && row[k] != null ? String(row[k]) : "");
   const social = ((parse(row?.social) as { kind: string; url: string }[] | null) ?? []).filter((x) => x && typeof x.url === "string");
   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ ...rowStrings(v), siteSaved: t.site.saved, socialBad: t.site.socialHelp }} />
         <PageHead title={t.site.title} intro={t.site.intro} />
         <div class="toolbar">
            <Seg label={t.common.language} items={(["en", "ar"] as const).map((l) => ({ href: `/site?locale=${l}`, label: t.locales[l], on: l === locale }))} />
         </div>
         {!row ? (
            <p class="notice" style="margin-bottom:16px">
               <Icon name="info" /> {t.site.notSet}
            </p>
         ) : null}
         <form class="split" data-site={row ? String(row.id) : ""} data-locale={locale} novalidate>
            <div class="stack">
               <section class="card stack">
                  <div class="field">
                     <label for="s-title">{t.site.siteTitle}</label>
                     <input id="s-title" class="input" name="site_title" required maxlength={120} value={s("site_title")} lang={locale} dir="auto" />
                     <p class="err" id="s-title-err" hidden />
                  </div>
                  <div class="field">
                     <label for="s-tagline">{t.site.tagline}</label>
                     <input id="s-tagline" class="input" name="tagline" maxlength={200} value={s("tagline")} lang={locale} dir="auto" />
                  </div>
                  <div class="field">
                     <label for="s-hero-title">{t.site.heroTitle}</label>
                     <input id="s-hero-title" class="input" name="hero_title" maxlength={200} value={s("hero_title")} lang={locale} dir="auto" data-hero="title" />
                  </div>
                  <div class="field">
                     <label for="s-hero-body">{t.site.heroBody}</label>
                     <textarea id="s-hero-body" class="textarea" name="hero_body" maxlength={1000} lang={locale} dir="auto" data-hero="body">
                        {s("hero_body")}
                     </textarea>
                  </div>
               </section>
               <section class="card stack" aria-labelledby="soc-h">
                  <h2 id="soc-h">{t.site.social}</h2>
                  <p class="help">{t.site.socialHelp}</p>
                  <ul class="rows" data-social-list>
                     {social.map((x, i) => (
                        <SocialRow v={v} kind={x.kind} url={x.url} i={i} />
                     ))}
                  </ul>
                  <template data-social-template>
                     <SocialRow v={v} kind="youtube" url="" i={999} />
                  </template>
                  <button type="button" class="btn" data-social-add style="justify-self:start">
                     <Icon name="plus" size={18} /> {t.site.addSocial}
                  </button>
                  <p class="err" data-social-err hidden role="alert" />
               </section>
            </div>
            <aside class="stack sticky">
               <section class="hero site-hero" aria-label={t.site.heroPreview} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
                  <div class="hero-copy">
                     <p class="muted" style="margin:0 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">{t.site.heroPreview}</p>
                     <h2 data-hero-title style="font-size:26px;margin:0 0 8px">
                        {s("hero_title") || s("site_title")}
                     </h2>
                     <p data-hero-body>{s("hero_body")}</p>
                  </div>
               </section>
               <button class="btn primary" type="submit">
                  <Icon name="check" size={18} /> {t.common.save}
               </button>
            </aside>
         </form>
      </>
   );
}

/* Library */

export async function libraryScreen(v: View, data: Data) {
   const { t } = v;
   const res = await data.list<Row>("media", { limit: 200, sort: "-id" });
   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ ...rowStrings(v), deleteUsed: t.library.deleteUsed, coverTooBig: t.content.coverTooBig, coverBadType: t.content.coverBadType, uploading: t.content.coverUploading }} />
         <PageHead title={t.library.title} intro={t.library.intro}>
            <label class="btn primary" style="position:relative">
               <Icon name="upload" size={18} /> {t.library.upload}
               <input type="file" class="vh" multiple accept="image/jpeg,image/png,image/webp,image/avif" data-library-upload />
            </label>
         </PageHead>
         <p class="err" data-library-err hidden role="alert" />
         {res.data.length ? (
            <ul class="media-grid">
               {res.data.map((m: Row) => {
                  const meta = (parse(m.metadata) ?? {}) as Record<string, unknown>;
                  const ref = String(m.reference ?? "");
                  const [entity] = ref.split(".");
                  const path = String(m.path);
                  return (
                     <li class="card media-card" data-media={String(m.id)} data-path={path} data-used={ref ? "1" : ""}>
                        <img src={`/api/public/v1/media/${path.split("/").map(encodeURIComponent).join("/")}`} alt={typeof meta.alt === "string" ? meta.alt : ""} loading="lazy" />
                        <div class="stack" style="gap:8px">
                           <div class="li-meta" style="margin:0">
                              <span dir="ltr">{String(m.mime_type ?? "").replace("image/", "").toUpperCase()}</span>
                              <span dir="ltr">{bytes(m.size, v.prefs.lang)}</span>
                              {ref && (entity === "pages" || entity === "posts") ? (
                                 <a href={`/${entity}/${m.entity_id}`}>
                                    {t.library.usedBy} · {t.entities[entity].one} #{String(m.entity_id)}
                                 </a>
                              ) : (
                                 <span>{t.library.unused}</span>
                              )}
                           </div>
                           <div class="field">
                              <label for={`ma-${m.id}`}>{t.content.alt}</label>
                              <div style="display:flex;gap:8px">
                                 <input id={`ma-${m.id}`} class="input" maxlength={300} value={typeof meta.alt === "string" ? meta.alt : ""} dir="auto" data-media-alt />
                                 <button type="button" class="btn sm" data-media-alt-save aria-label={`${t.content.altSave}: ${path}`}>
                                    <Icon name="check" size={16} />
                                 </button>
                              </div>
                           </div>
                           {isAdmin(v) ? (
                              <button type="button" class="btn danger sm" data-media-delete style="justify-self:start">
                                 <Icon name="trash" size={16} /> {t.common.delete}
                              </button>
                           ) : null}
                        </div>
                     </li>
                  );
               })}
            </ul>
         ) : (
            <Empty icon="image" title={t.library.empty} />
         )}
         <ConfirmDialog v={v} title={t.common.confirmDelete} body={t.common.confirmDeleteBody} />
      </>
   );
}
