/** Tiny HTML helpers for the CMS's own server-rendered pages. */
import { tabIconHtml } from "./app-icons.ts";

export function esc(value: unknown): string {
   return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

/** Shared styles: system fonts, WCAG AA contrast (text #1a1a1a on #fff = 17:1, links #0b5394 = 7.4:1). */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light;--fg:#1a1a1a;--muted:#4a4a4a;--bg:#ffffff;--panel:#f4f6f8;--border:#8a8f98;--accent:#0b5394;--accent-fg:#ffffff;--danger:#a4000f;--ok:#0b6b2b;--focus:#c25e00}
html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic","Noto Sans",sans-serif;line-height:1.5;color:var(--fg);background:var(--bg)}
body{margin:0}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.wrap{max-width:60rem;margin:0 auto;padding:1.5rem 1rem}
header.top{display:flex;gap:1rem;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding:.75rem 1rem}
header.top .brand{font-weight:700;color:var(--fg);text-decoration:none}
nav.top{display:flex;gap:1rem;flex-wrap:wrap}
h1{font-size:1.75rem;margin:.5rem 0 1rem}
.btn{display:inline-block;border:2px solid var(--accent);background:var(--accent);color:var(--accent-fg);padding:.5rem 1rem;border-radius:.375rem;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;min-height:44px}
.btn.secondary{background:var(--bg);color:var(--accent)}
.skip{position:absolute;inset-inline-start:-999px;top:0;background:var(--bg);padding:.5rem;z-index:10}
.skip:focus{inset-inline-start:.5rem}
.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

export interface PageOptions {
   lang: "en" | "ar";
   title: string;
   body: string;
   nonce: string;
   extraCss?: string;
   script?: string;
}

export function page(o: PageOptions): string {
   return `<!doctype html>
<html lang="${o.lang}" dir="${o.lang === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(o.title)}</title>
${tabIconHtml("production") /* these pages have no environment: the plain set */}
<style nonce="${o.nonce}">${BASE_CSS}${o.extraCss ?? ""}</style>
</head>
<body>
${o.body}
${o.script ? `<script nonce="${o.nonce}">${o.script}</script>` : ""}
</body>
</html>`;
}
