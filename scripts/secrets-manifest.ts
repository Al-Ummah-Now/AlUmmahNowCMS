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
   /**
    * Names an admin may reference from AI assist settings (docs/AI_PROVIDERS.md): optional, and when
    * bound they must be a Worker secret or a Secrets Store binding, never a plain var.
    */
   optionalPattern?: RegExp;
   /**
    * Any other binding whose name looks like a credential is refused: a provider key must use the
    * pattern above, so it is only reachable through the AI settings (and only by that name).
    */
   keyLike?: RegExp;
}

export const CMS_SECRETS: RequiredSecret[] = [
   {
      name: "BKND_JWT_SECRET",
      purpose:
         "worker secret, `openssl rand -hex 32`; signs bknd session cookies and the SSO state cookie, and is the root of the draft-preview token key (src/lib/preview.ts)",
   },
];

/** AI provider keys are optional by pattern (AI_KEY_PATTERN); Workers AI needs no key. */
export const CMS_OPTIONAL_SECRETS: RequiredSecret[] = [
   {
      name: "VIDEOS_INTERNAL_API_KEY",
      purpose:
         "Secrets Store binding (internal-api-key[-qa|-stage]); service-to-service key for api-videos, used to mirror scholar articles to their channel Community tab (docs/SCHOLARS.md). Unbound = mirroring off.",
   },
];

/** Must equal SECRET_NAME in src/lib/ai/settings.ts (a test checks). */
export const AI_KEY_PATTERN = /^AI_KEY_[A-Z0-9_]{1,48}$/;
export const KEY_LIKE = /API_?KEY|(^|_)KEY($|_)|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE/i;

export const SECRETS_MANIFEST: WorkerSecrets[] = (Object.keys(ENVS) as EnvName[]).map((env) => ({
   env,
   worker: ENVS[env].worker,
   required: CMS_SECRETS,
   optional: CMS_OPTIONAL_SECRETS,
   forbidden: ["CMS_CLIENT_SECRET"],
   optionalPattern: AI_KEY_PATTERN,
   keyLike: KEY_LIKE,
}));
