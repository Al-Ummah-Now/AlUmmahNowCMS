/**
 * Scholar profiles (docs/SCHOLARS.md §3, migrations/0013 `scholars`). Worker-only: never on bknd's
 * data API. One profile per auth user (`sso_sub`), created on their first CMS sign-in as a writer,
 * editable by the scholar and by admins and editors. Deleting one is a soft delete (src/lib/trash.ts,
 * kind "scholars"): restorable for 30 days.
 */
import { slugify as titleSlug } from "../slug.ts";

export interface Scholar {
   id: number;
   sso_sub: string;
   slug: string;
   name_en: string | null;
   name_ar: string | null;
   bio_en: string | null;
   bio_ar: string | null;
   avatar_media_id: number | null;
   channel_ids: string[];
   created_at: string;
   updated_at: string;
   updated_by: string | null;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 60;
export const NAME_MAX = 120;
export const BIO_MAX = 2000;
export const CHANNELS_MAX = 5;
export const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Slugs www uses for its own routes under /{locale}/scholars/. */
const RESERVED = new Set(["page", "rss", "feed", "new", "me", "search"]);

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function scholarOf(r: Row): Scholar {
   let channels: string[] = [];
   try {
      const parsed = typeof r.channel_ids === "string" ? (JSON.parse(r.channel_ids) as unknown) : r.channel_ids;
      if (Array.isArray(parsed)) channels = parsed.filter((x): x is string => typeof x === "string" && CHANNEL_ID_RE.test(x));
   } catch {
      channels = [];
   }
   return {
      id: Number(r.id),
      sso_sub: String(r.sso_sub),
      slug: String(r.slug),
      name_en: str(r.name_en),
      name_ar: str(r.name_ar),
      bio_en: str(r.bio_en),
      bio_ar: str(r.bio_ar),
      avatar_media_id: r.avatar_media_id === null || r.avatar_media_id === undefined ? null : Number(r.avatar_media_id),
      channel_ids: channels,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      updated_by: str(r.updated_by),
   };
}

/** The name to show in `locale`, falling back to the other language, then the slug. */
export function scholarName(s: Pick<Scholar, "name_en" | "name_ar" | "slug">, locale: "en" | "ar"): string {
   const en = s.name_en?.trim() || null;
   const ar = s.name_ar?.trim() || null;
   return (locale === "ar" ? (ar ?? en) : (en ?? ar)) ?? s.slug;
}

export function scholarBio(s: Pick<Scholar, "bio_en" | "bio_ar">, locale: "en" | "ar"): string | null {
   return locale === "ar" ? (s.bio_ar ?? s.bio_en) : (s.bio_en ?? s.bio_ar);
}

/** A url slug from a name or an email's local part ("Dr. Aisha Al-Amin" → "dr-aisha-al-amin"; Arabic is transliterated). */
export function slugify(input: string): string {
   const out = titleSlug(input.replace(/@.*$/, ""), SLUG_MAX);
   return out && !RESERVED.has(out) ? out : "scholar";
}

export async function scholarOfSub(db: D1Database, sub: string | null | undefined): Promise<Scholar | null> {
   if (!sub) return null;
   const row = await db.prepare("SELECT * FROM scholars WHERE sso_sub = ?1").bind(sub).first<Row>();
   return row ? scholarOf(row) : null;
}

export async function scholarById(db: D1Database, id: number): Promise<Scholar | null> {
   const row = await db.prepare("SELECT * FROM scholars WHERE id = ?1").bind(id).first<Row>();
   return row ? scholarOf(row) : null;
}

export async function scholarBySlug(db: D1Database, slug: string): Promise<Scholar | null> {
   if (!SLUG_RE.test(slug)) return null;
   const row = await db.prepare("SELECT * FROM scholars WHERE slug = ?1").bind(slug).first<Row>();
   return row ? scholarOf(row) : null;
}

/** Profiles by auth user id, for bylines (one query for a whole list of posts). */
export async function scholarsBySubs(db: D1Database, subs: string[]): Promise<Map<string, Scholar>> {
   const out = new Map<string, Scholar>();
   const unique = [...new Set(subs.filter(Boolean))];
   for (let i = 0; i < unique.length; i += 90) {
      const part = unique.slice(i, i + 90);
      const { results } = await db
         .prepare(`SELECT * FROM scholars WHERE sso_sub IN (${part.map((_, j) => `?${j + 1}`).join(",")})`)
         .bind(...part)
         .all<Row>();
      for (const r of results) out.set(String(r.sso_sub), scholarOf(r));
   }
   return out;
}

/** The scholar whose channels include `channelId` (the videos channel page links to their page). */
export async function scholarByChannel(db: D1Database, channelId: string): Promise<Scholar | null> {
   if (!CHANNEL_ID_RE.test(channelId)) return null;
   const row = await db
      .prepare("SELECT s.* FROM scholars s, json_each(CASE WHEN json_valid(s.channel_ids) THEN s.channel_ids ELSE '[]' END) j WHERE j.value = ?1 ORDER BY s.id LIMIT 1")
      .bind(channelId)
      .first<Row>();
   return row ? scholarOf(row) : null;
}

export interface ScholarListItem extends Scholar {
   posts: number;
}

/** Staff list (Scholars screen) and the public directory: name or slug search, newest first. */
export async function listScholars(db: D1Database, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ items: ScholarListItem[]; total: number }> {
   const q = (opts.q ?? "").trim().toLowerCase().slice(0, 100);
   const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
   const where = `(?1 = '' OR lower(coalesce(s.name_en, '')) LIKE ?2 ESCAPE '\\' OR coalesce(s.name_ar, '') LIKE ?2 ESCAPE '\\' OR s.slug LIKE ?2 ESCAPE '\\')`;
   const [rows, count] = await Promise.all([
      db
         .prepare(
            `SELECT s.*, (SELECT COUNT(*) FROM posts p WHERE p.author_sub = s.sso_sub) AS posts FROM scholars s WHERE ${where}
             ORDER BY lower(coalesce(s.name_en, s.name_ar, s.slug)), s.id LIMIT ?3 OFFSET ?4`,
         )
         .bind(q, like, Math.min(opts.limit ?? 50, 200), opts.offset ?? 0)
         .all<Row>(),
      db.prepare(`SELECT COUNT(*) AS n FROM scholars s WHERE ${where}`).bind(q, like).first<{ n: number }>(),
   ]);
   return { items: rows.results.map((r) => ({ ...scholarOf(r), posts: Number(r.posts ?? 0) })), total: Number(count?.n ?? 0) };
}

async function freeSlug(db: D1Database, base: string, exceptId?: number): Promise<string> {
   const root = slugify(base);
   for (let i = 1; i <= 50; i++) {
      const candidate = i === 1 ? root : `${root.slice(0, SLUG_MAX - String(i).length - 1)}-${i}`;
      const taken = await db.prepare("SELECT id FROM scholars WHERE slug = ?1 AND id IS NOT ?2").bind(candidate, exceptId ?? null).first();
      if (!taken) return candidate;
   }
   return `${root.slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`;
}

const ARABIC = /[\u0600-\u06ff]/;
const nameOrNull = (v: string | null | undefined): string | null => {
   const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
   return t || null;
};

/**
 * A new profile's names: the token's name when auth sends one (its script picks the column), else
 * the account's names resolved by the platform rule (src/lib/display-name.ts: display name, then
 * first + last). An Arabic name goes to name_ar; the Arabic-page name is kept only when it differs.
 */
export function initialNames(who: { name?: string | null; names?: { en?: string | null; ar?: string | null } }): { en: string | null; ar: string | null } {
   const token = nameOrNull(who.name);
   if (token) return ARABIC.test(token) ? { en: null, ar: token } : { en: token, ar: null };
   const en = nameOrNull(who.names?.en);
   const ar = nameOrNull(who.names?.ar);
   return {
      en: en && !ARABIC.test(en) ? en : null,
      ar: ar && (ARABIC.test(ar) || ar !== en) ? ar : en && ARABIC.test(en) ? en : null,
   };
}

/**
 * The profile of a writer, created on their first CMS sign-in. Idempotent and race-safe: the unique
 * sso_sub index decides, and a concurrent second sign-in reads the row the first one made.
 */
export async function ensureScholar(
   db: D1Database,
   who: { sub: string; email: string; name?: string | null; names?: { en?: string | null; ar?: string | null } },
   channelIds: string[] = [],
): Promise<Scholar | null> {
   const existing = await scholarOfSub(db, who.sub);
   if (existing) return existing;
   const { en, ar } = initialNames(who);
   const name = en ?? ar;
   const slug = await freeSlug(db, name ?? who.email);
   const at = new Date().toISOString();
   await db
      .prepare(
         `INSERT INTO scholars (sso_sub, slug, name_en, name_ar, channel_ids, primary_channel_id, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?8, ?6, ?6, ?7)
          ON CONFLICT (sso_sub) DO NOTHING`,
      )
      .bind(who.sub, slug, en, ar, JSON.stringify(channelIds.slice(0, CHANNELS_MAX)), at, who.email, channelIds[0] ?? null)
      .run()
      .catch(async (error: unknown) => {
         // The slug was taken between the check and the insert: one more try with a fresh one.
         if (!/UNIQUE/i.test(String(error))) throw error;
         await db
            .prepare(`INSERT INTO scholars (sso_sub, slug, name_en, name_ar, channel_ids, primary_channel_id, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?8, ?6, ?6, ?7) ON CONFLICT (sso_sub) DO NOTHING`)
            .bind(who.sub, `${slugify(name ?? who.email).slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`, en, ar, JSON.stringify(channelIds.slice(0, CHANNELS_MAX)), at, who.email, channelIds[0] ?? null)
            .run();
      });
   return scholarOfSub(db, who.sub);
}

export class ScholarError extends Error {
   constructor(
      readonly status: 400 | 403 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
      this.name = "ScholarError";
   }
}

export interface ScholarInput {
   slug?: unknown;
   name_en?: unknown;
   name_ar?: unknown;
   bio_en?: unknown;
   bio_ar?: unknown;
   avatar_media_id?: unknown;
   channel_ids?: unknown;
   updated_at?: unknown;
}

const clean = (v: unknown, max: number, field: string): string | null => {
   if (v === null || v === undefined || v === "") return null;
   if (typeof v !== "string") throw new ScholarError(400, `bad_${field}`);
   const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
   if (t.length > max) throw new ScholarError(400, `too_long_${field}`);
   return t || null;
};

/**
 * Validates a profile edit. `allowedChannels` is what the scholar owns on the videos platform (from
 * its ownership index): a profile can only link channels its scholar owns, so nobody can claim
 * someone else's channel. Pure; unit-tested.
 */
export function validateScholarInput(input: ScholarInput, allowedChannels: string[] | null): Record<string, unknown> {
   const out: Record<string, unknown> = {};
   if (input.slug !== undefined) {
      if (typeof input.slug !== "string" || !SLUG_RE.test(input.slug) || input.slug.length > SLUG_MAX || RESERVED.has(input.slug)) throw new ScholarError(400, "bad_slug");
      out.slug = input.slug;
   }
   if (input.name_en !== undefined) out.name_en = clean(input.name_en, NAME_MAX, "name");
   if (input.name_ar !== undefined) out.name_ar = clean(input.name_ar, NAME_MAX, "name");
   if (input.bio_en !== undefined) out.bio_en = clean(input.bio_en, BIO_MAX, "bio");
   if (input.bio_ar !== undefined) out.bio_ar = clean(input.bio_ar, BIO_MAX, "bio");
   if (input.avatar_media_id !== undefined) {
      const v = input.avatar_media_id;
      if (v === null || v === "") out.avatar_media_id = null;
      else if (Number.isSafeInteger(Number(v)) && Number(v) > 0) out.avatar_media_id = Number(v);
      else throw new ScholarError(400, "bad_avatar");
   }
   if (input.channel_ids !== undefined) {
      const ids = input.channel_ids;
      if (!Array.isArray(ids) || ids.length > CHANNELS_MAX || ids.some((x) => typeof x !== "string" || !CHANNEL_ID_RE.test(x))) throw new ScholarError(400, "bad_channels");
      const unique = [...new Set(ids as string[])];
      if (allowedChannels === null) throw new ScholarError(409, "channels_unavailable");
      if (unique.some((x) => !allowedChannels.includes(x))) throw new ScholarError(403, "not_your_channel");
      out.channel_ids = JSON.stringify(unique);
      // The first linked channel is the primary one: its community posts are the scholar's posts (§7).
      out.primary_channel_id = unique[0] ?? null;
   }
   return out;
}

/** Saves a profile edit with an optimistic lock on `updated_at` (409 when someone saved since). */
export async function updateScholar(db: D1Database, id: number, fields: Record<string, unknown>, expected: unknown, actorEmail: string | null): Promise<Scholar> {
   const cols = Object.keys(fields);
   if (fields.slug !== undefined) {
      const taken = await db.prepare("SELECT id FROM scholars WHERE slug = ?1 AND id <> ?2").bind(fields.slug, id).first();
      if (taken) throw new ScholarError(409, "slug_taken");
   }
   const at = new Date().toISOString();
   const set = [...cols.map((c, i) => `"${c}" = ?${i + 4}`), "updated_at = ?2", "updated_by = ?3"].join(", ");
   const lock = typeof expected === "string" && expected ? ` AND updated_at = ?${cols.length + 4}` : "";
   const res = await db
      .prepare(`UPDATE scholars SET ${set} WHERE id = ?1${lock} RETURNING id`)
      .bind(id, at, actorEmail, ...cols.map((c) => fields[c]), ...(lock ? [expected] : []))
      .first();
   if (!res) {
      const exists = await scholarById(db, id);
      if (!exists) throw new ScholarError(404, "not_found");
      throw new ScholarError(409, "conflict");
   }
   return (await scholarById(db, id))!;
}
