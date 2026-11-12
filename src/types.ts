import type { App } from "bknd";
import type { Context } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { Env, RuntimeConfig } from "./env.ts";

export interface AuthUser {
   id: number | string;
   email: string;
   role?: string;
   /** JWT issued-at (epoch seconds), checked against the account's last sign-out. */
   iat?: number;
   /** JWT expiry (epoch seconds). */
   exp?: number;
   /** The account's name at sign-in, per admin language ('' or absent: none; show the email). */
   name_en?: string;
   name_ar?: string;
   /** This session's id (minted at sign-in), revoked by its single sign-out. */
   sid?: string;
}

export type AppEnv = {
   Bindings: Env;
   Variables: { cfg: RuntimeConfig; nonce: string; user: AuthUser };
};

export type Ctx = Context<AppEnv>;

/** Injectable dependencies (tests swap the network and the JWKS). */
export interface Deps {
   fetch: typeof fetch;
   jwks?: (issuer: string) => JWTVerifyGetKey;
   getApp: (c: Ctx) => Promise<App>;
}
