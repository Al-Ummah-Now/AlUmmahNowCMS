/**
 * bknd module configuration (code mode). Shared by the Worker (`src/app.ts`) and the bknd CLI
 * (`bknd.config.ts`, used only by the schema check).
 */
import { getDefaultConfig, type CreateAppConfig } from "bknd";
import { CONTENT_ENTITIES, schema } from "./schema.ts";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_BINDING = "MEDIA";

const allow = (permission: string) => ({ permission, effect: "allow" as const, policies: [] });

const contentOnly = (permission: string) => ({
   permission,
   effect: "deny" as const,
   policies: [{ condition: { entity: { $in: [...CONTENT_ENTITIES] } }, effect: "allow" as const }],
});

/**
 * Roles (SPEC §3). The guest role is the default (`is_default`) and has no permissions at all.
 * `admin` is allowed everything. `editor` (auth "Moderator") may read/create/update content
 * entities and upload media; no deletes, no settings, no users.
 */
export const roles = {
   guest: { is_default: true, permissions: [] },
   admin: { implicit_allow: true },
   editor: {
      permissions: [
         allow("system.access.admin"),
         allow("system.access.api"),
         allow("system.schema.read"),
         allow("system.config.read"),
         contentOnly("data.entity.create"),
         contentOnly("data.entity.update"),
         {
            permission: "data.entity.read",
            effect: "deny" as const,
            policies: [
               {
                  condition: { entity: { $in: [...CONTENT_ENTITIES, "media"] } },
                  effect: "allow" as const,
               },
            ],
         },
         allow("media.file.read"),
         allow("media.file.list"),
         allow("media.file.upload"),
      ],
   },
   /**
    * `staff_writer` (auth "Writer", SS18): posts and media, like `writer`; which posts is decided by
    * the Worker: only Al Ummah Now's own (author_sub IS NULL, never a scholar post or reference),
    * src/lib/staff-writer.ts and the content rules.
    */
   staff_writer: {
      permissions: [
         allow("system.access.admin"),
         allow("system.access.api"),
         allow("system.schema.read"),
         {
            permission: "data.entity.create",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts"] } }, effect: "allow" as const }],
         },
         {
            permission: "data.entity.update",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts"] } }, effect: "allow" as const }],
         },
         {
            permission: "data.entity.read",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts", "media"] } }, effect: "allow" as const }],
         },
         allow("media.file.read"),
         allow("media.file.list"),
         allow("media.file.upload"),
      ],
   },
   /**
    * `writer` (auth "Scholar", docs/SCHOLARS.md): posts and media only. Which posts is decided by
    * the Worker, not here: the wrapper scopes every posts read to the writer's own rows and refuses
    * writes to anyone else's (src/lib/scholars/ownership.ts), and the content rules check the owner
    * again on every insert and update.
    */
   writer: {
      permissions: [
         allow("system.access.admin"),
         allow("system.access.api"),
         allow("system.schema.read"),
         {
            permission: "data.entity.create",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts"] } }, effect: "allow" as const }],
         },
         {
            permission: "data.entity.update",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts"] } }, effect: "allow" as const }],
         },
         {
            permission: "data.entity.read",
            effect: "deny" as const,
            policies: [{ condition: { entity: { $in: ["posts", "media"] } }, effect: "allow" as const }],
         },
         allow("media.file.read"),
         allow("media.file.list"),
         allow("media.file.upload"),
      ],
   },
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge for config objects (arrays and scalars from `over` replace `base`). */
export function mergeConfig<T>(base: T, over: unknown): T {
   if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : over) as T;
   const out: Plain = { ...base };
   for (const [k, v] of Object.entries(over)) out[k] = k in out ? mergeConfig(out[k], v) : v;
   return out as T;
}

/**
 * Full module config. In code mode with `isProduction: true` bknd skips config validation, which
 * also skips filling defaults, so our overrides are merged onto bknd's own defaults here.
 */
export function moduleConfig(opts: { jwtSecret: string; secureCookie: boolean; publicUrl: string }): NonNullable<CreateAppConfig["config"]> {
   return mergeConfig(getDefaultConfig(), overrides(opts)) as NonNullable<CreateAppConfig["config"]>;
}

function overrides(opts: { jwtSecret: string; secureCookie: boolean; publicUrl: string }) {
   return {
      // bknd's default CORS reflects ANY origin with credentials. The admin API is same-origin only.
      server: {
         cors: {
            origin: new URL(opts.publicUrl).origin,
            allow_methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers: ["Content-Type", "Content-Length", "Authorization", "Accept"],
            allow_credentials: true,
         },
         mcp: { enabled: false, path: "/api/system/mcp", logLevel: "warning" },
      },
      data: schema.toJSON(),
      auth: {
         enabled: true,
         allow_register: false,
         entity_name: "users",
         jwt: {
            secret: opts.jwtSecret,
            alg: "HS256",
            expires: SESSION_TTL_SECONDS,
            issuer: "al-ummah-now-cms",
            // sid: this session's id, revoked by its sign-out (src/lib/sign-outs.ts)
            // name_en / name_ar: the account's name at sign-in (src/lib/account-name.ts), for the account menu
            fields: ["id", "email", "role", "sid", "name_en", "name_ar"],
         },
         cookie: {
            path: "/",
            sameSite: "lax",
            secure: opts.secureCookie,
            httpOnly: true,
            expires: SESSION_TTL_SECONDS,
            renew: false,
            pathSuccess: "/",
            pathLoggedOut: "/sso/logged-out",
            domain: "",
            partitioned: false,
         },
         // SSO only (owner rule): bknd's password strategy is off; the wrapper also 404s its routes.
         strategies: {
            password: { type: "password", enabled: false, config: { hashing: "sha256" } },
         },
         guard: { enabled: true },
         roles: roles as never,
      },
      media: {
         enabled: true,
         entity_name: "media",
         storage: { body_max_size: MEDIA_MAX_BYTES },
         adapter: { type: "r2", config: { binding: MEDIA_BINDING } },
      },
   };
}
