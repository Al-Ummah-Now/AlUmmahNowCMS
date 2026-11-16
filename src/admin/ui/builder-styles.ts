/**
 * The page builder's editor chrome (src/admin/screens/blocks.tsx, src/admin/client/page-builder.ts):
 * block cards with a summary line and fold, the Style panel and its tone swatches, nested item cards,
 * the block picker with schematic thumbnails, and the full-screen workspace with its preview stage.
 * Admin tokens only (Fanous + the admin's --m-* materials), logical properties throughout (RTL).
 */
export const BUILDER_CSS = `
.blk-tt{flex:1;min-width:0;display:grid;gap:1px}
.blk-tt .blk-t{flex:none}
.blk-sum{font-size:12.5px;color:var(--fanous-color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:0}
.blk-sum:empty{display:none}
.blk-fold svg{transition:transform var(--fanous-duration-fast,120ms) ease}
.blk.folded .blk-fold svg{transform:rotate(-90deg)}
[dir=rtl] .blk.folded .blk-fold svg{transform:rotate(90deg)}
.blk.folded>.blk-b,.blk.folded>.err{display:none}
.blk.folded>.blk-h{border-block-end:0}
.blk-sel{box-shadow:inset 0 0 0 2px var(--fanous-color-focus-ring),var(--m-card-edge)}
@keyframes blk-flash{0%{box-shadow:inset 0 0 0 3px var(--fanous-color-focus-ring),0 0 0 6px color-mix(in srgb,var(--fanous-color-focus-ring) 30%,transparent)}100%{box-shadow:inset 0 0 0 2px var(--fanous-color-focus-ring),0 0 0 0 transparent}}
.blk-flash{animation:blk-flash 1.1s ease-out}
.blk-ins{display:flex;justify-content:center;margin-block:-6px -20px;position:relative;z-index:2;height:28px}
.blk-ins .btn{min-height:28px;padding:0 12px;border-radius:var(--r-pill);font-size:12.5px;background:var(--fanous-c-dialog-bg);box-shadow:0 0 0 1px var(--fanous-c-form-section-border),var(--fanous-elevation-low);opacity:0;transform:translateY(-2px);transition:opacity var(--fanous-duration-fast,120ms),transform var(--fanous-duration-fast,120ms)}
.blk:hover>.blk-ins .btn,.blk:focus-within>.blk-ins .btn,.blk-ins .btn:focus-visible{opacity:1;transform:none}
@media(hover:none){.blk-ins .btn{opacity:1;transform:none}}
.blk-list{gap:22px}
/* A narrow list (a phone, the builder's list column): the block's name gets the whole first row with its
   fold button, an "incomplete" note goes under the name, and the tools get a row of their own, so names
   read in full instead of shrinking to a few letters beside five buttons */
ol[data-k=blocks]{container-type:inline-size}
@container (max-width:520px){
ol[data-k=blocks]>.blk>.blk-h{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;column-gap:10px;row-gap:6px}
ol[data-k=blocks]>.blk>.blk-h>.grip{grid-area:1/1}
ol[data-k=blocks]>.blk>.blk-h>.blk-ic{grid-area:1/2}
ol[data-k=blocks]>.blk>.blk-h>.blk-tt{grid-area:1/3}
ol[data-k=blocks]>.blk>.blk-h>.blk-fold{grid-area:1/4}
ol[data-k=blocks]>.blk>.blk-h>.blk-warn{grid-area:2/3/3/5;justify-self:start;flex-basis:auto}
ol[data-k=blocks]>.blk>.blk-h>.blk-tools{grid-area:3/1/4/5;display:flex;justify-content:flex-end;padding-block-start:6px;border-block-start:1px solid var(--fanous-c-divider-line)}
}

/* Add a block (end of the list) */
.blk-add-main{display:flex;align-items:center;gap:14px;width:100%;margin-block-start:18px;padding:14px 16px;border:1.5px dashed color-mix(in srgb,var(--fanous-color-primary) 45%,var(--fanous-c-form-section-border));border-radius:var(--r-lg);background:color-mix(in srgb,var(--fanous-color-primary) 5%,transparent);color:inherit;font:inherit;text-align:start;cursor:pointer;transition:background var(--fanous-duration-fast,120ms),border-color var(--fanous-duration-fast,120ms)}
.blk-add-main:hover{background:color-mix(in srgb,var(--fanous-color-primary) 11%,transparent);border-color:var(--fanous-color-primary)}
.blk-add-plus{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:50%;background:var(--m-primary,var(--fanous-color-primary));color:var(--fanous-color-on-primary,#fff);box-shadow:var(--m-primary-edge,none)}
.blk-add-main>span:last-child{display:grid;gap:2px}
.blk-add-t{font-weight:700}
.blk-add-d{font-size:12.5px;color:var(--fanous-color-text-secondary);line-height:1.35}

/* Nested item cards (hero buttons, columns, cards, questions, items) */
.sub.sub-card{grid-template-columns:minmax(0,1fr);gap:10px;padding:12px;background:color-mix(in srgb,var(--fanous-color-background) 55%,var(--fanous-color-surface))}
.sub-hd{display:flex;align-items:center;gap:8px;min-width:0}
.sub-hd .sub-title{flex:1;font-size:13.5px}
.sub-hd .row-tools .btn{min-height:30px;width:30px}
.row3{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) auto;align-items:end}
.subs-cards,.subs-stats{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}
.icon-pick{display:flex;flex-wrap:wrap;gap:6px}
.icon-opt{position:relative;display:grid;place-items:center;min-width:40px;height:40px;padding:0 8px;border-radius:var(--r-md);background:var(--fanous-c-segment-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border);color:var(--fanous-color-text-secondary);font-size:12.5px;font-weight:600;cursor:pointer}
.icon-opt input{position:absolute;opacity:0;pointer-events:none}
.icon-opt .fi{width:20px;height:20px}
.icon-opt:has(input:checked){background:color-mix(in srgb,var(--fanous-color-primary) 18%,var(--fanous-color-surface));color:var(--fanous-color-primary);box-shadow:inset 0 0 0 2px var(--fanous-color-primary)}
.icon-opt:has(input:focus-visible){outline:2px solid var(--fanous-color-focus-ring);outline-offset:2px}

/* Style panel */
.blk-style{border-radius:var(--r-md);background:color-mix(in srgb,var(--fanous-color-primary) 4%,transparent);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.blk-style>summary{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;font-weight:700;font-size:14px;cursor:pointer;list-style:none}
.blk-style>summary::-webkit-details-marker{display:none}
.blk-style>summary::after{content:"";margin-inline-start:auto;width:8px;height:8px;border-inline-end:2px solid currentColor;border-block-end:2px solid currentColor;transform:rotate(45deg);opacity:.6;transition:transform var(--fanous-duration-fast,120ms)}
.blk-style[open]>summary::after{transform:rotate(-135deg)}
.blk-style-b{display:grid;gap:12px;padding:4px 12px 14px}
.tones{display:flex;flex-wrap:wrap;gap:8px}
.tone-opt{position:relative;display:grid;justify-items:center;gap:6px;min-width:64px;padding:8px 6px 6px;border-radius:var(--r-md);cursor:pointer;font-size:12.5px;font-weight:600;color:var(--fanous-color-text-secondary)}
.tone-opt input{position:absolute;opacity:0;pointer-events:none}
.tone-sw{width:44px;height:30px;border-radius:8px;box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.tone-none{background:repeating-linear-gradient(135deg,transparent 0 5px,color-mix(in srgb,var(--fanous-color-text-secondary) 22%,transparent) 5px 6px)}
.tone-soft{background:color-mix(in srgb,var(--fanous-color-primary) 9%,var(--fanous-color-background))}
.tone-raised{background:var(--fanous-color-surface);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border),0 4px 10px -4px rgb(0 0 0/.35)}
.tone-accent{background:linear-gradient(135deg,color-mix(in srgb,var(--fanous-color-primary) 24%,var(--fanous-color-surface)),color-mix(in srgb,var(--fanous-color-primary) 10%,var(--fanous-color-surface)))}
.tone-night{background:radial-gradient(120% 90% at 80% 0,color-mix(in srgb,var(--fanous-color-primary) 45%,transparent),transparent 60%),#0d1320}
.tone-opt:has(input:checked){color:var(--fanous-color-text-primary);background:color-mix(in srgb,var(--fanous-color-primary) 12%,transparent)}
.tone-opt:has(input:checked) .tone-sw{box-shadow:0 0 0 2px var(--fanous-c-dialog-bg),0 0 0 4px var(--fanous-color-primary)}
.tone-opt:has(input:focus-visible){outline:2px solid var(--fanous-color-focus-ring);outline-offset:1px}

/* Block picker */
.dlg.pk-dlg{width:min(1040px,calc(100vw - 24px))}
.pk-dlg .dlg-b{max-height:calc(100dvh - 140px)}
.pk-search{position:sticky;inset-block-start:-18px;z-index:1;display:flex;align-items:center;gap:8px;margin:-18px -20px 0;padding:14px 20px;background:var(--fanous-c-dialog-bg);border-block-end:1px solid var(--fanous-c-divider-line);color:var(--fanous-color-text-secondary)}
.pk-search .input{flex:1}
.pk-group h3{margin:6px 0 10px;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--fanous-color-text-secondary)}
[lang=ar] .pk-group h3{letter-spacing:0}
.pk-grid{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(184px,1fr))}
.pk-grid li[hidden],.pk-group[hidden]{display:none}
.pk-card{display:grid;gap:4px;align-content:start;width:100%;height:100%;padding:8px 8px 12px;border:0;border-radius:var(--r-lg);background:var(--m-card) padding-box,var(--m-border) border-box;border:1px solid transparent;box-shadow:var(--m-card-edge);color:inherit;font:inherit;text-align:start;cursor:pointer;transition:transform var(--fanous-duration-fast,120ms) ease,box-shadow var(--fanous-duration-fast,120ms) ease}
.pk-card:hover{transform:translateY(-2px);box-shadow:var(--m-card-edge),0 10px 24px -12px rgb(0 0 0/.45)}
.pk-card:focus-visible{outline:2px solid var(--fanous-color-focus-ring);outline-offset:2px}
.pk-thumb{display:block;margin-block-end:6px;border-radius:calc(var(--r-lg) - 4px);overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--fanous-color-background) 70%,var(--fanous-color-surface)),var(--fanous-color-background));box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.pk-svg{width:100%;height:auto;aspect-ratio:120/72}
.pk-t{font-weight:700;padding-inline:4px}
.pk-d{font-size:12.5px;line-height:1.35;color:var(--fanous-color-text-secondary);padding-inline:4px}
.pk-ln{fill:color-mix(in srgb,var(--fanous-color-text-secondary) 38%,transparent)}
.pk-strong{fill:color-mix(in srgb,var(--fanous-color-text-primary) 72%,transparent)}
.pk-img{fill:color-mix(in srgb,var(--fanous-color-primary) 20%,var(--fanous-color-surface))}
.pk-mtn{fill:color-mix(in srgb,var(--fanous-color-primary) 45%,var(--fanous-color-surface))}
.pk-svg .pk-box{fill:var(--fanous-color-surface);stroke:var(--fanous-c-form-section-border);stroke-width:1}
.pk-acc{fill:var(--fanous-color-primary)}
.pk-acc-soft{fill:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);stroke:color-mix(in srgb,var(--fanous-color-primary) 35%,transparent)}
.pk-soft{fill:color-mix(in srgb,var(--fanous-color-primary) 8%,transparent)}
.pk-chip{fill:color-mix(in srgb,var(--fanous-color-primary) 18%,transparent)}
.pk-night{fill:#0f1626}
.pk-glow{fill:var(--fanous-color-primary);opacity:.2}
.pk-ln-inv{fill:rgb(255 255 255/.9)}
.pk-dim{opacity:.55}
.pk-btn{fill:var(--fanous-color-primary)}
.pk-btn-o{fill:none;stroke:rgb(255 255 255/.8);stroke-width:1.2}
.pk-dash{fill:none;stroke:color-mix(in srgb,var(--fanous-color-text-secondary) 70%,transparent);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pk-play{fill:rgb(255 255 255/.94)}
.pk-play-ic{fill:var(--fanous-color-primary)}
.pk-q{fill:var(--fanous-color-primary);font:700 30px/1 Georgia,serif}

/* The workspace */
.bld .bld-bar,.bld .bld-pv{display:none}
.bld-head{align-items:center}
.bld-title{flex:1;min-width:240px}
html.bld-lock,html.bld-lock body{overflow:hidden}
.bld.bld-open{position:fixed;inset:0;z-index:80;display:grid;grid-template-rows:auto minmax(0,1fr);gap:0;margin:0;padding:0;max-width:none;border-radius:0;background:var(--fanous-color-background);box-shadow:none}
.bld-open>.bld-head{gap:10px 16px;padding:10px 16px;background:var(--m-header,var(--fanous-color-surface));box-shadow:var(--m-header-edge,0 1px 0 var(--fanous-c-divider-line));position:relative;z-index:2}
.bld-open .bld-intro,.bld-open .bld-open-row{display:none}
.bld-open .bld-title{flex:none;min-width:0}
.bld-open .bld-title h2{font-size:17px;display:flex;align-items:center;gap:8px;white-space:nowrap}
.bld-open .bld-bar{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.bld-bar .seg button{min-height:32px;padding:0 12px;font-size:13px}
.bld-sp{flex:1}
.bld-theme{display:inline-flex;align-items:center;gap:6px;color:var(--fanous-color-text-secondary)}
.bld-theme select{min-height:36px;padding-block:0;width:auto}
.bld-open .bld-main{display:grid;grid-template-columns:minmax(340px,440px) minmax(0,1fr);min-height:0}
.bld-open .bld-edit{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 16px 40px;background:color-mix(in srgb,var(--fanous-color-surface) 55%,var(--fanous-color-background));box-shadow:inset -1px 0 0 var(--fanous-c-divider-line)}
[dir=rtl] .bld-open .bld-edit{box-shadow:inset 1px 0 0 var(--fanous-c-divider-line)}
.bld-open .blk-2,.bld-open .row2,.bld-open .row3{grid-template-columns:minmax(0,1fr)}
.bld-open .bld-pv{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;background:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--fanous-color-text-secondary) 18%,transparent) 1px,transparent 0) 0 0/18px 18px,var(--fanous-color-background)}
.bld-pv-h{display:flex;align-items:center;gap:12px;padding:10px 18px 0;font-size:13px}
.bld-pv-t{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--fanous-color-text-secondary)}
.bld-pv-note:empty{display:none}
.bld-pv-note{padding:2px 10px;border-radius:var(--r-pill);background:var(--fanous-c-skeleton-bg)}
.bld-stage{min-height:0;overflow:hidden;display:grid;justify-items:center;align-items:start;padding:12px 16px 16px}
.bld-frame{direction:ltr;overflow:hidden;border-radius:12px;background:var(--fanous-color-background);box-shadow:0 0 0 1px var(--fanous-c-form-section-border),0 24px 48px -24px rgb(0 0 0/.55)}
.bld-frame[data-device=phone]{border-radius:30px;box-shadow:0 0 0 9px #0b0d12,0 0 0 10px color-mix(in srgb,var(--fanous-color-text-secondary) 40%,transparent),0 30px 60px -20px rgb(0 0 0/.6);margin-block-start:10px}
.bld-iframe{display:block;border:0;transform-origin:0 0;background:transparent}
/* Translate (src/admin/client/block-translate.ts) */
.bt-row{display:flex;justify-content:flex-end;margin-block-start:4px}
.bt-go{min-height:28px;padding:0 10px;font-size:12.5px;gap:4px}
.bt-note{margin:0;padding:8px 12px;font-size:13px}
.bt-note .bt-msg{margin:0}
.bt-note a{color:inherit;text-decoration:underline}
.bt-note[data-bt-note=mt]::before{content:"";flex:none;width:8px;height:8px;margin-block-start:6px;border-radius:50%;background:var(--fanous-color-primary)}
.bt-progress{flex-basis:100%;display:flex;align-items:center;gap:10px;font-size:13px}
.bld-open .bt-progress{color:var(--fanous-c-nav-text)}
.bt-progress[hidden]{display:none}
.bt-progress progress{flex:0 1 220px;accent-color:var(--fanous-color-primary)}
.bt-progress [data-bt-progress-text]{flex:1;min-width:0}
@media(max-width:1000px){
.bld-open .bld-main{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.1fr) minmax(0,1fr)}
.bld-open .bld-edit{box-shadow:inset 0 -1px 0 var(--fanous-c-divider-line)}
.bld-l{display:none}
.bld-open .bld-title{display:none}
}
@media(prefers-reduced-motion:reduce){.pk-card,.blk-ins .btn,.blk-fold svg{transition:none}.blk-flash{animation:none}}
`;
