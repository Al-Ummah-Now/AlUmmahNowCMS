/**
 * bknd CLI config — used only by `scripts/check-schema.sh` (and to generate migrations) with a
 * local SQLite file. The Worker does not read this file.
 */
import { registerMedia } from "bknd/adapter/cloudflare";
import { moduleConfig } from "./src/bknd-config.ts";

// The CLI runs in Node, where there is no R2 binding. Register a stand-in so the media module
// builds and contributes its `media` table exactly as it does in the Worker.
class R2Bucket {}
registerMedia({ MEDIA: new R2Bucket() } as never);

export default {
   connection: { url: process.env.DB_URL ?? "file:.schema-check/cms.db" },
   config: moduleConfig({ jwtSecret: "schema-check-only", secureCookie: false, publicUrl: "http://localhost:8585" }),
   options: { mode: "code", manager: { skipValidation: false } },
};
