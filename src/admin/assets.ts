/** Content-hashed CSS/JS for the staff screens, served by the Worker at /admin-assets/*. */
import { CLIENT_JS } from "./client.generated.ts";
import { GRAPHIC_CSS, NAV_CSS, STREET_CSS, THEME_IDS, THEMES, type ThemeId } from "./theme/vendor.generated.ts";
import { ADMIN_CSS } from "./ui/styles.ts";
import { HEADER_GLUE_CSS } from "../lib/header.ts";
import { BUILDER_CSS } from "./ui/builder-styles.ts";
import { PAGE_BLOCKS_CSS } from "./theme/page-blocks-css.generated.ts";
import { PREVIEW_BASE_CSS } from "./ui/preview-styles.ts";

/** FNV-1a, 32-bit, hex: enough to bust caches, not a security hash. */
export function fnv(text: string): string {
   let h = 0x811c9dc5;
   for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
   }
   return (h >>> 0).toString(16).padStart(8, "0");
}

interface Asset {
   body: string;
   type: string;
}

const files = new Map<string, Asset>();
const urls = { css: "", js: "", theme: {} as Record<ThemeId, string>, preview: "" };

function add(name: string, ext: "css" | "js", body: string): string {
   const path = `/admin-assets/${name}.${fnv(body)}.${ext}`;
   files.set(path, { body, type: ext === "css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
   return path;
}

// STREET_CSS: the lantern street module (draws only when the theme switches it on: Fawanees).
// NAV_CSS last: the shared header account button and menus (AlUmmahNow docs/design/NAV.md)
urls.css = add("app", "css", ADMIN_CSS + BUILDER_CSS + GRAPHIC_CSS + STREET_CSS + NAV_CSS + HEADER_GLUE_CSS);
urls.js = add("app", "js", CLIENT_JS);
for (const id of THEME_IDS) urls.theme[id] = add(`theme-${id}`, "css", THEMES[id].css);
// The page builder's live preview frame: the shared block styles (vendored from the monorepo, the
// same file www and the videos site use) on a bare page in the chosen theme.
urls.preview = add("page-preview", "css", PREVIEW_BASE_CSS + PAGE_BLOCKS_CSS);

export function assetUrls(theme: ThemeId): { css: string; js: string; theme: string } {
   return { css: urls.css, js: urls.js, theme: urls.theme[theme] };
}

/** What the page builder's preview frame loads: every theme (preview only) and the block styles. */
export function previewAssets(): { themes: Record<ThemeId, string>; css: string } {
   return { themes: { ...urls.theme }, css: urls.preview };
}

export function assetResponse(path: string): Response | undefined {
   const f = files.get(path);
   if (!f) return undefined;
   return new Response(f.body, {
      headers: {
         "content-type": f.type,
         "cache-control": "public, max-age=31536000, immutable",
         "x-content-type-options": "nosniff",
      },
   });
}
