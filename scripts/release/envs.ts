/** Deployed environments of the CMS Worker (mirror of wrangler.jsonc; checked by check-wrangler-config.ts). */
export type EnvName = "production" | "stage" | "qa";

export interface EnvInfo {
   worker: string;
   /** wrangler flags selecting this env (top level = production). */
   envArgs: string[];
   url: string;
   authIssuer: string;
   clientId: string;
   d1: { name: string; id: string };
   r2: string;
}

export const ENVS: Record<EnvName, EnvInfo> = {
   production: {
      worker: "al-ummah-now-cms",
      envArgs: ["--env="], // explicit top level (silences wrangler's "no target environment" warning)
      url: "https://cms.alummahnow.net",
      authIssuer: "https://auth.alummahnow.net",
      clientId: "d06fd65a-5b79-45bc-8bfd-a856b8502330",
      d1: { name: "al-ummah-now-cms", id: "ad825428-5f0d-4d0b-878b-45b94e3c9c63" },
      r2: "al-ummah-now-cms",
   },
   stage: {
      worker: "al-ummah-now-cms-stage",
      envArgs: ["--env", "stage"],
      url: "https://cms.stage.alummahnow.net",
      authIssuer: "https://auth.stage.alummahnow.net",
      clientId: "d06fd65a-5b79-45bc-8bfd-a856b8502330",
      d1: { name: "al-ummah-now-cms-stage", id: "1c882ccb-d894-494d-81bf-90ec80e32d73" },
      r2: "al-ummah-now-cms-stage",
   },
   qa: {
      worker: "al-ummah-now-cms-qa",
      envArgs: ["--env", "qa"],
      url: "https://cms.qa.alummahnow.net",
      authIssuer: "https://auth.qa.alummahnow.net",
      clientId: "0e613f49-674b-490a-93e5-97a35d586da1",
      d1: { name: "al-ummah-now-cms-qa", id: "29b338a0-db34-4480-a510-16680fe67441" },
      r2: "al-ummah-now-cms-qa",
   },
};

export function parseEnv(argv: string[], allowed: EnvName[] = ["production", "stage", "qa"]): EnvName {
   const i = argv.indexOf("--env");
   const env = i >= 0 ? argv[i + 1] : undefined;
   if (!env || !allowed.includes(env as EnvName)) throw new Error(`--env ${allowed.join("|")} is required`);
   return env as EnvName;
}
