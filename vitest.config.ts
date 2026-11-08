import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
   const migrations = await readD1Migrations("./migrations");
   return {
      test: {
         projects: [
            {
               test: {
                  name: "node",
                  include: ["test/node/**/*.test.ts"],
                  environment: "node",
               },
            },
            {
               plugins: [
                  cloudflareTest({
                     wrangler: { configPath: "./wrangler.jsonc" },
                     miniflare: {
                        bindings: {
                           ENVIRONMENT: "qa",
                           PUBLIC_URL: "https://cms.test",
                           AUTH_ISSUER: "https://auth.test",
                           AUTH_CLIENT_ID: "test-client",
                           VIDEOS_API_URL: "https://videos.api.test",
                           VIDEOS_WEB_URL: "https://videos.test",
                           WWW_URL: "https://www.test",
                           WWW_ORIGINS: "https://www.test",
                           BKND_JWT_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
                           TEST_MIGRATIONS: migrations,
                        },
                     },
                  }),
               ],
               test: {
                  name: "worker",
                  include: ["test/worker/**/*.test.ts"],
                  setupFiles: ["test/worker/setup.ts"],
               },
            },
         ],
      },
   };
});
