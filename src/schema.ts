/**
 * Content model (SPEC §4). bknd code mode: this file is the single source of truth for the data
 * model. Every change here must ship with an expand-only migration in `migrations/` — the schema
 * check (`npm run check:schema`) fails if the two drift apart.
 *
 * Expand-only: never remove or rename a field here. Stop reading it instead.
 */
import { boolean, em, entity, enumm, json, medium, number, systemEntity, text, datetime } from "bknd";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const STATUSES = ["draft", "published"] as const;

/** Entities editors may read/create/update (no delete). Used by the editor role's policies. */
export const CONTENT_ENTITIES = ["pages", "posts", "nav_items", "curated_videos", "site_settings"] as const;

const status = () => enumm({ enum: [...STATUSES], default_value: "draft" }).required();
const locale = () => enumm({ enum: [...LOCALES] }).required();
// Maintained by src/lib/content-rules.ts (not bknd's timestamps plugin: see that file).
const timestamps = () => ({
   created_at: datetime({ hidden: ["create", "update"] }),
   updated_at: datetime({ hidden: ["create", "update"] }),
});

export const schema = em(
   {
      pages: entity(
         "pages",
         {
            slug: text({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }).required(),
            locale: locale(),
            translation_key: text(),
            title: text().required(),
            summary: text(),
            body: text({ description: "Markdown. HTML is not rendered." }),
            status: status(),
            published_at: datetime(),
            // Scheduled publishing (#7): a published row goes live at publish_at (NULL = at once).
            publish_at: datetime(),
            seo_title: text(),
            seo_description: text(),
            cover: medium(),
            show_in_sitemap: boolean({ default_value: true }),
            // Ordered blocks (src/lib/blocks.ts). `body` stays: it is derived from the blocks on save
            // (content-rules) for readers of the v1 contract that predate blocks.
            blocks: json<unknown[]>({ description: "Ordered page blocks (src/lib/blocks.ts)." }),
            // docs/specs/WWW-PAGES.md: NULL = content page (blocks); "curated" = its own list (page_entries);
            // "filter" = everything published of list_filter's kinds (src/lib/lists.ts).
            list_kind: text({ description: "NULL (content page) | curated | filter" }),
            list_filter: json<unknown>({ description: "Filter pages: {kinds, tag} (src/lib/lists.ts)." }),
            ...timestamps(),
         },
         { primary_format: "integer" },
      ),
      posts: entity(
         "posts",
         {
            slug: text({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }).required(),
            locale: locale(),
            translation_key: text(),
            title: text().required(),
            excerpt: text(),
            body: text({ description: "Markdown. HTML is not rendered." }),
            status: status(),
            published_at: datetime(),
            publish_at: datetime(),
            author_name: text(),
            tags: json<string[]>({ default_value: [] }),
            // "article" (markdown body) or "cards" (ordered slides, src/lib/blocks.ts). NULL reads as article.
            kind: enumm({ enum: ["article", "cards"], default_value: "article" }),
            slides: json<unknown[]>({ description: "Card post slides (src/lib/blocks.ts)." }),
            // On www's home timeline once live (src/lib/feed). NULL reads as true: every post is on by default.
            show_on_timeline: boolean({ default_value: true }),
            cover: medium(),
            seo_title: text(),
            seo_description: text(),
            // Scholar posts (migrations/0013, docs/SCHOLARS.md). Set by the Worker only: content rules
            // strip them from data API writes (src/lib/scholars/ownership.ts).
            author_sub: text({ hidden: ["create", "update"] }),
            featured_at: datetime({ hidden: ["create", "update"] }),
            featured_by: text({ hidden: ["create", "update"] }),
            community_post_id: text({ hidden: ["create", "update"] }),
            ...timestamps(),
         },
         { primary_format: "integer" },
      ),
      nav_items: entity(
         "nav_items",
         {
            menu: enumm({ enum: ["header", "footer"] }).required(),
            locale: locale(),
            label: text().required(),
            url: text({ description: 'Relative "/…" (no locale prefix) or absolute https://' }).required(),
            sort: number({ default_value: 0 }),
            status: status(),
            ...timestamps(),
         },
         { primary_format: "integer" },
      ),
      curated_videos: entity(
         "curated_videos",
         {
            kind: enumm({ enum: ["video", "playlist", "channel"] }).required(),
            ref_id: text().required(),
            placement: enumm({ enum: ["home", "videos"] }).required(),
            locale: enumm({ enum: ["en", "ar", "all"], default_value: "all" }),
            title_override: text(),
            sort: number({ default_value: 0 }),
            status: status(),
            snapshot: json<{ title: string; thumbnail_url: string | null; channel_name: string | null }>(),
            ...timestamps(),
         },
         { primary_format: "integer" },
      ),
      site_settings: entity(
         "site_settings",
         {
            locale: locale(),
            site_title: text().required(),
            tagline: text(),
            hero_title: text(),
            hero_body: text(),
            social: json<{ kind: string; url: string }[]>({ default_value: [] }),
            ...timestamps(),
         },
         { primary_format: "integer" },
      ),
      // bknd's users table is a cache of SSO identities (SPEC §3). `sso_sub` is the auth `sub`.
      users: systemEntity("users", {
         sso_sub: text(),
      }),
      media: systemEntity("media", {}),
   },
   ({ index }, e) => {
      index(e.pages).on(["slug", "locale"], true);
      index(e.posts).on(["slug", "locale"], true);
      index(e.site_settings).on(["locale"], true);
      index(e.users).on(["sso_sub"], true);
      index(e.posts).on(["status", "locale", "published_at"]);
      index(e.posts).on(["kind", "status", "locale", "published_at"]);
      index(e.posts).on(["author_sub", "status", "locale", "published_at"]);
      index(e.curated_videos).on(["placement", "status"]);
      // One row per video per placement and locale (migrations/0002): the picker inserts ON CONFLICT DO NOTHING.
      index(e.curated_videos).on(["kind", "ref_id", "placement", "locale"], true);
      index(e.nav_items).on(["menu", "locale"]);
   },
);

export type ContentDB = (typeof schema)["DB"];
