/**
 * The bare page under the page builder's live preview (src/admin/client/page-builder.ts): the theme's
 * page background and fonts, the page header a site shows when a page doesn't open with a hero, and
 * the outline of the block selected in the editor. The blocks themselves are styled by the shared
 * page-blocks.css (vendored), exactly as on www and the videos site.
 */
export const PREVIEW_BASE_CSS = `
html{background:var(--fanous-color-background);color-scheme:light}
html.dark{color-scheme:dark}
body{margin:0;min-height:100vh;background:var(--fanous-color-background);color:var(--fanous-color-text-primary);font-family:var(--fanous-font-latin,system-ui,-apple-system,"Segoe UI",sans-serif);-webkit-font-smoothing:antialiased}
html[lang=ar] body{font-family:var(--fanous-font-arabic,var(--fanous-font-latin,system-ui,sans-serif))}
.pv-head{padding:clamp(1.75rem,6vw,3.25rem) clamp(1rem,4vw,2rem) clamp(.5rem,2vw,1rem);max-width:46rem;margin:0 auto}
.pv-head h1{margin:0;font-size:clamp(1.9rem,5vw,2.7rem);line-height:1.15;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
html[lang=ar] .pv-head h1{letter-spacing:0;line-height:1.35}
.pv-head p{margin:.75rem 0 0;font-size:1.15rem;color:var(--fanous-color-text-secondary)}
.pv-empty{display:grid;place-items:center;min-height:60vh;padding:2rem;text-align:center;color:var(--fanous-color-text-secondary);font-size:1.05rem}
.pv-foot{height:3rem}
[data-block]{cursor:pointer;transition:outline-color 120ms ease}
[data-block]:hover{outline:1px dashed color-mix(in srgb,var(--fanous-color-focus-ring) 70%,transparent);outline-offset:-1px}
[data-block][data-pv-selected]{outline:2px solid var(--fanous-color-focus-ring);outline-offset:-2px}
a{pointer-events:none}
details summary{pointer-events:auto}
`;
