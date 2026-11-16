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
import { raw } from "hono/html";
import { iconSvg } from "../../lib/page-blocks.generated.ts";
import {
   emptySlide,
   FEATURE_ICONS,
   blockSummary,
   isComplete,
   MAX_CARD_ITEMS,
   MAX_CARDS_PAGE,
   MAX_FAQ,
   MAX_HERO_BUTTONS,
   MAX_POSTS_LIMIT,
   MAX_STATS,
   PAGE_BLOCK_PRESETS,
   presetBlock,
   STYLE_OPTIONS,
   type Block,
   type BlockStyle,
   type BlockType,
   type ImageRef,
   type PresetKey,
   type Slide,
} from "../../lib/blocks.ts";
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
   cards: "images",
   videos: "playlist",
   video: "play",
   cta: "megaphone",
   columns: "columns",
   quote: "quote",
   divider: "divider",
   hero: "sparkle",
   layout: "columns",
   cardgrid: "layers",
   faq: "info",
   stats: "star",
   contact: "users",
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

/** A plain link field: "/…" on the site or https (checked on the client and by the schema). */
function UrlInput(props: { uid: string; k: string; value: string; help?: boolean }) {
   return (
      <input
         id={`${props.uid}-${props.k}`}
         class="input"
         data-k={props.k}
         data-validate="url"
         value={props.value}
         maxlength={2048}
         dir="ltr"
         inputmode="url"
         spellcheck={false}
         autocapitalize="off"
         autocorrect="off"
         placeholder="/videos/"
         aria-describedby={props.help ? `${props.uid}-${props.k}-help` : undefined}
      />
   );
}

/** A nested item's header: grip, name and position, its tools. */
function SubHead(props: { v: View; uid: string; label: string }) {
   return (
      <div class="sub-hd">
         <Grip v={props.v} uid={props.uid} />
         <span class="sub-title" id={`${props.uid}-h`}>
            {props.label} <span data-seq-pos class="muted" />
         </span>
         <Tools v={props.v} uid={props.uid} />
      </div>
   );
}

export function HeroButtonItem(props: { c: Ctx; uid: string; item: { label: string; url: string; variant: string } }) {
   const { c, uid, item } = props;
   const tb = c.v.t.blocks;
   return (
      <li class="sub sub-card" data-seq-item data-uid={uid}>
         <SubHead v={c.v} uid={uid} label={tb.button} />
         <div class="row3">
            <Field uid={uid} k="label" label={tb.label}>
               <Prose c={c} uid={uid} k="label" value={item.label} max={80} />
            </Field>
            <Field uid={uid} k="url" label={tb.url}>
               <UrlInput uid={uid} k="url" value={item.url} />
            </Field>
            <Choice uid={uid} k="variant" label={tb.buttonStyle} value={item.variant} options={[["primary", tb.buttonPrimary], ["secondary", tb.buttonSecondary]]} />
         </div>
      </li>
   );
}

export function LayoutColItem(props: { c: Ctx; uid: string; item: { media_id: number | null; alt: string; heading: string; text: string; label: string; url: string } }) {
   const { c, uid, item } = props;
   const tb = c.v.t.blocks;
   return (
      <li class="sub sub-card" data-seq-item data-uid={uid}>
         <SubHead v={c.v} uid={uid} label={tb.column} />
         <div class="blk-2">
            <div class="stack-sm">
               <ImageSlot c={c} uid={uid} media_id={item.media_id} />
               <AltField c={c} uid={uid} value={item.alt} />
            </div>
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.columnHeading}>
                  <Prose c={c} uid={uid} k="heading" value={item.heading} max={300} />
               </Field>
               <Field uid={uid} k="text" label={tb.text}>
                  <ProseArea c={c} uid={uid} k="text" value={item.text} max={6000} rows={4} />
               </Field>
               <div class="row2">
                  <Field uid={uid} k="label" label={tb.linkLabel}>
                     <Prose c={c} uid={uid} k="label" value={item.label} max={80} />
                  </Field>
                  <Field uid={uid} k="url" label={tb.link}>
                     <UrlInput uid={uid} k="url" value={item.url} />
                  </Field>
               </div>
            </div>
         </div>
      </li>
   );
}

export function CardItemRow(props: { c: Ctx; uid: string; item: { media_id: number | null; alt: string; title: string; text: string; label: string; url: string } }) {
   const { c, uid, item } = props;
   const tb = c.v.t.blocks;
   return (
      <li class="sub sub-card" data-seq-item data-uid={uid}>
         <SubHead v={c.v} uid={uid} label={tb.card} />
         <div class="blk-2">
            <div class="stack-sm">
               <ImageSlot c={c} uid={uid} media_id={item.media_id} />
               <AltField c={c} uid={uid} value={item.alt} />
            </div>
            <div class="stack-sm">
               <Field uid={uid} k="title" label={tb.cardTitle}>
                  <Prose c={c} uid={uid} k="title" value={item.title} max={300} />
               </Field>
               <Field uid={uid} k="text" label={tb.cardText}>
                  <ProseArea c={c} uid={uid} k="text" value={item.text} max={600} rows={2} />
               </Field>
               <div class="row2">
                  <Field uid={uid} k="label" label={tb.linkLabel}>
                     <Prose c={c} uid={uid} k="label" value={item.label} max={80} />
                  </Field>
                  <Field uid={uid} k="url" label={tb.link}>
                     <UrlInput uid={uid} k="url" value={item.url} />
                  </Field>
               </div>
            </div>
         </div>
      </li>
   );
}

export function FaqItemRow(props: { c: Ctx; uid: string; item: { q: string; a: string } }) {
   const { c, uid, item } = props;
   const tb = c.v.t.blocks;
   return (
      <li class="sub sub-card" data-seq-item data-uid={uid}>
         <SubHead v={c.v} uid={uid} label={tb.faqItem} />
         <Field uid={uid} k="q" label={tb.question}>
            <Prose c={c} uid={uid} k="q" value={item.q} max={300} />
         </Field>
         <Field uid={uid} k="a" label={tb.answer}>
            <ProseArea c={c} uid={uid} k="a" value={item.a} max={3000} rows={3} />
         </Field>
      </li>
   );
}

export function StatItemRow(props: { c: Ctx; uid: string; item: { value: string; label: string; text: string; icon: string } }) {
   const { c, uid, item } = props;
   const tb = c.v.t.blocks;
   return (
      <li class="sub sub-card" data-seq-item data-uid={uid}>
         <SubHead v={c.v} uid={uid} label={tb.statItem} />
         <div class="row2">
            <div data-when-parent="variant=stats">
               <Field uid={uid} k="value" label={tb.statValue}>
                  <Prose c={c} uid={uid} k="value" value={item.value} max={24} />
               </Field>
            </div>
            <Field uid={uid} k="label" label={tb.statLabel}>
               <Prose c={c} uid={uid} k="label" value={item.label} max={300} />
            </Field>
         </div>
         <Field uid={uid} k="text" label={tb.statText}>
            <ProseArea c={c} uid={uid} k="text" value={item.text} max={600} rows={2} />
         </Field>
         <div class="field" data-when-parent="variant=features">
            <span class="label" id={`${uid}-icon-l`}>
               {tb.icon}
            </span>
            <div class="icon-pick" role="radiogroup" aria-labelledby={`${uid}-icon-l`}>
               <label class="icon-opt" title={tb.noIcon}>
                  <input type="radio" name={`${uid}-icon`} data-k="icon" value="" checked={item.icon === ""} />
                  <span>{tb.noIcon}</span>
               </label>
               {FEATURE_ICONS.map((name) => (
                  <label class="icon-opt" title={tb.iconNames[name] ?? name}>
                     <input type="radio" name={`${uid}-icon`} data-k="icon" value={name} checked={item.icon === name} aria-label={tb.iconNames[name] ?? name} />
                     {raw(iconSvg(name, "fi"))}
                  </label>
               ))}
            </div>
         </div>
      </li>
   );
}

/** A nested list with its add button (the generic sequence code handles reorder/duplicate/remove). */
function SubList(props: { k: string; list: string; label: string; empty: string; add: string; addIcon: IconName; max: number; children: Child; cls?: string }) {
   return (
      <div class="stack-sm">
         <ol class={`subs ${props.cls ?? ""}`} data-k={props.k} data-seq-list={props.list} data-empty={props.empty} data-max={String(props.max)} aria-label={props.label}>
            {props.children}
         </ol>
         <div>
            <button type="button" class="btn sm" data-add-sub={props.list}>
               <Icon name={props.addIcon} size={16} /> {props.add}
            </button>
         </div>
      </div>
   );
}

/* ── Style (theme-safe options only) ──────────────────────────────────────────────────────────── */

const TONE_ORDER = ["none", "soft", "raised", "accent", "night"] as const;

function StylePanel(props: { c: Ctx; uid: string; b: Block }) {
   const { c, uid, b } = props;
   const tb = c.v.t.blocks;
   const opts = STYLE_OPTIONS[b.type];
   if (!opts.length) return null;
   const st: BlockStyle = b.appearance;
   const toneLabel: Record<string, string> = { none: tb.toneNone, soft: tb.toneSoft, raised: tb.toneRaised, accent: tb.toneAccent, night: tb.toneNight };
   return (
      <details class="blk-style" data-style-panel>
         <summary>
            <Icon name="palette" size={16} /> {tb.styleTitle}
            <span class="blk-style-sum muted" data-style-sum />
         </summary>
         <div class="blk-style-b">
            {opts.includes("width") ? <Choice uid={uid} k="appearance.width" label={tb.styleWidth} value={st.width} options={[["content", tb.widthContent], ["wide", tb.widthWide], ["full", tb.widthFull]]} /> : null}
            {opts.includes("align") ? <Choice uid={uid} k="appearance.align" label={tb.styleAlign} value={st.align} options={[["start", tb.alignStart], ["center", tb.alignCenter]]} /> : null}
            {opts.includes("tone") ? (
               <div class="field">
                  <span class="label" id={`${uid}-tone-l`}>
                     {tb.styleTone}
                  </span>
                  <div class="tones" role="radiogroup" aria-labelledby={`${uid}-tone-l`} aria-describedby={`${uid}-tone-help`}>
                     {TONE_ORDER.map((tone) => (
                        <label class="tone-opt">
                           <input type="radio" name={`${uid}-appearance.tone`} data-k="appearance.tone" value={tone} checked={st.tone === tone} />
                           <span class={`tone-sw tone-${tone}`} aria-hidden="true" />
                           <span class="tone-l">{toneLabel[tone]}</span>
                        </label>
                     ))}
                  </div>
                  <p class="help" id={`${uid}-tone-help`}>
                     {tb.toneHelp}
                  </p>
               </div>
            ) : null}
            {opts.includes("space") ? <Choice uid={uid} k="appearance.space" label={tb.styleSpacing} value={st.space} options={[["s", tb.sizeS], ["m", tb.sizeM], ["l", tb.sizeL]]} /> : null}
         </div>
      </details>
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
      case "hero":
         return (
            <div class="stack-sm" data-modes>
               <Field uid={uid} k="eyebrow" label={tb.eyebrow}>
                  <Prose c={c} uid={uid} k="eyebrow" value={b.eyebrow} max={80} />
               </Field>
               <Field uid={uid} k="title" label={tb.heroTitle} help={tb.heroTitleHelp}>
                  <Prose c={c} uid={uid} k="title" value={b.title} max={300} help />
               </Field>
               <Field uid={uid} k="subtitle" label={tb.subtitle}>
                  <ProseArea c={c} uid={uid} k="subtitle" value={b.subtitle} max={600} rows={2} />
               </Field>
               <div class="row2">
                  <Choice uid={uid} k="background" label={tb.background} value={b.background} options={[["gradient", tb.bgGradient], ["image", tb.bgImage], ["plain", tb.bgPlain]]} />
                  <Choice uid={uid} k="height" label={tb.height} value={b.height} options={[["s", tb.sizeS], ["m", tb.sizeM], ["l", tb.sizeL]]} />
               </div>
               <div class="blk-2" data-when="background=image">
                  <ImageSlot c={c} uid={uid} media_id={b.media_id} />
                  <AltField c={c} uid={uid} value={b.alt} />
               </div>
               <span class="label">{tb.buttons}</span>
               <SubList k="buttons" list="hero-buttons" label={tb.buttons} empty={tb.buttonsEmpty} add={tb.addButton} addIcon="plus" max={MAX_HERO_BUTTONS}>
                  {b.buttons.map((x) => (
                     <HeroButtonItem c={c} uid={nextUid()} item={x} />
                  ))}
               </SubList>
            </div>
         );
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
      case "layout":
         return (
            <div class="stack-sm">
               <Choice uid={uid} k="columns" type="int" label={tb.columnsCount} value={b.columns} options={[[2, "2"], [3, "3"]]} />
               <SubList k="items" list="layout-cols" label={tb.columnsCount} empty={tb.itemsEmpty} add={tb.addItem} addIcon="columns" max={3}>
                  {b.items.map((x) => (
                     <LayoutColItem c={c} uid={nextUid()} item={x} />
                  ))}
               </SubList>
            </div>
         );
      case "cardgrid":
         return (
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <Field uid={uid} k="intro" label={tb.intro2}>
                  <ProseArea c={c} uid={uid} k="intro" value={b.intro} max={600} rows={2} />
               </Field>
               <Choice uid={uid} k="columns" type="int" label={tb.cardsPerRow} value={b.columns} options={[[2, "2"], [3, "3"], [4, "4"]]} />
               <SubList k="items" list="cards" label={tb.types.cardgrid} empty={tb.cardsEmpty} add={tb.addCard} addIcon="plus" max={MAX_CARD_ITEMS} cls="subs-cards">
                  {b.items.map((x) => (
                     <CardItemRow c={c} uid={nextUid()} item={x} />
                  ))}
               </SubList>
            </div>
         );
      case "faq":
         return (
            <div class="stack-sm">
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <SubList k="items" list="faq" label={tb.types.faq} empty={tb.faqEmpty} add={tb.addQuestion} addIcon="plus" max={MAX_FAQ}>
                  {b.items.map((x) => (
                     <FaqItemRow c={c} uid={nextUid()} item={x} />
                  ))}
               </SubList>
            </div>
         );
      case "stats":
         return (
            <div class="stack-sm" data-modes>
               <Field uid={uid} k="heading" label={tb.heading}>
                  <Prose c={c} uid={uid} k="heading" value={b.heading} max={300} />
               </Field>
               <Choice uid={uid} k="variant" label={tb.statsStyle} value={b.variant} options={[["stats", tb.statsNumbers], ["features", tb.statsFeatures]]} />
               <SubList k="items" list="stats" label={tb.types.stats} empty={tb.itemsEmpty} add={tb.addItem} addIcon="plus" max={MAX_STATS} cls="subs-stats">
                  {b.items.map((x) => (
                     <StatItemRow c={c} uid={nextUid()} item={x} />
                  ))}
               </SubList>
            </div>
         );
      case "contact":
         return (
            <div class="stack-sm" data-modes>
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
                  <Choice uid={uid} k="kind" label={tb.contactKind} value={b.kind} options={[["page", tb.contactPage], ["email", tb.contactEmail]]} />
               </div>
               <div data-when="kind=email">
                  <Field uid={uid} k="email" label={tb.email}>
                     <input id={`${uid}-email`} class="input" type="email" data-k="email" data-validate="email" value={b.email} maxlength={254} dir="ltr" spellcheck={false} autocapitalize="off" autocorrect="off" />
                  </Field>
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
                     <UrlInput uid={uid} k="url" value={b.url} help />
                  </Field>
               </div>
               <Choice uid={uid} k="tone" label={tb.buttonStyle} value={b.tone} options={[["primary", tb.buttonPrimary], ["quiet", tb.buttonSecondary]]} />
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
               <Choice uid={uid} k="style_kind" label={tb.style} value={b.style_kind} options={[["line", tb.styleLine], ["space", tb.styleSpace]]} />
               <Choice uid={uid} k="size" label={tb.spaceSize} value={b.size} options={[["s", tb.sizeS], ["m", tb.sizeM], ["l", tb.sizeL]]} />
            </div>
         );
   }
}

export function BlockItem(props: { c: Ctx; b: Block; uid?: string; template?: boolean; folded?: boolean }) {
   const { c, b } = props;
   const uid = props.uid ?? nextUid();
   const { t } = c.v;
   const label = t.blocks.types[b.type];
   return (
      <li class={`blk${props.folded ? " folded" : ""}`} data-seq-item data-uid={uid} data-block-type={b.type} data-incomplete={!props.template && !isComplete(b) ? "" : undefined} aria-labelledby={`${uid}-h`}>
         <input type="hidden" data-k="id" value={props.template ? "__BID__" : b.id} />
         <input type="hidden" data-k="type" value={b.type} />
         <div class="blk-h">
            <Grip v={c.v} uid={uid} />
            <span class="blk-ic" aria-hidden="true">
               <Icon name={BLOCK_ICONS[b.type]} size={18} />
            </span>
            <div class="blk-tt">
               <h3 class="blk-t" id={`${uid}-h`}>
                  {label}
                  <span class="vh" data-seq-pos />
               </h3>
               <span class="blk-sum" data-blk-sum dir="auto" lang={c.locale}>
                  {props.template ? "" : blockSummary(b)}
               </span>
            </div>
            <span class="blk-warn" data-incomplete-note>
               <Icon name="eyeOff" size={14} /> {t.blocks.incomplete}
            </span>
            <button type="button" class="btn ghost sm icon-only blk-fold" data-blk-fold aria-expanded={props.folded ? "false" : "true"} aria-controls={`${uid}-b`} aria-label={props.folded ? t.blocks.expand : t.blocks.collapse} title={props.folded ? t.blocks.expand : t.blocks.collapse} aria-describedby={`${uid}-h`}>
               <Icon name="chevronDown" size={18} />
            </button>
            <Tools v={c.v} uid={uid} />
         </div>
         <p class="err" data-block-err role="alert" hidden />
         <div class="blk-b" id={`${uid}-b`}>
            <BlockBody c={c} uid={uid} b={b} />
            <StylePanel c={c} uid={uid} b={b} />
         </div>
         <div class="blk-ins">
            <button type="button" class="btn ghost sm" data-open-picker="after" aria-describedby={`${uid}-h`}>
               <Icon name="plus" size={16} /> {t.blocks.addBelow}
            </button>
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
   const blocks = props.kinds.includes("blocks");
   return (
      <>
         {blocks
            ? PAGE_BLOCK_PRESETS.map((p) => (
                 <template data-seq-template={`block:${p.key}`}>
                    <BlockItem c={c} b={presetBlock(p.key, "tpl")} uid={T} template />
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
         {blocks ? (
            <>
               <template data-seq-template="hero-buttons">
                  <HeroButtonItem c={c} uid={T} item={{ label: "", url: "", variant: "secondary" }} />
               </template>
               <template data-seq-template="layout-cols">
                  <LayoutColItem c={c} uid={T} item={{ media_id: null, alt: "", heading: "", text: "", label: "", url: "" }} />
               </template>
               <template data-seq-template="cards">
                  <CardItemRow c={c} uid={T} item={{ media_id: null, alt: "", title: "", text: "", label: "", url: "" }} />
               </template>
               <template data-seq-template="faq">
                  <FaqItemRow c={c} uid={T} item={{ q: "", a: "" }} />
               </template>
               <template data-seq-template="stats">
                  <StatItemRow c={c} uid={T} item={{ value: "", label: "", text: "", icon: "" }} />
               </template>
            </>
         ) : null}
      </>
   );
}

/**
 * Schematic thumbnails for the block picker: what the section looks like, drawn with the admin's own
 * colours (currentColor + the `pk-*` classes), so they follow the admin theme, light and dark.
 */
function PresetThumb(props: { k: PresetKey }) {
   const line = (x: number, y: number, w: number, cls = "pk-ln") => <rect class={cls} x={x} y={y} width={w} height="4" rx="2" />;
   const img = (x: number, y: number, w: number, h: number) => (
      <g>
         <rect class="pk-img" x={x} y={y} width={w} height={h} rx="3" />
         <path class="pk-mtn" d={`M${x + 3} ${y + h - 3} l${w * 0.3} ${-h * 0.45} l${w * 0.2} ${h * 0.25} l${w * 0.15} ${-h * 0.12} L${x + w - 3} ${y + h - 3}z`} />
      </g>
   );
   const card = (x: number, y: number, w: number, h: number) => <rect class="pk-box" x={x} y={y} width={w} height={h} rx="4" />;
   const btn = (x: number, y: number, w = 22, cls = "pk-btn") => <rect class={cls} x={x} y={y} width={w} height="8" rx="4" />;
   let body: Child;
   switch (props.k) {
      case "hero":
         body = (
            <>
               <rect class="pk-night" x="0" y="0" width="120" height="72" rx="6" />
               <circle class="pk-glow" cx="92" cy="10" r="20" />
               {line(40, 18, 40, "pk-ln-inv pk-dim")}
               <rect class="pk-ln-inv" x="24" y="27" width="72" height="7" rx="3" />
               {line(34, 39, 52, "pk-ln-inv pk-dim")}
               {btn(36, 50, 22)}
               {btn(62, 50, 22, "pk-btn-o")}
            </>
         );
         break;
      case "layout2":
         body = [0, 1].map((i) => (
            <g>
               {img(10 + i * 52, 10, 46, 26)}
               {line(10 + i * 52, 42, 34, "pk-ln pk-strong")}
               {line(10 + i * 52, 50, 46)}
               {line(10 + i * 52, 57, 40)}
            </g>
         ));
         break;
      case "layout3":
         body = [0, 1, 2].map((i) => (
            <g>
               {img(8 + i * 36, 12, 32, 22)}
               {line(8 + i * 36, 40, 24, "pk-ln pk-strong")}
               {line(8 + i * 36, 48, 32)}
               {line(8 + i * 36, 55, 28)}
            </g>
         ));
         break;
      case "columns":
         body = (
            <>
               {line(10, 16, 36, "pk-ln pk-strong")}
               {line(10, 26, 46)}
               {line(10, 33, 42)}
               {line(10, 40, 46)}
               {line(10, 47, 30)}
               {img(64, 12, 46, 48)}
            </>
         );
         break;
      case "divider":
         body = (
            <>
               {line(14, 18, 60)}
               <rect class="pk-acc" x="20" y="35" width="80" height="2" rx="1" />
               <circle class="pk-acc" cx="60" cy="36" r="3" />
               {line(14, 50, 70)}
            </>
         );
         break;
      case "spacer":
         body = (
            <>
               {line(14, 14, 60)}
               <path class="pk-dash" d="M60 24v24M54 28l6-6 6 6M54 44l6 6 6-6" />
               {line(14, 56, 70)}
            </>
         );
         break;
      case "markdown":
         body = (
            <>
               <rect class="pk-ln pk-strong" x="20" y="12" width="50" height="7" rx="3" />
               {line(20, 26, 80)}
               {line(20, 33, 74)}
               {line(20, 40, 80)}
               {line(20, 50, 66)}
               {line(20, 57, 72)}
            </>
         );
         break;
      case "image":
         body = (
            <>
               {img(20, 8, 80, 46)}
               {line(36, 60, 48)}
            </>
         );
         break;
      case "gallery":
         body = [0, 1, 2, 3, 4, 5].map((i) => img(10 + (i % 3) * 34, 10 + Math.floor(i / 3) * 28, 30, 24));
         break;
      case "quote":
         body = (
            <>
               <rect class="pk-acc" x="18" y="14" width="3" height="44" rx="1.5" />
               <text class="pk-q" x="28" y="34">
                  “
               </text>
               {line(44, 22, 56, "pk-ln pk-strong")}
               {line(44, 31, 52, "pk-ln pk-strong")}
               {line(44, 40, 40, "pk-ln pk-strong")}
               {line(44, 52, 28)}
            </>
         );
         break;
      case "cardgrid":
         body = [0, 1, 2].map((i) => (
            <g>
               {card(8 + i * 36, 8, 32, 56)}
               <rect class="pk-acc" x={8 + i * 36} y="8" width="32" height="3" rx="1.5" />
               {img(11 + i * 36, 14, 26, 18)}
               {line(11 + i * 36, 37, 20, "pk-ln pk-strong")}
               {line(11 + i * 36, 45, 26)}
               {line(11 + i * 36, 52, 22)}
            </g>
         ));
         break;
      case "features":
         body = [0, 1, 2].map((i) => (
            <g>
               <rect class="pk-chip" x={14 + i * 34} y="14" width="22" height="22" rx="7" />
               <circle class="pk-acc" cx={25 + i * 34} cy="25" r="5" />
               {line(10 + i * 34, 44, 30, "pk-ln pk-strong")}
               {line(12 + i * 34, 52, 26)}
            </g>
         ));
         break;
      case "stats":
         body = (
            <>
               <rect class="pk-soft" x="0" y="0" width="120" height="72" rx="6" />
               {[0, 1, 2].map((i) => (
                  <g>
                     <rect class="pk-acc" x={14 + i * 34} y="20" width="26" height="13" rx="3" />
                     {line(12 + i * 34, 41, 30)}
                  </g>
               ))}
            </>
         );
         break;
      case "faq":
         body = [0, 1, 2].map((i) => (
            <g>
               {card(14, 10 + i * 18, 92, 14)}
               {line(20, 15 + i * 18, 50, "pk-ln pk-strong")}
               <path class="pk-dash" d={`M95 ${15 + i * 18}l3 3 3-3`} />
            </g>
         ));
         break;
      case "cta":
         body = (
            <>
               <rect class="pk-acc-soft" x="10" y="14" width="100" height="44" rx="8" />
               {line(20, 25, 50, "pk-ln pk-strong")}
               {line(20, 34, 64)}
               {btn(20, 43, 26)}
            </>
         );
         break;
      case "ctaband":
         body = (
            <>
               <rect class="pk-night" x="0" y="14" width="120" height="44" rx="0" />
               <rect class="pk-ln-inv" x="30" y="24" width="60" height="6" rx="3" />
               {line(38, 34, 44, "pk-ln-inv pk-dim")}
               {btn(48, 43, 24)}
            </>
         );
         break;
      case "contact":
         body = (
            <>
               {card(14, 12, 92, 48)}
               <rect class="pk-chip" x="22" y="22" width="20" height="20" rx="6" />
               <path class="pk-dash" d="M26 28h12v9H26zM26 28l6 5 6-5" />
               {line(50, 24, 40, "pk-ln pk-strong")}
               {line(50, 32, 46)}
               {btn(50, 42, 26)}
            </>
         );
         break;
      case "video":
         body = (
            <>
               <rect class="pk-night" x="16" y="8" width="88" height="50" rx="5" />
               <circle class="pk-play" cx="60" cy="33" r="11" />
               <path class="pk-play-ic" d="M57 27.5v11l9-5.5z" />
               {line(16, 63, 50)}
            </>
         );
         break;
      case "videos":
         body = [0, 1, 2].map((i) => (
            <g>
               <rect class="pk-night" x={8 + i * 36} y="16" width="32" height="20" rx="3" />
               <path class="pk-play-ic" d={`M${22 + i * 36} 22v8l6-4z`} />
               {line(8 + i * 36, 42, 28, "pk-ln pk-strong")}
               {line(8 + i * 36, 50, 20)}
            </g>
         ));
         break;
      case "posts":
         body = [0, 1, 2].map((i) => (
            <g>
               {img(12, 8 + i * 20, 24, 16)}
               {line(42, 11 + i * 20, 50, "pk-ln pk-strong")}
               {line(42, 18 + i * 20, 64)}
            </g>
         ));
         break;
      case "cards":
         body = (
            <>
               {[0, 1, 2].map((i) => (
                  <rect class="pk-chip" x={10 + i * 24} y="8" width="20" height="8" rx="4" />
               ))}
               {[0, 1, 2].map((i) => (
                  <g>
                     {img(10 + i * 34, 22, 30, 38)}
                  </g>
               ))}
            </>
         );
         break;
   }
   return (
      <svg class="pk-svg" viewBox="0 0 120 72" width="120" height="72" aria-hidden="true" focusable="false">
         {body}
      </svg>
   );
}

/** The block picker: presets in groups, with thumbnails and a filter. Opened at an insertion point. */
function BlockPicker(props: { v: View }) {
   const tb = props.v.t.blocks;
   const groups = ["layout", "basic", "sections", "media"] as const;
   return (
      <dialog class="dlg pk-dlg" id="blk-picker" aria-labelledby="blk-picker-h">
         <div class="dlg-h">
            <h2 id="blk-picker-h">{tb.pickerTitle}</h2>
            <button class="ic" type="button" data-picker-close aria-label={tb.close} style="color:inherit">
               <Icon name="x" />
            </button>
         </div>
         <div class="dlg-b stack">
            <div class="pk-search">
               <Icon name="search" size={18} />
               <input type="search" class="input" data-picker-q aria-label={tb.pickerSearch} placeholder={tb.pickerSearch} autocomplete="off" />
            </div>
            {groups.map((g) => (
               <section class="pk-group" aria-labelledby={`pk-g-${g}`} data-pk-group>
                  <h3 id={`pk-g-${g}`}>{tb.groups[g]}</h3>
                  <ul class="pk-grid">
                     {PAGE_BLOCK_PRESETS.filter((p) => p.group === g).map((p) => {
                        const [name, desc] = tb.presets[p.key] ?? [tb.types[p.type], tb.typeHelp[p.type]];
                        return (
                           <li data-pk-item data-search={`${name} ${desc} ${tb.types[p.type]} ${p.key}`.toLowerCase()}>
                              <button type="button" class="pk-card" data-preset={p.key} data-preset-name={name}>
                                 <span class="pk-thumb">
                                    <PresetThumb k={p.key} />
                                 </span>
                                 <span class="pk-t">{name}</span>
                                 <span class="pk-d">{desc}</span>
                              </button>
                           </li>
                        );
                     })}
                  </ul>
               </section>
            ))}
            <p class="muted" data-picker-none hidden>
               {tb.pickerNone}
            </p>
         </div>
      </dialog>
   );
}

/** What the builder needs beyond the blocks: the page, its other-language version and the preview assets. */
export interface BuilderInfo {
   pageId: number | null;
   title: string;
   summary: string;
   other: { locale: Locale; id: number | null };
   themes: Record<string, string>;
   css: string;
   theme: string;
   mode: "light" | "dark";
}

export function BlocksEditor(props: { v: View; locale: Locale; blocks: Block[]; refs: Refs; builder: BuilderInfo }) {
   const c: Ctx = { v: props.v, locale: props.locale, refs: props.refs };
   const tb = props.v.t.blocks;
   const bi = props.builder;
   const names = tb.langNames;
   const otherName = names[bi.other.locale] ?? bi.other.locale;
   // Translate is for staff (POST /admin/api/translate answers admins and editors only).
   const staff = props.v.user.role === "admin" || props.v.user.role === "editor";
   return (
      <section
         class="card stack bld"
         aria-labelledby="blocks-h"
         data-blocks-editor
         data-locale={props.locale}
         data-page-id={bi.pageId ? String(bi.pageId) : ""}
         data-other-locale={bi.other.locale}
         data-other-id={bi.other.id ? String(bi.other.id) : ""}
         data-pv-themes={JSON.stringify(bi.themes)}
         data-pv-css={bi.css}
         data-page-title={bi.title}
         data-page-summary={bi.summary}
      >
         <div class="blk-head bld-head">
            <div class="bld-title">
               <h2 id="blocks-h" style="margin:0">
                  {tb.title} <span class="badge loc" data-blk-count>{tb.blocksCount(props.blocks.length)}</span>
               </h2>
               <p class="help bld-intro" style="margin:4px 0 0">
                  {tb.builderHelp}
               </p>
            </div>
            <div class="bld-open-row">
               <button type="button" class="btn primary" data-builder-open aria-expanded="false">
                  <Icon name="layers" size={18} /> {tb.openBuilder}
               </button>
            </div>
            <div class="bld-bar" role="toolbar" aria-label={tb.builder}>
               <div class="seg" role="group" aria-label={tb.previewDevice}>
                  <button type="button" aria-pressed="true" data-pv-device="desktop" title={tb.desktop}>
                     <Icon name="monitor" size={16} /> <span class="bld-l">{tb.desktop}</span>
                  </button>
                  <button type="button" aria-pressed="false" data-pv-device="phone" title={tb.phone}>
                     <Icon name="smartphone" size={16} /> <span class="bld-l">{tb.phone}</span>
                  </button>
               </div>
               <div class="seg" role="group" aria-label={tb.previewLang}>
                  <button type="button" aria-pressed="true" data-pv-lang={props.locale} lang={props.locale}>
                     {props.locale.toUpperCase()}
                  </button>
                  <button type="button" aria-pressed="false" data-pv-lang={bi.other.locale} lang={bi.other.locale} title={`${otherName} · ${tb.savedVersion}`}>
                     {bi.other.locale.toUpperCase()}
                  </button>
               </div>
               <div class="seg" role="group" aria-label={tb.previewMode}>
                  <button type="button" aria-pressed={bi.mode === "light" ? "true" : "false"} data-pv-mode="light" title={tb.light}>
                     <Icon name="sun" size={16} /> <span class="vh">{tb.light}</span>
                  </button>
                  <button type="button" aria-pressed={bi.mode === "dark" ? "true" : "false"} data-pv-mode="dark" title={tb.dark}>
                     <Icon name="moon" size={16} /> <span class="vh">{tb.dark}</span>
                  </button>
               </div>
               <label class="bld-theme">
                  <span class="vh">{tb.previewTheme}</span>
                  <Icon name="palette" size={16} />
                  <select class="input sm" data-pv-theme title={tb.previewThemeHelp} aria-describedby="bld-theme-help">
                     {Object.keys(bi.themes).map((id) => (
                        <option value={id} selected={id === bi.theme}>
                           {tb.themeNames[id] ?? id}
                        </option>
                     ))}
                  </select>
                  <span class="vh" id="bld-theme-help">
                     {tb.previewThemeHelp}
                  </span>
               </label>
               <span class="bld-sp" />
               <button type="button" class="btn sm" data-copy-from={bi.other.locale} disabled={!bi.other.id} title={tb.copyFromHelp(otherName)}>
                  <Icon name="copy" size={16} /> <span class="bld-l">{tb.copyFrom(otherName)}</span>
               </button>
               {staff ? (
                  <button type="button" class="btn sm" data-copy-translate={bi.other.locale} disabled={!bi.other.id} title={tb.copyTranslateHelp(otherName)} aria-label={tb.copyTranslate(otherName)}>
                     <Icon name="languages" size={16} /> <span class="bld-l">{tb.copyTranslateShort}</span>
                  </button>
               ) : null}
               <button type="button" class="btn sm primary" data-builder-save>
                  <Icon name="check" size={16} /> <span data-builder-save-label>{tb.saveFromBuilder}</span>
               </button>
               <button type="button" class="btn sm" data-builder-close>
                  {tb.done}
               </button>
            </div>
            {staff ? (
               <div class="bt-progress" data-bt-progress hidden>
                  <progress max={1} value={0} aria-labelledby="bt-progress-text" />
                  <span id="bt-progress-text" role="status" aria-live="polite" data-bt-progress-text />
                  <button type="button" class="btn sm" data-bt-stop>
                     {tb.translateStop}
                  </button>
               </div>
            ) : null}
         </div>
         <div class="bld-main">
            <div class="bld-edit" data-blocks-edit>
               <ol class="blk-list" data-k="blocks" data-seq-list="blocks" data-empty={tb.empty} aria-label={tb.title}>
                  {props.blocks.map((b) => (
                     <BlockItem c={c} b={b} folded={props.blocks.length > 2} />
                  ))}
               </ol>
               <button type="button" class="blk-add-main" data-open-picker="end">
                  <span class="blk-add-plus" aria-hidden="true">
                     <Icon name="plus" size={20} />
                  </span>
                  <span>
                     <span class="blk-add-t">{tb.pickerTitle}</span>
                     <span class="blk-add-d">{tb.intro}</span>
                  </span>
               </button>
            </div>
            <div class="bld-pv" data-builder-pv>
               <div class="bld-pv-h">
                  <span class="bld-pv-t">
                     <Icon name="eye" size={16} /> {tb.livePreview}
                  </span>
                  <span class="muted bld-pv-note" data-pv-note role="status" aria-live="polite" />
               </div>
               <div class="bld-stage" data-pv-stage>
                  <div class="bld-frame" data-pv-frame-box data-device="desktop">
                     <iframe class="bld-iframe" title={tb.livePreview} sandbox="allow-same-origin" data-pv-frame tabindex={-1} />
                  </div>
               </div>
            </div>
         </div>
         <p class="vh" role="status" aria-live="polite" data-seq-live />
         <BlockPicker v={props.v} />
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
