/** @jsxImportSource hono/jsx */
/**
 * The block editor (pages) and the slide editor (card posts). Server-rendered and complete without
 * JavaScript for reading; src/admin/client/blocks.ts adds add / reorder (drag and keyboard) /
 * duplicate / remove, the media and post choosers, and the preview.
 *
 * DOM contract (read back by the client's generic reader): every value lives in an element with
 * `data-k` (inputs; `data-type="int"` for numbers; radios by their checked value); a nested list is
 * `<ol data-k="…" data-seq-list>` whose `li[data-seq-item]` children are read the same way
 * (`data-scalar` lists hold one value per item). Ids inside an item are prefixed with its
 * `data-uid`, so a template (`__UID__`) or a duplicate gets fresh, unique ids.
 */
import type { Child } from "hono/jsx";
import { BLOCK_TYPES, emptyBlock, emptySlide, isComplete, MAX_CARDS_PAGE, MAX_POSTS_LIMIT, type Block, type BlockType, type ImageRef, type Slide } from "../../lib/blocks.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import type { View } from "../ui/layout.tsx";

export interface MediaInfo {
   url: string;
   alt: string;
   width: number | null;
   height: number | null;
}
export interface PostInfo {
   title: string;
   locale: string;
   status: string;
}
export interface VideoInfo {
   title: string;
   thumbnail_url: string | null;
   channel_name: string | null;
}
export interface Refs {
   media: Map<number, MediaInfo>;
   posts: Map<number, PostInfo>;
   videos: Map<string, VideoInfo>;
}
export const emptyRefs = (): Refs => ({ media: new Map(), posts: new Map(), videos: new Map() });

export const BLOCK_ICONS: Record<BlockType, IconName> = {
   markdown: "text",
   image: "image",
   gallery: "images",
   posts: "newspaper",
   cards: "layers",
   videos: "playlist",
   video: "play",
   cta: "megaphone",
   columns: "columns",
   quote: "quote",
   divider: "divider",
};

type Locale = "en" | "ar";
interface Ctx {
   v: View;
   locale: Locale;
   refs: Refs;
}

const T = "__UID__";

/* ── Small field pieces ───────────────────────────────────────────────────────────────────────── */

function Field(props: { uid: string; k: string; label: string; help?: string; children: Child }) {
   return (
      <div class="field">
         <label for={`${props.uid}-${props.k}`}>{props.label}</label>
         {props.children}
         {props.help ? (
            <p class="help" id={`${props.uid}-${props.k}-help`}>
               {props.help}
            </p>
         ) : null}
      </div>
   );
}

/** A prose input: spell checked in the page's language. */
function Prose(props: { c: Ctx; uid: string; k: string; value: string; max: number; help?: boolean; placeholder?: string }) {
   return (
      <input
         id={`${props.uid}-${props.k}`}
         class="input"
         data-k={props.k}
         value={props.value}
         maxlength={props.max}
         lang={props.c.locale}
         dir="auto"
         spellcheck={true}
         placeholder={props.placeholder}
         aria-describedby={props.help ? `${props.uid}-${props.k}-help` : undefined}
      />
   );
}

function ProseArea(props: { c: Ctx; uid: string; k: string; value: string; max: number; rows?: number; code?: boolean; help?: boolean; labelledby?: string }) {
   return (
      <textarea
         id={`${props.uid}-${props.k}`}
         class={`textarea${props.code ? " code" : ""}`}
         data-k={props.k}
         maxlength={props.max}
         rows={props.rows ?? 3}
         lang={props.c.locale}
         dir="auto"
         spellcheck={true}
         aria-labelledby={props.labelledby}
         aria-describedby={props.help ? `${props.uid}-${props.k}-help` : undefined}
      >
         {props.value}
      </textarea>
   );
}

function Choice<V extends string | number>(props: { uid: string; k: string; label: string; value: V; options: [V, string][]; type?: "int" }) {
   return (
      <div class="field">
         <span class="label" id={`${props.uid}-${props.k}-l`}>
            {props.label}
         </span>
         <div class="seg" role="radiogroup" aria-labelledby={`${props.uid}-${props.k}-l`}>
            {props.options.map(([val, label]) => (
               <label>
                  <input type="radio" name={`${props.uid}-${props.k}`} data-k={props.k} data-type={props.type} value={String(val)} checked={val === props.value} />
                  {label}
               </label>
            ))}
         </div>
      </div>
   );
}

function Tools(props: { v: View; uid: string; nested?: boolean; noDuplicate?: boolean }) {
   const { t } = props.v;
   const d = `${props.uid}-h`;
   return (
      <div class="row-tools blk-tools">
         <button type="button" class="btn ghost sm icon-only" data-seq="up" aria-label={t.blocks.moveUp} title={t.blocks.moveUp} aria-describedby={d}>
            <Icon name="up" size={18} />
         </button>
         <button type="button" class="btn ghost sm icon-only" data-seq="down" aria-label={t.blocks.moveDown} title={t.blocks.moveDown} aria-describedby={d}>
            <Icon name="down" size={18} />
         </button>
         {props.noDuplicate ? null : (
            <button type="button" class="btn ghost sm icon-only" data-seq="duplicate" aria-label={t.blocks.duplicate} title={t.blocks.duplicate} aria-describedby={d}>
               <Icon name="copy" size={18} />
            </button>
         )}
         <button type="button" class="btn ghost sm icon-only danger-ic" data-seq="remove" aria-label={t.blocks.remove} title={t.blocks.remove} aria-describedby={d}>
            <Icon name="trash" size={18} />
         </button>
      </div>
   );
}

function Grip(props: { v: View; uid: string }) {
   return (
      <span class="grip" data-seq-grip title={props.v.t.blocks.drag} aria-hidden="true">
         <Icon name="grip" size={18} />
      </span>
   );
}

/** The chosen image (or none) with Choose / Replace / Remove; the id lives in a hidden input. */
function ImageSlot(props: { c: Ctx; uid: string; media_id: number | null; big?: boolean; overlay?: Child; noClear?: boolean }) {
   const { t } = props.c.v;
   const m = props.media_id ? props.c.refs.media.get(props.media_id) : undefined;
   return (
      <div class={`img-slot${props.big ? " big" : ""}`} data-image-slot>
         <input type="hidden" data-k="media_id" data-type="int" value={props.media_id ? String(props.media_id) : ""} />
         <div class="img-view" data-image-view>
            {m ? (
               <img src={m.url} alt="" width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" decoding="async" data-image-img />
            ) : (
               <span class="img-empty" data-image-empty>
                  <Icon name="image" size={24} />
                  <span>{t.blocks.noImage}</span>
               </span>
            )}
            {props.overlay}
         </div>
         <div class="ph-actions">
            <button type="button" class="btn sm" data-choose-image aria-describedby={`${props.uid}-h`}>
               <Icon name="images" size={16} /> <span data-choose-label>{m ? t.blocks.replaceImage : t.blocks.chooseImage}</span>
            </button>
            {props.noClear ? null : (
               <button type="button" class="btn ghost sm" data-clear-image hidden={!m} aria-describedby={`${props.uid}-h`}>
                  <Icon name="x" size={16} /> {t.blocks.removeImage}
               </button>
            )}
         </div>
      </div>
   );
}

function AltField(props: { c: Ctx; uid: string; value: string; label?: string; help?: string }) {
   const { t } = props.c.v;
   return (
      <Field uid={props.uid} k="alt" label={props.label ?? t.blocks.alt} help={props.help ?? t.blocks.altHelp}>
         <Prose c={props.c} uid={props.uid} k="alt" value={props.value} max={300} help />
      </Field>
   );
}

/** The compact markdown toolbar of a text block (same actions as the article body). */
function MarkdownField(props: { c: Ctx; uid: string; value: string; label: string }) {
   const { t } = props.c.v;
   const tool = (name: string, icon: IconName, label: string) => (
      <button type="button" class="btn ghost sm icon-only" data-mdx={name} title={label} aria-label={label}>
         <Icon name={icon} size={18} />
      </button>
   );
   return (
      <div class="field" data-md-root>
         <span class="label" id={`${props.uid}-text-l`}>
            {props.label}
         </span>
         <div class="md-bar" role="toolbar" aria-label={t.content.toolbar} aria-controls={`${props.uid}-text`}>
            <span class="md-tools">
               {tool("h2", "heading", t.content.h2)}
               {tool("bold", "bold", t.content.bold)}
               {tool("italic", "italic", t.content.italic)}
               {tool("quote", "quote", t.content.quote)}
               {tool("list", "listBullet", t.content.bullets)}
               {tool("link", "link", t.content.link)}
               <button type="button" class="btn sm" data-mdx="video">
                  <Icon name="film" size={18} /> {t.content.insertVideo}
               </button>
            </span>
         </div>
         <ProseArea c={props.c} uid={props.uid} k="text" value={props.value} max={20_000} rows={8} code labelledby={`${props.uid}-text-l`} />
      </div>
   );
}

/* ── Nested items ─────────────────────────────────────────────────────────────────────────────── */

export function GalleryItem(props: { c: Ctx; uid: string; item: ImageRef }) {
   const { t } = props.c.v;
   return (
      <li class="sub" data-seq-item data-uid={props.uid}>
         <Grip v={props.c.v} uid={props.uid} />
         <span class="vh" id={`${props.uid}-h`}>
            {t.blocks.types.image}
         </span>
         <ImageSlot c={props.c} uid={props.uid} media_id={props.item.media_id} noClear />
         <div class="sub-fields">
            <AltField c={props.c} uid={props.uid} value={props.item.alt} />
            <Field uid={props.uid} k="caption" label={t.blocks.caption}>
               <Prose c={props.c} uid={props.uid} k="caption" value={props.item.caption} max={300} />
            </Field>
         </div>
         <Tools v={props.c.v} uid={props.uid} noDuplicate />
      </li>
   );
}

export function PostItem(props: { c: Ctx; uid: string; id: number | null }) {
   const { t } = props.c.v;
   const p = props.id ? props.c.refs.posts.get(props.id) : undefined;
   return (
      <li class="sub row-sm" data-seq-item data-uid={props.uid}>
         <Grip v={props.c.v} uid={props.uid} />
         <input type="hidden" data-k="v" data-type="int" value={props.id ? String(props.id) : ""} />
         <span class="sub-title" id={`${props.uid}-h`} dir="auto" lang={p?.locale} data-post-title>
            {p?.title ?? `#${props.id ?? ""}`}
         </span>
         <span class={`badge ${p?.status === "published" ? "published" : "draft"}`} data-post-status>
            {t.status[p?.status === "published" ? "published" : "draft"]}
         </span>
         <Tools v={props.c.v} uid={props.uid} noDuplicate />
      </li>
   );
}

export function VideoItem(props: { c: Ctx; uid: string; item: { kind: string; ref_id: string; title_override: string } }) {
   const { t } = props.c.v;
   const info = props.c.refs.videos.get(`${props.item.kind}:${props.item.ref_id}`);
   return (
      <li class="sub row-sm" data-seq-item data-uid={props.uid}>
         <Grip v={props.c.v} uid={props.uid} />
         <input type="hidden" data-k="kind" value={props.item.kind} />
         <input type="hidden" data-k="ref_id" value={props.item.ref_id} />
         {info?.thumbnail_url ? <img class="vthumb" src={info.thumbnail_url} alt="" loading="lazy" data-video-thumb /> : <span class="vthumb" data-video-thumb aria-hidden="true" />}
         <div class="sub-fields">
            <span class="sub-title" id={`${props.uid}-h`} dir="auto" data-video-title>
               {info?.title ?? props.item.ref_id} · <span class="muted">{t.picker.kinds[props.item.kind as "video"] ?? props.item.kind}</span>
            </span>
            <label class="vh" for={`${props.uid}-title_override`}>
               {t.blocks.titleOverride}
            </label>
            <Prose c={props.c} uid={props.uid} k="title_override" value={props.item.title_override} max={300} placeholder={t.blocks.titleOverride} />
         </div>
         <Tools v={props.c.v} uid={props.uid} noDuplicate />
      </li>
   );
}

/* ── Blocks ───────────────────────────────────────────────────────────────────────────────────── */

let counter = 0;
const nextUid = () => `u${(counter++).toString(36)}`;

function BlockBody(props: { c: Ctx; uid: string; b: Block }) {
   const { c, uid, b } = props;
   const { t } = c.v;
   const tb = t.blocks;
   switch (b.type) {
      case "markdown":
         return <MarkdownField c={c} uid={uid} value={b.text} label={tb.text} />;
      case "image":
         return (
            <div class="blk-2">
               <ImageSlot c={c} uid={uid} media_id={b.media_id} />
               <div class="stack-sm">
                  <AltField c={c} uid={uid} value={b.alt} />
                  <Field uid={uid} k="caption" label={tb.caption}>
                     <Prose c={c} uid={uid} k="caption" value={b.caption} max={300} />
                  </Field>
                  <Choice uid={uid} k="size" label={tb.size} value={b.size} options={[["content", tb.sizeContent], ["wide", tb.sizeWide]]} />
               </div>
            </div>
         );
      case "gallery":
         return (
            <div class="stack-sm">
               <Choice uid={uid} k="columns" type="int" label={tb.columns} value={b.columns} options={[[2, "2"], [3, "3"], [4, "4"]]} />
               <ol class="subs gal" data-k="items" data-seq-list="gallery" data-empty={tb.galleryEmpty} aria-label={tb.types.gallery}>
                  {b.items.map((x) => (
                     <GalleryItem c={c} uid={nextUid()} item={x} />
                  ))}
               </ol>
               <div>
                  <button type="button" class="btn sm" data-add-images>
                     <Icon name="images" size={16} /> {tb.addImages}
                  </button>
               </div>
            </div>
         );
      case "posts":
         return (
            <div class="stack-sm" data-modes>
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <Choice uid={uid} k="mode" label={tb.mode} value={b.mode} options={[["latest", tb.modeLatest], ["tag", tb.modeTag], ["picked", tb.modePicked]]} />
               <div class="row2">
                  <div data-when="mode=latest,tag">
                     <Field uid={uid} k="limit" label={tb.limit}>
                        <input id={`${uid}-limit`} class="input" type="number" inputmode="numeric" min={1} max={MAX_POSTS_LIMIT} data-k="limit" data-type="int" value={String(b.limit)} />
                     </Field>
                  </div>
                  <div data-when="mode=tag">
                     <Field uid={uid} k="tag" label={tb.tag} help={tb.tagHelp}>
                        <Prose c={c} uid={uid} k="tag" value={b.tag} max={40} help />
                     </Field>
                  </div>
               </div>
               <div class="stack-sm" data-when="mode=picked">
                  <ol class="subs" data-k="post_ids" data-scalar data-seq-list="posts" data-empty={tb.noPosts} aria-label={tb.modePicked}>
                     {b.post_ids.map((id) => (
                        <PostItem c={c} uid={nextUid()} id={id} />
                     ))}
                  </ol>
                  <div>
                     <button type="button" class="btn sm" data-pick-posts>
                        <Icon name="newspaper" size={16} /> {tb.pickPosts}
                     </button>
                  </div>
               </div>
            </div>
         );
      case "cards":
         return (
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <div class="row2">
                  <Field uid={uid} k="tag" label={tb.cardsTag} help={tb.tagHelp}>
                     <Prose c={c} uid={uid} k="tag" value={b.tag} max={40} help />
                  </Field>
                  <Field uid={uid} k="page_size" label={tb.pageSize}>
                     <input id={`${uid}-page_size`} class="input" type="number" inputmode="numeric" min={3} max={MAX_CARDS_PAGE} data-k="page_size" data-type="int" value={String(b.page_size)} />
                  </Field>
               </div>
               <label class="switch">
                  <input type="checkbox" data-k="filter" checked={b.filter} />
                  {tb.filter}
               </label>
            </div>
         );
      case "videos":
         return (
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <ol class="subs" data-k="items" data-seq-list="videos" data-empty={tb.shelfEmpty} aria-label={tb.types.videos}>
                  {b.items.map((x) => (
                     <VideoItem c={c} uid={nextUid()} item={x} />
                  ))}
               </ol>
               <div>
                  <button type="button" class="btn sm" data-add-videos>
                     <Icon name="film" size={16} /> {tb.addVideos}
                  </button>
               </div>
            </div>
         );
      case "video": {
         const info = b.ref_id ? c.refs.videos.get(`${b.kind}:${b.ref_id}`) : undefined;
         return (
            <div class="blk-2">
               <div class="video-slot" data-video-slot>
                  <input type="hidden" data-k="kind" value={b.kind} />
                  <input type="hidden" data-k="ref_id" value={b.ref_id} />
                  <div class="img-view">
                     {info?.thumbnail_url ? (
                        <img src={info.thumbnail_url} alt="" loading="lazy" data-video-thumb />
                     ) : (
                        <span class="img-empty" data-video-thumb>
                           <Icon name="play" size={24} />
                        </span>
                     )}
                  </div>
                  <p class="sub-title" dir="auto" data-video-title>
                     {info?.title ?? (b.ref_id ? b.ref_id : tb.noVideo)}
                  </p>
                  <div>
                     <button type="button" class="btn sm" data-choose-video aria-describedby={`${uid}-h`}>
                        <Icon name="film" size={16} /> <span data-choose-label>{b.ref_id ? tb.replaceVideo : tb.chooseVideo}</span>
                     </button>
                  </div>
               </div>
               <Field uid={uid} k="caption" label={tb.caption}>
                  <Prose c={c} uid={uid} k="caption" value={b.caption} max={300} />
               </Field>
            </div>
         );
      }
      case "cta":
         return (
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <Field uid={uid} k="text" label={tb.ctaText}>
                  <ProseArea c={c} uid={uid} k="text" value={b.text} max={600} rows={2} />
               </Field>
               <div class="row2">
                  <Field uid={uid} k="label" label={tb.label}>
                     <Prose c={c} uid={uid} k="label" value={b.label} max={80} />
                  </Field>
                  <Field uid={uid} k="url" label={tb.url} help={tb.urlHelp}>
                     <input
                        id={`${uid}-url`}
                        class="input"
                        data-k="url"
                        data-validate="url"
                        value={b.url}
                        maxlength={2048}
                        dir="ltr"
                        inputmode="url"
                        spellcheck={false}
                        autocapitalize="off"
                        autocorrect="off"
                        aria-describedby={`${uid}-url-help`}
                     />
                  </Field>
               </div>
               <Choice uid={uid} k="tone" label={tb.tone} value={b.tone} options={[["primary", tb.tonePrimary], ["quiet", tb.toneQuiet]]} />
            </div>
         );
      case "columns":
         return (
            <div class="stack-sm">
               <div class="blk-2">
                  <MarkdownField c={c} uid={uid} value={b.text} label={tb.text} />
                  <div class="stack-sm">
                     <ImageSlot c={c} uid={uid} media_id={b.media_id} />
                     <AltField c={c} uid={uid} value={b.alt} />
                     <Field uid={uid} k="caption" label={tb.caption}>
                        <Prose c={c} uid={uid} k="caption" value={b.caption} max={300} />
                     </Field>
                  </div>
               </div>
               <Choice uid={uid} k="image_side" label={tb.side} value={b.image_side} options={[["start", tb.sideStart], ["end", tb.sideEnd]]} />
            </div>
         );
      case "quote":
         return (
            <div class="stack-sm">
               <Choice uid={uid} k="variant" label={tb.variant} value={b.variant} options={[["quote", tb.variantQuote], ["callout", tb.variantCallout]]} />
               <Field uid={uid} k="text" label={tb.text}>
                  <ProseArea c={c} uid={uid} k="text" value={b.text} max={2000} rows={3} />
               </Field>
               <Field uid={uid} k="cite" label={tb.cite}>
                  <Prose c={c} uid={uid} k="cite" value={b.cite} max={300} />
               </Field>
            </div>
         );
      case "divider":
         return (
            <div class="row2">
               <Choice uid={uid} k="style" label={tb.style} value={b.style} options={[["line", tb.styleLine], ["space", tb.styleSpace]]} />
               <Choice uid={uid} k="size" label={tb.spaceSize} value={b.size} options={[["s", tb.sizeS], ["m", tb.sizeM], ["l", tb.sizeL]]} />
            </div>
         );
   }
}

export function BlockItem(props: { c: Ctx; b: Block; uid?: string; template?: boolean }) {
   const { c, b } = props;
   const uid = props.uid ?? nextUid();
   const { t } = c.v;
   const label = t.blocks.types[b.type];
   return (
      <li class="blk" data-seq-item data-uid={uid} data-block-type={b.type} data-incomplete={!props.template && !isComplete(b) ? "" : undefined} aria-labelledby={`${uid}-h`}>
         <input type="hidden" data-k="id" value={props.template ? "__BID__" : b.id} />
         <input type="hidden" data-k="type" value={b.type} />
         <div class="blk-h">
            <Grip v={c.v} uid={uid} />
            <span class="blk-ic" aria-hidden="true">
               <Icon name={BLOCK_ICONS[b.type]} size={18} />
            </span>
            <h3 class="blk-t" id={`${uid}-h`}>
               {label}
               <span class="vh" data-seq-pos />
            </h3>
            <span class="blk-warn" data-incomplete-note>
               <Icon name="eyeOff" size={14} /> {t.blocks.incomplete}
            </span>
            <Tools v={c.v} uid={uid} />
         </div>
         <p class="err" data-block-err role="alert" hidden />
         <div class="blk-b">
            <BlockBody c={c} uid={uid} b={b} />
         </div>
      </li>
   );
}

/** Live overlay preview on a slide's image: the same scrim and positions as www. */
function SlideOverlay(props: { s: Slide; locale: Locale }) {
   return (
      <div class={`ov ov-${props.s.position}`} data-overlay lang={props.locale} dir={props.locale === "ar" ? "rtl" : "ltr"} aria-hidden="true">
         <div class="ov-text">
            <strong data-ov-heading>{props.s.heading}</strong>
            <span data-ov-body>{props.s.body}</span>
         </div>
      </div>
   );
}

export function SlideItem(props: { c: Ctx; s: Slide; uid?: string; template?: boolean }) {
   const { c, s } = props;
   const uid = props.uid ?? nextUid();
   const ts = c.v.t.slides;
   return (
      <li class="blk slide" data-seq-item data-uid={uid} data-incomplete={!props.template && s.media_id === null ? "" : undefined} aria-labelledby={`${uid}-h`}>
         <input type="hidden" data-k="id" value={props.template ? "__BID__" : s.id} />
         <div class="blk-h">
            <Grip v={c.v} uid={uid} />
            <span class="blk-ic" aria-hidden="true">
               <Icon name="image" size={18} />
            </span>
            <h3 class="blk-t" id={`${uid}-h`}>
               {ts.one} <span data-seq-pos />
            </h3>
            <span class="blk-warn" data-incomplete-note>
               <Icon name="eyeOff" size={14} /> {ts.needsImage}
            </span>
            <Tools v={c.v} uid={uid} />
         </div>
         <div class="blk-b blk-2">
            <div class="stack-sm">
               <span class="label">{ts.overlay}</span>
               <ImageSlot c={c} uid={uid} media_id={s.media_id} big overlay={<SlideOverlay s={s} locale={c.locale} />} />
               <p class="help">{ts.overlayHelp}</p>
            </div>
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={ts.heading}>
                  <Prose c={c} uid={uid} k="heading" value={s.heading} max={140} />
               </Field>
               <Field uid={uid} k="body" label={ts.body} help={ts.bodyHelp}>
                  <ProseArea c={c} uid={uid} k="body" value={s.body} max={400} rows={3} help />
               </Field>
               <Choice uid={uid} k="position" label={ts.position} value={s.position} options={[["top", ts.top], ["middle", ts.middle], ["bottom", ts.bottom]]} />
               <AltField c={c} uid={uid} value={s.alt} label={ts.alt} help={ts.altHelp} />
            </div>
         </div>
      </li>
   );
}

/* ── Editors ──────────────────────────────────────────────────────────────────────────────────── */

function Templates(props: { c: Ctx; kinds: ("blocks" | "slides")[] }) {
   const { c } = props;
   return (
      <>
         {props.kinds.includes("blocks")
            ? BLOCK_TYPES.map((type) => (
                 <template data-seq-template={`block:${type}`}>
                    <BlockItem c={c} b={emptyBlock(type, "tpl")} uid={T} template />
                 </template>
              ))
            : null}
         {props.kinds.includes("slides") ? (
            <template data-seq-template="slide">
               <SlideItem c={c} s={emptySlide("tpl")} uid={T} template />
            </template>
         ) : null}
         <template data-seq-template="gallery">
            <GalleryItem c={c} uid={T} item={{ media_id: null, alt: "", caption: "" }} />
         </template>
         <template data-seq-template="posts">
            <PostItem c={c} uid={T} id={null} />
         </template>
         <template data-seq-template="videos">
            <VideoItem c={c} uid={T} item={{ kind: "video", ref_id: "", title_override: "" }} />
         </template>
      </>
   );
}

export function BlocksEditor(props: { v: View; locale: Locale; blocks: Block[]; refs: Refs }) {
   const c: Ctx = { v: props.v, locale: props.locale, refs: props.refs };
   const tb = props.v.t.blocks;
   return (
      <section class="card stack" aria-labelledby="blocks-h" data-blocks-editor data-locale={props.locale}>
         <div class="blk-head">
            <div>
               <h2 id="blocks-h" style="margin:0">
                  {tb.title}
               </h2>
               <p class="help" style="margin:4px 0 0">
                  {tb.intro}
               </p>
            </div>
            <div class="seg" role="group" aria-label={tb.preview}>
               <button type="button" aria-pressed="true" data-blocks-view="edit">
                  <Icon name="pen" size={16} /> {tb.edit}
               </button>
               <button type="button" aria-pressed="false" data-blocks-view="preview">
                  <Icon name="eye" size={16} /> {tb.preview}
               </button>
            </div>
         </div>
         <div data-blocks-edit>
            <ol class="blk-list" data-k="blocks" data-seq-list="blocks" data-empty={tb.empty} aria-label={tb.title}>
               {props.blocks.map((b) => (
                  <BlockItem c={c} b={b} />
               ))}
            </ol>
            <div class="blk-add" role="group" aria-labelledby="blk-add-h">
               <h3 id="blk-add-h">{tb.add}</h3>
               <div class="blk-add-grid">
                  {BLOCK_TYPES.map((type) => (
                     <button type="button" class="blk-add-btn" data-add-block={type}>
                        <span class="blk-ic" aria-hidden="true">
                           <Icon name={BLOCK_ICONS[type]} size={20} />
                        </span>
                        <span class="blk-add-t">
                           {tb.types[type]}
                        </span>
                        <span class="blk-add-d">
                           {tb.typeHelp[type]}
                        </span>
                     </button>
                  ))}
               </div>
            </div>
         </div>
         <div data-blocks-preview hidden>
            <p class="help">{tb.previewHelp}</p>
            <div class="bp" data-blocks-preview-body lang={props.locale} dir={props.locale === "ar" ? "rtl" : "ltr"} tabindex={0} aria-label={tb.preview} />
         </div>
         <p class="vh" role="status" aria-live="polite" data-seq-live />
         <Templates c={c} kinds={["blocks"]} />
      </section>
   );
}

export function SlidesEditor(props: { v: View; locale: Locale; slides: Slide[]; refs: Refs; hidden?: boolean }) {
   const c: Ctx = { v: props.v, locale: props.locale, refs: props.refs };
   const ts = props.v.t.slides;
   return (
      <section class="card stack" aria-labelledby="slides-h" data-slides-editor data-kind-panel="cards" hidden={props.hidden} data-locale={props.locale}>
         <div class="blk-head">
            <div>
               <h2 id="slides-h" style="margin:0">
                  {ts.title} <span class="badge loc" data-slide-count>{ts.count(props.slides.length)}</span>
               </h2>
               <p class="help" style="margin:4px 0 0">
                  {ts.intro}
               </p>
            </div>
         </div>
         <ol class="blk-list" data-k="slides" data-seq-list="slides" data-empty={ts.empty} aria-label={ts.title}>
            {props.slides.map((s) => (
               <SlideItem c={c} s={s} />
            ))}
         </ol>
         <div class="ph-actions">
            <button type="button" class="btn" data-add-slide>
               <Icon name="image" size={18} /> {ts.add}
            </button>
            <button type="button" class="btn" data-add-slides-from-images>
               <Icon name="images" size={18} /> {ts.addFromImages}
            </button>
         </div>
         <p class="vh" role="status" aria-live="polite" data-seq-live />
         <Templates c={c} kinds={["slides"]} />
      </section>
   );
}

/** The media chooser: library grid (single or multiple) and uploads (never overwrite: PR #27). */
export function MediaDialog(props: { v: View }) {
   const tb = props.v.t.blocks;
   return (
      <dialog class="dlg media-dlg" id="media-dlg" aria-labelledby="media-dlg-h">
         <div class="dlg-h">
            <h2 id="media-dlg-h">{tb.mediaTitle}</h2>
            <button class="ic" type="button" data-media-close aria-label={tb.close} style="color:inherit">
               <Icon name="x" />
            </button>
         </div>
         <div class="dlg-b stack">
            <label class="drop" data-media-drop>
               <Icon name="upload" size={22} />
               <span data-media-drop-label>{tb.mediaDrop}</span>
               <span class="help">{tb.mediaDropHelp}</span>
               <input type="file" class="vh" multiple accept="image/jpeg,image/png,image/webp,image/avif" data-media-upload />
            </label>
            <p class="muted" role="status" aria-live="polite" data-media-status style="margin:0" />
            <ul class="media-pick" data-media-grid aria-label={tb.mediaLibrary} />
            <div>
               <button type="button" class="btn sm ghost" data-media-more hidden>
                  {tb.mediaMore}
               </button>
            </div>
         </div>
         <div class="dlg-f">
            <button type="button" class="btn" data-media-close>
               {props.v.t.common.cancel}
            </button>
            <button type="button" class="btn primary" data-media-use disabled>
               <Icon name="check" size={18} /> <span data-media-use-label>{tb.mediaUse}</span>
            </button>
         </div>
      </dialog>
   );
}

export function PostsDialog(props: { v: View; locale: Locale }) {
   const tb = props.v.t.blocks;
   return (
      <dialog class="dlg picker" id="posts-dlg" aria-labelledby="posts-dlg-h" data-locale={props.locale}>
         <div class="dlg-h">
            <h2 id="posts-dlg-h">{tb.postsTitle}</h2>
            <button class="ic" type="button" data-posts-close aria-label={tb.close} style="color:inherit">
               <Icon name="x" />
            </button>
         </div>
         <div class="dlg-b stack">
            <form class="picker-form" data-posts-form role="search" novalidate>
               <div class="search" style="background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)">
                  <label class="vh" for="posts-q">
                     {tb.postsSearch}
                  </label>
                  <input id="posts-q" name="q" type="search" maxlength={100} placeholder={tb.postsSearch} autocomplete="off" lang={props.locale} dir="auto" spellcheck={true} style="color:var(--fanous-c-form-input-text)" />
                  <button type="submit" aria-label={props.v.t.common.search}>
                     <Icon name="search" />
                  </button>
               </div>
            </form>
            <p class="muted" data-posts-status role="status" aria-live="polite" style="margin:0" />
            <ul class="picker-results" data-posts-results />
         </div>
      </dialog>
   );
}

/* ── Server reads for the editor ──────────────────────────────────────────────────────────────── */

export function mediaInfoOf(row: { id: number; path: string; metadata?: unknown }): MediaInfo {
   let meta: Record<string, unknown> = {};
   if (row.metadata && typeof row.metadata === "object") meta = row.metadata as Record<string, unknown>;
   else if (typeof row.metadata === "string") {
      try {
         meta = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
         /* none */
      }
   }
   const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
   return {
      url: `/api/public/v1/media/${row.path.split("/").map(encodeURIComponent).join("/")}`,
      alt: typeof meta.alt === "string" ? meta.alt : "",
      width: n(meta.width),
      height: n(meta.height),
   };
}
