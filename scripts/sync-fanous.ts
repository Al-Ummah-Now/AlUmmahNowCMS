/**
 * Vendors the Fanous design system (AlUmmahNow `packages/fanous-tokens` and the theme materials)
 * into `src/admin/theme/vendor.generated.ts` at pinned commits, and records hashes in
 * `fanous.lock.json` (docs/ADMIN_UI_SPEC.md §5).
 *
 *   node --experimental-strip-types scripts/sync-fanous.ts [--tokens <sha>] [--materials <sha>]
 *   node --experimental-strip-types scripts/sync-fanous.ts --check     (offline: output == lock)
 *
 * The monorepo is public, so files come from raw.githubusercontent.com with no token.
 * Dark is the tokens' default; the CMS marks dark with `html.dark` (as the theme demos do), so
 * `:root, [data-fanous-theme='dark']` becomes `html.dark` and the light block `html:not(.dark)`.
 *
 * The lantern street (Fawanees; AlUmmahNow docs/design/FAWANEES-STREET.md), at the tokens commit:
 * each theme's --fanous-street-* tokens and light-only materials from the videos site's compiled
 * stylesheets (apps/web/src/theme/site-themes.css, materials.css), the street module's CSS
 * (STREET_CSS) and its script, vendored into src/admin/client/ for the client bundle.
 *
 * The header (AlUmmahNow docs/design/NAV.md "Header"), at the nav commit: the markup builders
 * (nav/header.js) and the Light/Dark toggle they import (nav/mode-toggle.js), with their types,
 * copied byte for byte into src/lib/fanous-nav/ (NAV_FILES), and the owner's logo the brand shows
 * (/brand/logo-64.webp, the videos site's art) served with the app icons. `--check` fails when any
 * vendored file differs from the hash recorded at sync time (CI runs it).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = "Al-Ummah-Now/AlUmmahNow";
const LOCK = "fanous.lock.json";
const OUT = "src/admin/theme/vendor.generated.ts";
/** The account menu's app icons (each app's own favicon, 96 px lossless WebP), served by src/lib/app-icons.ts. */
export const NAV_ICONS_OUT = "src/lib/nav-icons.generated.ts";
export const NAV_ICON_IDS = ["www", "videos", "profile", "cms", "admin", "auth-admin"] as const;
/**
 * The header controls' fonts (the themes' body fonts, AlUmmahNow docs/design/NAV.md "Theme"): the face
 * sheet (nav/aun-nav-fonts.css) and its woff2 files, served by src/lib/app-icons.ts at /aun-nav/fonts/.
 */
export const NAV_FONTS_OUT = "src/lib/nav-fonts.generated.ts";
/** The header brand's logo (nav/header.js brandHtml's default src), the same art as www's and the videos site's. */
export const BRAND_LOGO = { path: "/brand/logo-64.webp", source: "apps/web/public/brand/logo-64.webp" } as const;
/** The header's markup builders and the Light/Dark toggle, byte-identical copies of packages/fanous-tokens/nav/<name>. */
export const NAV_FILES_DIR = "src/lib/fanous-nav";
export const NAV_FILES = ["header.js", "header.d.ts", "mode-toggle.js", "mode-toggle.d.ts"] as const;
export const THEME_IDS = ["fawanees", "lantern", "zujaj", "nahas"] as const;

interface Lock {
   repo: string;
   /** nav: the shared nav contract (AlUmmahNow docs/design/NAV.md, packages/fanous-tokens/nav/aun-nav.css). */
   refs: { tokens: string; materials: string; nav: string };
   sources: Record<string, string>;
   output: string;
   /** sha256 of NAV_ICONS_OUT. */
   navIconsOutput?: string;
   /** sha256 of NAV_FONTS_OUT. */
   navFontsOutput?: string;
   /** The vendored street module files (src/admin/client/fanous-street.generated.*), by path. */
   street?: Record<string, string>;
   /** The vendored header files (NAV_FILES_DIR), byte-identical to the nav commit, by path. */
   navFiles?: Record<string, string>;
}

export const STREET_JS_OUT = "src/admin/client/fanous-street.generated.js";
export const STREET_DTS_OUT = "src/admin/client/fanous-street.generated.d.ts";
/** The street's lights are the one token value that may hold a URL: an inline SVG (data:), never a fetch. */
const LIGHTS = /^url\("data:image\/svg\+xml,[A-Za-z0-9%._~!*'()-]+"\)$/;

/** One theme's street tokens from the videos site's site-themes.css, as html:not(.dark) / html.dark blocks. */
export function streetTokens(siteThemes: string, id: string): string {
   const pick = (selector: string) => {
      const out: string[] = [];
      for (const m of siteThemes.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
         if (!m[1]!.split(",").map((x) => x.trim()).includes(selector)) continue;
         for (const d of m[2]!.matchAll(/(--fanous-street-[a-z-]+)\s*:\s*([^;]+);/g)) {
            const value = d[2]!.trim();
            if (d[1] === "--fanous-street-lights" ? !LIGHTS.test(value) : /url\(|[<>{}]|expression/i.test(value)) throw new Error(`unexpected value for ${d[1]} in ${id}: ${value.slice(0, 60)}`);
            out.push(`${d[1]}:${value}`);
         }
      }
      if (!out.some((d) => d.startsWith("--fanous-street-on:"))) throw new Error(`${id}: no --fanous-street-on for ${selector}`);
      return out.join(";");
   };
   return `html:not(.dark){${pick(`html[data-theme='${id}']:not(.dark)`)}}html.dark{${pick(`html[data-theme='${id}'].dark`)}}`;
}

/** One theme's light-only materials (theme package lightStyle) from materials.css, as html:not(.dark). */
export function lightMaterials(materials: string, id: string): string {
   const m = new RegExp(`html\\[data-theme='${id}'\\]:not\\(\\.dark\\)\\{([^{}]*)\\}`).exec(materials);
   return m ? `html:not(.dark){${m[1]}}` : "";
}

const vendorHeader = (ref: string, path: string) => `// Generated by scripts/sync-fanous.ts from ${REPO}@${ref}:${path}. Do not edit.\n`;

const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

async function get(ref: string, path: string): Promise<string> {
   const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;
   const res = await fetch(url);
   if (!res.ok) throw new Error(`${url}: ${res.status}`);
   return res.text();
}

/** Tokens CSS: shared scales stay on :root; dark is html.dark; light is html:not(.dark). */
export function rescopeTokens(css: string): string {
   const out = css
      .replace(/^\/\*[^\n]*\*\/\n/, "")
      .replace(/:root,\s*\[data-fanous-theme='dark'\]\s*\{/g, "html.dark {")
      .replace(/\[data-fanous-theme='light'\]\s*\{/g, "html:not(.dark) {");
   if (/data-fanous-theme/.test(out)) throw new Error("unexpected data-fanous-theme selector left in tokens.css");
   return out;
}

const minify = (css: string) =>
   css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s*\n\s*/g, "")
      .replace(/\s*([{};:,])\s*/g, "$1")
      .replace(/;}/g, "}")
      .trim();

async function build(refs: Lock["refs"]) {
   const sources: Record<string, string> = {};
   const themes: Record<string, { name: { en: string; ar: string }; css: string; graphic: string; backdrop: string }> = {};
   const take = async (ref: string, path: string) => {
      const text = await get(ref, path);
      sources[`${ref.slice(0, 12)}:${path}`] = sha256(text);
      return text;
   };
   const graphics = JSON.parse(await take(refs.materials, "apps/web/src/theme/demo-graphics.json")) as Record<string, string>;
   const backdrops = JSON.parse(await take(refs.materials, "apps/web/src/theme/demo-backdrops.json")) as Record<string, string>;
   const motion = await take(refs.materials, "apps/web/src/theme/demo-motion.css");
   const siteThemes = await take(refs.tokens, "apps/web/src/theme/site-themes.css");
   const lightMaterialsCss = await take(refs.tokens, "apps/web/src/theme/materials.css");
   const streetCss = await take(refs.tokens, "packages/fanous-tokens/street/fanous-street.css");
   const streetJs = await take(refs.tokens, "packages/fanous-tokens/street/fanous-street.js");
   const streetDts = await take(refs.tokens, "packages/fanous-tokens/street/fanous-street.d.ts");
   for (const id of THEME_IDS) {
      const meta = JSON.parse(await take(refs.tokens, `packages/fanous-tokens/themes/${id}/theme.json`)) as { name: { en: string; ar: string } };
      const tokens = await take(refs.tokens, `packages/fanous-tokens/generated/${id}/web/tokens.css`);
      const material = await take(refs.materials, `apps/web/src/theme/materials/${id}.css`);
      if (!graphics[id] || !backdrops[id]) throw new Error(`missing graphic or backdrop for ${id}`);
      themes[id] = {
         name: { en: meta.name.en, ar: meta.name.ar },
         css: minify(rescopeTokens(tokens)) + minify(material) + minify(lightMaterials(lightMaterialsCss, id)) + streetTokens(siteThemes, id),
         graphic: graphics[id],
         backdrop: backdrops[id],
      };
   }
   // Only the graphics' variables and motion; the demo's sign-in page layout rules are not taken.
   const graphicCss = minify(motion.split("\n").filter((l) => !/main:has|^\/\* Prototype/.test(l)).join("\n"));
   // The header account button and menus, the same in every Al Ummah Now app
   const nav = await take(refs.nav, "packages/fanous-tokens/nav/aun-nav.css");
   // Nothing is fetched or inlined from the stylesheet: the app icons are separate files (NAV_ICONS_OUT)
   if (/@import|url\(|expression/i.test(nav)) throw new Error("aun-nav.css: unexpected @import, url() or expression");
   const body =
      `// Generated by scripts/sync-fanous.ts from ${REPO} (tokens ${refs.tokens}, materials ${refs.materials}, nav ${refs.nav}). Do not edit.\n` +
      `export const NAV_CSS = ${JSON.stringify(minify(nav))};\n` +
      
      `export const THEME_IDS = ${JSON.stringify(THEME_IDS)} as const;\n` +
      `export type ThemeId = (typeof THEME_IDS)[number];\n` +
      `export interface VendoredTheme { name: { en: string; ar: string }; css: string; graphic: string; backdrop: string }\n` +
      `export const GRAPHIC_CSS = ${JSON.stringify(graphicCss)};\n` +
      `/** The lantern street module's CSS (packages/fanous-tokens/street/fanous-street.css). */\n` +
      `export const STREET_CSS = ${JSON.stringify(minify(streetCss))};\n` +
      `export const THEMES: Record<ThemeId, VendoredTheme> = ${JSON.stringify(themes, null, 1)};\n`;
   const street = {
      [STREET_JS_OUT]: vendorHeader(refs.tokens, "packages/fanous-tokens/street/fanous-street.js") + streetJs,
      [STREET_DTS_OUT]: vendorHeader(refs.tokens, "packages/fanous-tokens/street/fanous-street.d.ts") + streetDts,
   };
   return { body, sources, street };
}

/**
 * The menu's app icons as a module of path -> base64 body, the shape of APP_ICONS, so the Worker
 * (which has no static assets) serves them at /aun-nav/icons/<id>.webp. They are never inlined in
 * the stylesheet, and only the server imports this module.
 */
export async function navIconsModule(ref: string): Promise<string> {
   const rows: string[] = [];
   const webp = async (source: string, path: string) => {
      const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${source}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.subarray(0, 4).toString() !== "RIFF" || body.subarray(8, 12).toString() !== "WEBP") throw new Error(`${url}: not a WebP`);
      rows.push(`   "${path}": { type: "image/webp", body: "${body.toString("base64")}" },`);
   };
   for (const id of NAV_ICON_IDS) await webp(`packages/fanous-tokens/nav/icons/${id}.webp`, `/aun-nav/icons/${id}.webp`);
   await webp(BRAND_LOGO.source, BRAND_LOGO.path);
   return `// Generated by scripts/sync-fanous.ts from ${REPO}@${ref}:packages/fanous-tokens/nav/icons and ${BRAND_LOGO.source}. Do not edit.\n` +
      `/** The header's app icons (each app's own favicon, 96 px lossless WebP) and the brand logo: path -> type and base64 body. */\n` +
      `export const NAV_ICONS: Record<string, { type: string; body: string }> = {\n${rows.join("\n")}\n};\n`;
}

/**
 * The face sheet (minified) and the font files it names, as a module: path -> type and base64 body, the
 * shape of NAV_ICONS. Only same-origin /aun-nav/fonts/<file>.woff2 sources (CSP font-src 'self').
 */
export async function navFontsModule(ref: string): Promise<string> {
   const css = await get(ref, "packages/fanous-tokens/nav/aun-nav-fonts.css");
   if (/@import|expression/i.test(css)) throw new Error("aun-nav-fonts.css: unexpected @import or expression");
   const files = [...new Set([...css.matchAll(/url\(([^)]*)\)/g)].map((m) => {
      const u = m[1]!.replace(/^['"]|['"]$/g, "");
      if (!/^\/aun-nav\/fonts\/[a-z0-9-]+\.woff2$/.test(u)) throw new Error(`aun-nav-fonts.css: ${u} is not a /aun-nav/fonts/*.woff2 file`);
      return u;
   }))];
   const rows: string[] = [];
   for (const path of files) {
      const url = `https://raw.githubusercontent.com/${REPO}/${ref}/packages/fanous-tokens/nav/fonts/${path.slice("/aun-nav/fonts/".length)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.subarray(0, 4).toString() !== "wOF2") throw new Error(`${url}: not a woff2`);
      rows.push(`   "${path}": { type: "font/woff2", body: "${body.toString("base64")}" },`);
   }
   return `// Generated by scripts/sync-fanous.ts from ${REPO}@${ref}:packages/fanous-tokens/nav/aun-nav-fonts.css and nav/fonts. Do not edit.\n` +
      `/** The faces of the header controls' fonts (the themes' body fonts). */\n` +
      `export const NAV_FONTS_CSS = ${JSON.stringify(minify(css))};\n` +
      `/** Their files: path -> type and base64 body, served at /aun-nav/fonts/. */\n` +
      `export const NAV_FONTS: Record<string, { type: string; body: string }> = {\n${rows.join("\n")}\n};\n`;
}

async function main() {
   const args = process.argv.slice(2);
   const arg = (name: string) => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
   };
   let lock: Lock | undefined;
   try {
      lock = JSON.parse(readFileSync(LOCK, "utf8")) as Lock;
   } catch {
      lock = undefined;
   }
   if (args.includes("--check")) {
      if (!lock) throw new Error(`${LOCK} is missing`);
      const actual = sha256(readFileSync(OUT, "utf8"));
      if (actual !== lock.output || sha256(readFileSync(NAV_ICONS_OUT, "utf8")) !== lock.navIconsOutput || sha256(readFileSync(NAV_FONTS_OUT, "utf8")) !== lock.navFontsOutput) {
         console.error(`${OUT} does not match ${LOCK} (hand edit?). Run: npm run sync:fanous`);
         process.exit(1);
      }
      const navFiles = lock.navFiles ?? {};
      if (NAV_FILES.some((name) => !(`${NAV_FILES_DIR}/${name}` in navFiles))) {
         console.error(`${LOCK} has no hash for every file in ${NAV_FILES_DIR}. Run: npm run sync:fanous`);
         process.exit(1);
      }
      for (const [file, hash] of Object.entries({ ...lock.street, ...navFiles })) {
         if (sha256(readFileSync(file, "utf8")) !== hash) {
            console.error(`${file} does not match ${LOCK} (hand edit?). Run: npm run sync:fanous`);
            process.exit(1);
         }
      }
      console.log(`fanous: ${OUT} matches the lock (tokens ${lock.refs.tokens.slice(0, 8)}, materials ${lock.refs.materials.slice(0, 8)}, nav ${lock.refs.nav?.slice(0, 8)})`);
      return;
   }
   const refs = {
      tokens: arg("--tokens") ?? lock?.refs.tokens ?? "main",
      materials: arg("--materials") ?? lock?.refs.materials ?? "proto/theme-demos",
      nav: arg("--nav") ?? lock?.refs.nav ?? "main",
   };
   if (![refs.tokens, refs.materials, refs.nav].every((r) => /^[0-9a-f]{40}$/.test(r))) {
      throw new Error("pin full commit SHAs: --tokens <sha> --materials <sha> --nav <sha>");
   }
   const { body, sources, street } = await build(refs);
   writeFileSync(OUT, body);
   for (const [file, text] of Object.entries(street)) writeFileSync(file, text);
   const icons = await navIconsModule(refs.nav);
   writeFileSync(NAV_ICONS_OUT, icons);
   const fonts = await navFontsModule(refs.nav);
   writeFileSync(NAV_FONTS_OUT, fonts);
   // The header builders, byte for byte (no banner: the copy must equal the upstream file)
   mkdirSync(NAV_FILES_DIR, { recursive: true });
   const navFiles: Record<string, string> = {};
   for (const name of NAV_FILES) {
      const text = await get(refs.nav, `packages/fanous-tokens/nav/${name}`);
      writeFileSync(`${NAV_FILES_DIR}/${name}`, text);
      navFiles[`${NAV_FILES_DIR}/${name}`] = sha256(text);
   }
   const next: Lock = { repo: REPO, refs, sources, output: sha256(body), navIconsOutput: sha256(icons), navFontsOutput: sha256(fonts), street: Object.fromEntries(Object.entries(street).map(([f, t]) => [f, sha256(t)])), navFiles };
   writeFileSync(LOCK, JSON.stringify(next, null, 2) + "\n");
   console.log(`wrote ${OUT} (${body.length} bytes) and ${LOCK}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
   main().catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
   });
}
