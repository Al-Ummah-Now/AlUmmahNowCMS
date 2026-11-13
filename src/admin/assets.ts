/** Content-hashed CSS/JS for the staff screens, served by the Worker at /admin-assets/*. */
import { CLIENT_JS } from "./client.generated.ts";
import { GRAPHIC_CSS, NAV_CSS, STREET_CSS, THEME_IDS, THEMES, type ThemeId } from "./theme/vendor.generated.ts";
import { ADMIN_CSS } from "./ui/styles.ts";

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
const urls = { css: "", js: "", theme: {} as Record<ThemeId, string> };

function add(name: string, ext: "css" | "js", body: string): string {
   const path = `/admin-assets/${name}.${fnv(body)}.${ext}`;
   files.set(path, { body, type: ext === "css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
   return path;
}

// STREET_CSS: the lantern street module (draws only when the theme switches it on: Fawanees).
// NAV_CSS last: the shared header account button and menus (AlUmmahNow docs/design/NAV.md)
urls.css = add("app", "css", ADMIN_CSS + GRAPHIC_CSS + STREET_CSS + NAV_CSS);
urls.js = add("app", "js", CLIENT_JS);
for (const id of THEME_IDS) urls.theme[id] = add(`theme-${id}`, "css", THEMES[id].css);

export function assetUrls(theme: ThemeId): { css: string; js: string; theme: string } {
   return { css: urls.css, js: urls.js, theme: urls.theme[theme] };
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
