/**
 * Secrets each deployed CMS Worker needs (names and purposes only — never a value).
 * Read by check-secrets.ts (pre-promote gate in release.yml and deploy-qa.yml).
 * When code starts reading a new secret, add it here in the same PR.
 *
 * Not a secret on purpose: there is no CMS_CLIENT_SECRET. The CMS is a public PKCE client
 * (SPEC §3): auth does not verify client secrets on the authorization_code grant.
 */
import { ENVS, type EnvName } from "./release/envs.ts";

export interface RequiredSecret {
   name: string;
   purpose: string;
}

export interface WorkerSecrets {
   env: EnvName;
   worker: string;
   required: RequiredSecret[];
   /** May be bound (a feature turns on when it is); reported, never a failure — unless bound as a plain var. */
   optional: RequiredSecret[];
   /** Must NOT be bound (e.g. a retired confidential-client secret). */
   forbidden: string[];
}

export const CMS_SECRETS: RequiredSecret[] = [
   {
      name: "BKND_JWT_SECRET",
      purpose:
         "worker secret, `openssl rand -hex 32`; signs bknd session cookies and the SSO state cookie, and is the root of the draft-preview token key (src/lib/preview.ts)",
   },
];

/** AI assist (docs/AI_ASSIST_SPEC.md §2): without it the feature shows "isn't set up" to admins. */
export const CMS_OPTIONAL_SECRETS: RequiredSecret[] = [
   {
      name: "ANTHROPIC_API_KEY",
      purpose: "Claude API key for AI writing assist; a Secrets Store binding (secret anthropic-api-key) or a Worker secret",
   },
];

export const SECRETS_MANIFEST: WorkerSecrets[] = (Object.keys(ENVS) as EnvName[]).map((env) => ({
   env,
   worker: ENVS[env].worker,
   required: CMS_SECRETS,
   optional: CMS_OPTIONAL_SECRETS,
   forbidden: ["CMS_CLIENT_SECRET"],
}));
