/**
 * The rules of a www list page's kind and filter (docs/specs/WWW-PAGES.md), with no imports so the
 * content rules, the staff client and the public API all share them. Queries: src/lib/lists.ts.
 */
export const LIST_KINDS = ["curated", "filter"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const ITEM_KINDS = ["article", "cards", "video", "playlist", "channel"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const POST_KINDS: readonly ItemKind[] = ["article", "cards"];
export const VIDEO_KINDS: readonly ItemKind[] = ["video", "playlist", "channel"];
export const LIST_PAGE_SIZE = 20;
export const TAG_MAX = 40;

export interface ListFilter {
   kinds: ItemKind[];
   tag: string | null;
}

export class ListError extends Error {
   constructor(
      readonly code: "bad_filter" | "bad_kind",
      message: string,
   ) {
      super(message);
   }
}

/** The stored shape of a filter (pages.list_filter); throws ListError for anything else. */
export function normalizeFilter(v: unknown): ListFilter {
   let o = v;
   if (typeof o === "string") {
      try {
         o = JSON.parse(o);
      } catch {
         throw new ListError("bad_filter", "the filter must be JSON");
      }
   }
   if (!o || typeof o !== "object" || Array.isArray(o)) throw new ListError("bad_filter", "the filter must be an object");
   const r = o as Record<string, unknown>;
   const kinds = Array.isArray(r.kinds) ? r.kinds : [];
   if (!kinds.length || kinds.some((k) => !(ITEM_KINDS as readonly unknown[]).includes(k))) throw new ListError("bad_filter", `kinds must be one or more of ${ITEM_KINDS.join(", ")}`);
   const tag = typeof r.tag === "string" ? r.tag.trim() : "";
   if (tag.length > TAG_MAX) throw new ListError("bad_filter", `tag must be at most ${TAG_MAX} characters`);
   return { kinds: ITEM_KINDS.filter((k) => kinds.includes(k)), tag: tag || null };
}

/** A stored filter, or null when it is missing or invalid (a bad row never breaks the public API). */
export function storedFilter(v: unknown): ListFilter | null {
   if (v === null || v === undefined || v === "") return null;
   try {
      return normalizeFilter(v);
   } catch {
      return null;
   }
}

export const listKindOf = (v: unknown): ListKind | null => ((LIST_KINDS as readonly unknown[]).includes(v) ? (v as ListKind) : null);

