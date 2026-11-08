import type { App } from "bknd";
import type { Context } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { Env, RuntimeConfig } from "./env.ts";

export interface AuthUser {
   id: number | string;
   email: string;
   role?: string;
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
