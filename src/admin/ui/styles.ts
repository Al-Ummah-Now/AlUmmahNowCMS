/**
 * The CMS component system. Structure is shared; depth comes from the active theme's material
 * (`--m-*`, vendored from the theme demos) and colours from fanous part tokens (`--fanous-c-*`).
 * No rule names a theme. Logical properties only (RTL). Dark = `html.dark`.
 */
export const ADMIN_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{background:var(--fanous-color-background);--rail:84px;--rail-wide:248px;--hd:64px;--gap:var(--fanous-spacing-lg);color-scheme:light;font-family:var(--fanous-font-latin);-webkit-text-size-adjust:100%;text-size-adjust:100%}
html.dark{color-scheme:dark}
html.dark .mode-to-dark,html:not(.dark) .mode-to-light{display:none}
html[lang=ar]{font-family:var(--fanous-font-arabic)}
body{margin:0;min-height:100dvh;background:var(--m-page);background-attachment:fixed;color:var(--fanous-color-text-primary);font-size:var(--fanous-type-latin-body-size);line-height:var(--fanous-type-latin-body-line-height)}
html[lang=ar] body{font-size:var(--fanous-type-arabic-body-size);line-height:var(--fanous-type-arabic-body-line-height)}
img,svg{display:block;max-width:100%}
a{color:var(--fanous-c-link-text);text-underline-offset:.2em}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--fanous-color-focus-ring);outline-offset:2px}
[hidden]{display:none!important}
.vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:fixed;inset-block-start:8px;inset-inline-start:-999px;z-index:100;padding:10px 16px;border-radius:var(--r-md);background:var(--fanous-c-dialog-bg);color:var(--fanous-c-dialog-text);box-shadow:var(--fanous-elevation-medium)}
.skip:focus{inset-inline-start:8px}
.icon{flex:none}
[dir=rtl] .flip{transform:scaleX(-1)}

/* Atmosphere: the theme's silhouettes, faint, behind everything. */
.theme-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;--art:var(--fanous-color-motif);--lit:var(--fanous-color-primary);--bgc:var(--fanous-color-background)}
.theme-bg .ti{position:absolute;opacity:var(--o,.08)}html.dark .theme-bg .ti{--o:.07}
.theme-bg .ti-end{inset-block-end:0;inset-inline-end:2vw;height:min(54vh,520px);width:auto}
.theme-bg .ti-start{inset-block-start:17vh;inset-inline-start:calc(var(--rail) + 2vw);height:min(24vh,220px);width:auto}
.theme-bg .ti-left{inset-block-end:0;left:0;height:min(84vh,840px);width:auto}.theme-bg .ti-right{inset-block-end:0;right:0;height:min(84vh,840px);width:auto}
.theme-bg .ti-second{height:min(58vh,560px)}.theme-bg .ti-left.ti-second{left:clamp(90px,12vw,200px)}.theme-bg .ti-right.ti-second{right:clamp(90px,12vw,200px)}
.theme-bg :is(.ti-top,.ti-lattice,.ti-dome){display:none}
[dir=rtl] .theme-bg .ti-flip{transform:scaleX(-1)}
@media(max-width:900px){.theme-bg{display:none}}
.shell{position:relative;z-index:1}

/* Header */
.hd{position:sticky;inset-block-start:0;z-index:40;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,560px) minmax(0,1fr);align-items:center;gap:var(--gap);height:var(--hd);padding-inline:var(--fanous-spacing-md);background:var(--m-header);box-shadow:var(--m-header-edge);color:var(--fanous-c-nav-text);-webkit-backdrop-filter:var(--m-blur);backdrop-filter:var(--m-blur)}
.hd-start,.hd-end{display:flex;align-items:center;gap:var(--fanous-spacing-sm);min-width:0}.hd-end{justify-content:flex-end}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 4px 4px;border-radius:var(--r-md);color:var(--fanous-c-nav-text);text-decoration:none;white-space:nowrap}
.brand-mark{width:36px;height:36px;border-radius:50%;flex:none;object-fit:cover}
.brand-name{font-weight:700;font-size:17px;line-height:1.1}.brand-sub{display:block;font-size:12px;font-weight:500;color:var(--fanous-c-nav-icon);letter-spacing:.02em}
.ic{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;border-radius:var(--r-pill);background:transparent;color:var(--fanous-c-nav-icon);cursor:pointer;text-decoration:none;transition:background-color var(--fanous-duration-fast),color var(--fanous-duration-fast)}
@media(hover:hover){.ic:hover{background:var(--fanous-c-nav-hover);color:var(--fanous-c-nav-text)}}
.search{display:flex;align-items:stretch;height:44px;border-radius:var(--r-pill);background:var(--fanous-c-nav-search-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-nav-search-border);overflow:hidden}
.search:focus-within{box-shadow:inset 0 0 0 2px var(--fanous-c-upload-focus)}
.search input{flex:1;min-width:0;padding-inline:var(--fanous-spacing-lg);border:0;outline:0;background:transparent;color:var(--fanous-c-nav-search-text)}
.search input::placeholder{color:var(--fanous-c-nav-search-placeholder)}
.search button{width:52px;display:grid;place-items:center;border:0;background:transparent;color:var(--fanous-c-nav-icon);cursor:pointer;border-inline-start:1px solid var(--fanous-c-nav-search-border)}
@media(hover:hover){.search button:hover{background:var(--fanous-c-nav-hover)}}
.avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--fanous-color-surface-raised);color:var(--fanous-color-text-primary);font-weight:700;font-size:14px;box-shadow:0 0 0 1.5px var(--fanous-c-nav-indicator)}
@media(max-width:900px){.hd{grid-template-columns:auto 1fr auto}.hd .search,.hd .ac{display:none}.brand-sub{display:none}}
@media(max-width:480px){.hd .brand-name{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.hd summary.btn span{display:none}.hd summary.btn{width:44px;padding:0}}

/* Menus (details/summary popovers); the panels are the shared .aun-menu (NAV_CSS) */
.pop{position:relative}
.pop>summary{list-style:none;cursor:pointer}.pop>summary::-webkit-details-marker{display:none}

/* Rail (wide), drawer and bottom bar (phone) */
.layout{display:grid;grid-template-columns:var(--rail) minmax(0,1fr);min-height:calc(100dvh - var(--hd))}
@media(min-width:1400px){.layout{grid-template-columns:var(--rail-wide) minmax(0,1fr)}}
.rail{position:sticky;inset-block-start:var(--hd);height:calc(100dvh - var(--hd));display:flex;flex-direction:column;gap:2px;padding:10px 6px;background:var(--m-rail);box-shadow:var(--m-rail-edge);overflow-y:auto}
[dir=rtl] .rail{box-shadow:none;border-inline-end:1px solid color-mix(in srgb,var(--fanous-color-primary) 30%,transparent)}
.rail-group{margin:12px 8px 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fanous-color-text-muted);display:none}
html[lang=ar] .rail-group{letter-spacing:0;font-size:12px}
.ri{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-height:60px;padding:8px 4px;border-radius:var(--r-lg);color:var(--fanous-c-drawer-text);text-decoration:none;font-size:12px;font-weight:500;text-align:center;line-height:1.2;transition:background-color var(--fanous-duration-fast)}
.ri .icon{width:22px;height:22px}
@media(hover:hover){.ri:hover{background:var(--m-hover);color:var(--fanous-color-text-primary)}}
.ri[aria-current=page]{background:var(--m-sel);box-shadow:var(--m-sel-edge);color:var(--fanous-color-text-primary);font-weight:700}
.ri[aria-current=page]::before{content:"";position:absolute;inset-block:12px;inset-inline-start:-6px;width:3px;border-radius:3px;background:var(--m-sel-bar);box-shadow:var(--m-sel-glow)}
.ri[aria-current=page] .icon{stroke-width:2.25}
.rail-sep{height:1px;margin:8px 10px;background:var(--fanous-c-divider-line)}
.rail-foot .ic{color:var(--fanous-c-drawer-icon)}@media(hover:hover){.rail-foot .ic:hover{background:var(--m-hover);color:var(--fanous-color-text-primary)}}
.rail-foot{margin-block-start:auto;display:flex;flex-direction:column;align-items:center;gap:4px;padding-block-start:8px;border-block-start:1px solid var(--fanous-c-divider-line)}
@media(min-width:1400px){
.rail{padding-inline:12px}.rail-group{display:block}
.ri{flex-direction:row;justify-content:flex-start;gap:14px;min-height:46px;padding-inline:14px;font-size:15px;text-align:start}
.ri[aria-current=page]::before{inset-inline-start:-12px}
.rail-sep{display:none}.rail-foot{flex-direction:row;justify-content:flex-start}
}
.bar{display:none}
@media(max-width:760px){
.layout{grid-template-columns:minmax(0,1fr)}.rail{display:none}
.bar{position:fixed;inset-inline:0;inset-block-end:0;z-index:40;display:grid;grid-template-columns:repeat(5,1fr);padding-block-end:env(safe-area-inset-bottom);background:var(--m-header);box-shadow:0 -1px 0 color-mix(in srgb,var(--fanous-color-primary) 40%,transparent);-webkit-backdrop-filter:var(--m-blur);backdrop-filter:var(--m-blur)}
.bar .ri{min-height:58px;border-radius:0;font-size:11px;color:var(--fanous-c-nav-icon)}.bar .ri[aria-current=page]{color:var(--fanous-c-nav-active-text);background:var(--fanous-c-nav-active-bg)}
.bar .ri[aria-current=page]::before{inset-block:auto 0;inset-inline:25%;width:auto;height:3px}
body{padding-block-end:64px}
}
@media(min-width:761px){.only-phone{display:none!important}}
.drawer{position:fixed;inset-block:0;inset-inline-start:0;margin:0;width:min(320px,86vw);max-width:none;height:100dvh;max-height:none;padding:0;border:0;background:var(--fanous-c-drawer-bg);color:var(--fanous-c-drawer-text);box-shadow:var(--fanous-elevation-high)}
.drawer::backdrop{background:rgb(0 0 0/.5)}
.drawer-in{display:flex;flex-direction:column;gap:2px;height:100%;padding:12px;overflow-y:auto}
.drawer .ri{flex-direction:row;justify-content:flex-start;gap:14px;min-height:48px;padding-inline:14px;font-size:16px;color:var(--fanous-c-drawer-text)}
.drawer .ri[aria-current=page]{background:var(--fanous-c-drawer-active-bg);color:var(--fanous-c-drawer-active-text)}
.drawer .ri[aria-current=page]::before{inset-inline-start:0}
.drawer .rail-group{display:block}
.drawer-top{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 12px;border-block-end:1px solid var(--fanous-c-drawer-divider);margin-block-end:8px}

/* Main area */
main{min-width:0;padding:clamp(16px,3vw,32px) clamp(16px,3.2vw,40px) 48px}
.wrap{max-width:1180px;margin-inline:auto}
.ph{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-block-end:24px}
.ph h1{margin:0;font-size:var(--fanous-type-latin-display-size);line-height:var(--fanous-type-latin-display-line-height);letter-spacing:var(--fanous-type-latin-display-letter-spacing);font-weight:700}
html[lang=ar] .ph h1{font-size:var(--fanous-type-arabic-display-size);line-height:var(--fanous-type-arabic-display-line-height);letter-spacing:0}
.ph p{margin:6px 0 0;color:var(--fanous-color-text-secondary);max-width:62ch}
.ph-actions{display:flex;flex-wrap:wrap;gap:10px}
.crumb{display:inline-flex;align-items:center;gap:4px;margin-block-end:8px;color:var(--fanous-color-text-secondary);text-decoration:none;font-weight:600;font-size:14px;min-height:32px}
h2{font-size:var(--fanous-type-latin-title-size);line-height:var(--fanous-type-latin-title-line-height);margin:0 0 12px}
html[lang=ar] h2{font-size:var(--fanous-type-arabic-title-size);line-height:var(--fanous-type-arabic-title-line-height)}
.muted{color:var(--fanous-color-text-muted)}
.sec-h{display:flex;align-items:center;gap:12px;margin:32px 0 14px}
.sec-h h2{margin:0}
.sec-h::after{content:"";flex:1;height:1px;background:linear-gradient(var(--to-end,to right),color-mix(in srgb,var(--fanous-color-primary) 60%,transparent),transparent)}
[dir=rtl] .sec-h::after{background:linear-gradient(to left,color-mix(in srgb,var(--fanous-color-primary) 60%,transparent),transparent)}

/* Surfaces: a material fill inside a gilded / glass / embossed edge */
.card{position:relative;border:1px solid transparent;border-radius:var(--r-xl);background:var(--m-card) padding-box,var(--m-border) border-box;box-shadow:var(--m-card-edge);padding:clamp(16px,2.4vw,24px)}
.card.flat{background:var(--fanous-c-form-section-bg);border-color:var(--fanous-c-form-section-border);box-shadow:none}
.raised{background:var(--m-raised);box-shadow:var(--m-raised-edge);border-radius:var(--r-xl)}
.hero{position:relative;overflow:hidden;border-radius:var(--r-xl);background:var(--m-hero);box-shadow:var(--m-card-edge),inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 30%,transparent);display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:center;min-height:220px}
.hero-copy{padding:clamp(20px,3vw,36px)}
.hero-copy h1{margin:0 0 8px;font-size:var(--fanous-type-latin-display-size);line-height:1.15}
html[lang=ar] .hero-copy h1{font-size:var(--fanous-type-arabic-display-size);line-height:1.4}
.hero-copy p{margin:0;color:var(--fanous-color-text-secondary);max-width:52ch}
.hero-art{align-self:stretch;display:flex;align-items:flex-end;justify-content:center;min-height:180px;-webkit-mask-image:linear-gradient(to right,transparent,#000 22%);mask-image:linear-gradient(to right,transparent,#000 22%)}[dir=rtl] .hero-art{-webkit-mask-image:linear-gradient(to left,transparent,#000 22%);mask-image:linear-gradient(to left,transparent,#000 22%)}
.hero-art svg{width:100%;max-width:420px;height:auto}
@media(max-width:760px){.hero{grid-template-columns:1fr}.hero-art{min-height:0;max-height:180px;order:-1;overflow:hidden}}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.stat{display:flex;flex-direction:column;gap:10px;text-decoration:none;color:inherit;transition:transform var(--fanous-duration-fast) var(--fanous-easing-standard)}
@media(hover:hover){a.stat:hover{transform:translateY(-2px)}}
.stat-top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600}
.stat-ic{width:40px;height:40px;border-radius:var(--r-md);display:grid;place-items:center;background:color-mix(in srgb,var(--fanous-color-primary) 18%,transparent);color:var(--fanous-color-text-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 40%,transparent)}
.stat-nums{display:flex;gap:18px;align-items:baseline}
.stat-n{font-size:30px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.stat-l{font-size:13px;color:var(--fanous-color-text-secondary)}

/* Buttons */
.btn{--b-bg:var(--fanous-c-button-secondary-bg);--b-fg:var(--fanous-c-button-secondary-text);--b-bd:var(--fanous-c-button-secondary-border);display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border:1px solid var(--b-bd);border-radius:var(--r-pill);background:var(--b-bg);color:var(--b-fg);font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;transition:background var(--fanous-duration-fast),box-shadow var(--fanous-duration-fast),transform var(--fanous-duration-fast)}
@media(hover:hover){.btn:hover{--b-bg:var(--fanous-c-button-secondary-hover)}}
.btn:active{transform:translateY(1px)}
.btn.primary{border:0;background:var(--m-primary);color:var(--fanous-c-button-primary-text);box-shadow:var(--m-primary-edge)}
@media(hover:hover){.btn.primary:hover{background:var(--m-primary-hover)}}
.btn.primary:active{background:var(--m-primary-press)}
.btn.ghost{--b-bg:var(--fanous-c-button-ghost-bg);--b-fg:var(--fanous-c-button-ghost-text);--b-bd:var(--fanous-c-button-ghost-border)}
@media(hover:hover){.btn.ghost:hover{--b-bg:var(--fanous-c-button-ghost-hover)}}
.btn.danger{--b-bg:var(--fanous-c-button-destructive-bg);--b-fg:var(--fanous-c-button-destructive-text);--b-bd:var(--fanous-c-button-destructive-border)}
@media(hover:hover){.btn.danger:hover{--b-bg:var(--fanous-c-button-destructive-hover)}}
.btn[disabled],.btn[aria-disabled=true]{cursor:not-allowed;opacity:.6;transform:none}
.btn.sm{min-height:36px;padding:0 12px;font-size:14px}
.btn.icon-only{width:44px;padding:0}
.btn.sm.icon-only{width:36px}

/* Forms */
.field{display:grid;gap:6px;min-width:0}
.field>label,.label{font-weight:600;color:var(--fanous-c-form-label);font-size:var(--fanous-type-latin-label-size)}
html[lang=ar] .field>label,html[lang=ar] .label{font-size:var(--fanous-type-arabic-label-size)}
.help{margin:0;font-size:13px;color:var(--fanous-c-form-help)}
.err{margin:0;font-size:13px;font-weight:600;color:var(--fanous-c-form-error)}
.input,.select,.textarea{width:100%;min-height:44px;padding:10px 14px;border:1px solid var(--fanous-c-form-input-border);border-radius:var(--r-md);background:var(--fanous-c-form-input-bg);color:var(--fanous-c-form-input-text);box-shadow:var(--m-control-edge);transition:box-shadow var(--fanous-duration-fast),border-color var(--fanous-duration-fast)}
.input::placeholder,.textarea::placeholder{color:var(--fanous-c-form-placeholder)}
.input:focus,.select:focus,.textarea:focus{outline:0;border-color:var(--fanous-c-form-focus-ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--fanous-c-form-focus-ring) 45%,transparent)}
.input[aria-invalid=true],.textarea[aria-invalid=true]{border-color:var(--fanous-c-form-error)}
.textarea{min-height:120px;resize:vertical;line-height:1.6}
.textarea.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;min-height:360px}
.select{appearance:none;padding-inline-end:40px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 20px) 50%,calc(100% - 15px) 50%;background-size:5px 5px;background-repeat:no-repeat}
[dir=rtl] .select{background-position:20px 50%,15px 50%}
.row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.stack{display:grid;gap:18px}
.switch{display:inline-flex;align-items:center;gap:12px;min-height:44px;cursor:pointer;font-weight:600}
.switch input{appearance:none;position:relative;width:44px;height:26px;margin:0;border-radius:13px;background:var(--fanous-c-form-switch-off);cursor:pointer;transition:background var(--fanous-duration-fast);flex:none}
.switch input::after{content:"";position:absolute;inset-block-start:3px;inset-inline-start:3px;width:20px;height:20px;border-radius:50%;background:var(--fanous-c-form-switch-thumb);box-shadow:0 1px 3px rgb(0 0 0/.3);transition:inset-inline-start var(--fanous-duration-fast) var(--fanous-easing-standard)}
.switch input:checked{background:var(--fanous-c-form-switch-on)}
.switch input:checked::after{inset-inline-start:21px}
.seg{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:var(--r-pill);background:var(--fanous-c-segment-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.seg a,.seg button,.seg label{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:var(--r-pill);background:transparent;color:var(--fanous-c-segment-text);font-weight:600;font-size:14px;text-decoration:none;cursor:pointer}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg [aria-current=true],.seg [aria-pressed=true],.seg [aria-selected=true],.seg label:has(input:checked){background:var(--fanous-c-segment-active-bg);color:var(--fanous-c-segment-active-text);box-shadow:var(--fanous-elevation-low)}
.seg label:has(input:focus-visible){outline:2px solid var(--fanous-color-focus-ring);outline-offset:1px}

/* Badges and chips */
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:var(--r-pill);font-size:12px;font-weight:700;line-height:20px;white-space:nowrap}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.badge.published{background:var(--fanous-c-badge-status-bg);color:var(--fanous-c-badge-status-text)}
.badge.draft{background:transparent;color:var(--fanous-color-text-secondary);box-shadow:inset 0 0 0 1px var(--fanous-color-outline)}
.badge.loc{background:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);color:var(--fanous-color-text-primary)}
.badge.loc::before{display:none}
/* Scheduled: a hollow dot (not yet live) on a lit primary tint, so it reads apart from both. */
.badge.scheduled{background:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);color:var(--fanous-color-text-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 60%,transparent)}
.badge.scheduled::before{background:transparent;box-shadow:inset 0 0 0 2px currentColor}
.when{display:inline-flex;align-items:center;gap:4px;font-weight:600;color:var(--fanous-color-text-primary)}
.h-ic{display:inline-block;vertical-align:-3px;margin-inline-end:4px;color:var(--fanous-color-text-secondary)}
.chips{display:flex;flex-wrap:wrap;gap:8px}

/* Lists */
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-block-end:16px}
/* Search suggestions (ui/autocomplete.tsx, client/autocomplete.ts) */
.ac{position:relative;min-width:0}
.toolbar .ac{flex:1 1 260px;max-width:420px}.toolbar .ac .search{max-width:none}
.ac-list{position:absolute;inset-block-start:calc(100% + 6px);inset-inline-start:0;z-index:60;width:100%;min-width:min(320px,90vw);max-height:min(60vh,420px);overflow:auto;margin:0;padding:6px;list-style:none;border-radius:var(--r-lg);background:var(--fanous-c-menu-bg);color:var(--fanous-c-menu-text);box-shadow:0 0 0 1px var(--fanous-c-menu-border),var(--fanous-elevation-high)}
.ac-list[hidden]{display:none}
.ac-opt{display:flex;align-items:center;gap:12px;min-height:44px;padding:6px 10px;border-radius:var(--r-md);cursor:pointer}
.ac-opt[aria-selected=true]{background:var(--fanous-c-menu-hover);box-shadow:inset 0 0 0 2px var(--fanous-c-upload-focus)}
.ac-img{width:36px;height:36px;flex:none;border-radius:var(--r-md);object-fit:cover;background:var(--fanous-c-skeleton-bg)}
.ac-ph{display:grid;place-items:center;font-weight:600;color:var(--fanous-c-menu-muted)}
.ac-text{display:flex;flex-direction:column;min-width:0}
.ac-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac-sub{font-size:13px;color:var(--fanous-c-menu-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac-note{padding:10px;color:var(--fanous-c-menu-muted)}
.toolbar .search{flex:1 1 260px;max-width:420px;background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)}
.toolbar .search input{color:var(--fanous-c-form-input-text)}
.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;border-radius:var(--r-lg);background:var(--m-card);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 18%,transparent);color:inherit;text-decoration:none;transition:box-shadow var(--fanous-duration-fast),transform var(--fanous-duration-fast)}
@media(hover:hover){a.li:hover,.li:has(a.li-main:hover){box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 55%,transparent),var(--m-card-edge)}}
.li-thumb{width:96px;aspect-ratio:16/9;border-radius:var(--r-md);object-fit:cover;background:var(--fanous-c-skeleton-bg);display:grid;place-items:center;color:var(--fanous-color-text-muted);overflow:hidden}
.li-body{min-width:0}
.li-title{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fanous-color-text-primary);text-decoration:none}
a.li-title:hover{text-decoration:underline}
.li-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-block-start:4px;font-size:13px;color:var(--fanous-color-text-secondary)}
.li-end{display:flex;align-items:center;gap:8px}
@media(max-width:600px){.li{grid-template-columns:minmax(0,1fr) auto}.li-thumb{display:none}}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block-start:18px}

/* Empty state */
.empty{display:grid;justify-items:center;gap:8px;padding:40px 20px;text-align:center;border-radius:var(--r-xl);border:1.5px dashed color-mix(in srgb,var(--fanous-color-primary) 45%,transparent);background:color-mix(in srgb,var(--fanous-color-surface) 60%,transparent)}
.empty>.icon{width:40px;height:40px;color:var(--fanous-c-empty-icon)}
.empty strong{font-size:18px;color:var(--fanous-c-empty-title)}
.empty p{margin:0;color:var(--fanous-c-empty-body);max-width:46ch}

/* Grids */
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
@media(max-width:1100px){.split{grid-template-columns:minmax(0,1fr)}}
.sticky{position:sticky;inset-block-start:calc(var(--hd) + 16px)}

/* Theme card */
.swatches{display:flex;gap:8px;margin-block:12px}
.sw{width:34px;height:34px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(255 255 255/.2),0 1px 3px rgb(0 0 0/.3)}
.theme-graphic{border-radius:var(--r-lg);overflow:hidden;background:var(--fanous-color-surface);--primary:var(--fanous-color-primary);--on-primary:var(--fanous-color-on-primary);--primary-hover:var(--fanous-color-primary-hover);--primary-pressed:var(--fanous-color-primary-pressed);--primary-edge:var(--fanous-color-primary-edge);--primary-sheen:var(--fanous-color-primary-sheen);--surface:var(--fanous-color-surface);--surface-raised:var(--fanous-color-surface-raised);--hero-start:var(--fanous-color-hero-start);--text-primary:var(--fanous-color-text-primary);--text-secondary:var(--fanous-color-text-secondary);--motif:var(--fanous-color-motif);--focus-ring:var(--fanous-color-focus-ring);--accent:var(--fanous-color-accent)}
.theme-graphic svg{width:100%;height:auto}

/* Dialog, toast */
dialog.dlg{width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 48px);padding:0;border:0;border-radius:var(--r-xl);background:var(--fanous-c-dialog-bg);color:var(--fanous-c-dialog-text);box-shadow:0 0 0 1px var(--fanous-c-dialog-border),var(--fanous-elevation-high)}
dialog.dlg.sm{width:min(440px,calc(100vw - 32px))}
dialog.dlg::backdrop{background:rgb(4 8 12/.6);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.dlg-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 12px;border-block-end:1px solid var(--fanous-c-divider-line)}
.dlg-h h2{margin:0}
.dlg-b{padding:18px 20px;overflow-y:auto;max-height:calc(100dvh - 200px)}
.dlg-f{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;padding:12px 20px 18px}
.toasts{position:fixed;inset-block-end:24px;inset-inline-end:24px;z-index:90;display:grid;gap:8px}
@media(max-width:760px){.toasts{inset-block-end:84px;inset-inline:16px}}
.toast{display:flex;align-items:center;gap:10px;min-width:240px;padding:12px 16px;border-radius:var(--r-lg);background:var(--fanous-c-toast-bg);color:var(--fanous-c-toast-text);box-shadow:0 0 0 1px var(--fanous-c-toast-border),var(--fanous-elevation-medium);font-weight:600;animation:toast-in var(--fanous-duration-standard) var(--fanous-easing-enter)}
.toast.ok .icon{color:var(--fanous-c-toast-success)}.toast.bad .icon{color:var(--fanous-c-toast-error)}
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}}
.notice{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--r-md);background:color-mix(in srgb,var(--fanous-color-primary) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 40%,transparent)}
.notice.bad{background:color-mix(in srgb,var(--fanous-color-error-fill) 14%,transparent);box-shadow:inset 0 0 0 1px var(--fanous-c-form-error)}
.preview-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;padding:6px 12px;background:var(--m-primary);color:var(--fanous-c-button-primary-text);font-size:14px;font-weight:600}
.preview-bar a{color:inherit}

/* Editor */
.md-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:6px;border-radius:var(--r-md) var(--r-md) 0 0;background:color-mix(in srgb,var(--fanous-color-surface) 70%,transparent);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)}
.md-tools{display:flex;flex-wrap:wrap;align-items:center;gap:2px}.md-tools .btn.ghost{--b-bg:transparent;--b-bd:transparent;--b-fg:var(--fanous-color-text-secondary)}@media(hover:hover){.md-tools .btn.ghost:hover{--b-bg:var(--m-hover);--b-fg:var(--fanous-color-text-primary)}}
[data-md] .textarea.code{border-start-start-radius:0;border-start-end-radius:0;margin-top:-1px}
.md-preview{min-height:360px;overflow-wrap:anywhere;line-height:1.7;border-start-start-radius:0;border-start-end-radius:0}
.md-preview h2,.md-preview h3{margin:1em 0 .4em}.md-preview p{margin:0 0 1em}.md-preview blockquote{margin:0 0 1em;padding-inline-start:14px;border-inline-start:3px solid var(--fanous-color-primary);color:var(--fanous-color-text-secondary)}
.md-link{color:var(--fanous-c-link-text);text-decoration:underline}
.md-video{display:flex;align-items:center;gap:10px;margin:0 0 1em;padding:12px;border-radius:var(--r-md);background:var(--m-card);box-shadow:var(--m-thumb-edge);font-weight:600}
.tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;min-height:44px;height:auto}
.tags:focus-within{border-color:var(--fanous-c-form-focus-ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--fanous-c-form-focus-ring) 45%,transparent)}
.tags input{flex:1;min-width:120px;min-height:30px;border:0;outline:0;background:transparent;color:var(--fanous-c-form-input-text)}
.tag{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;border-radius:var(--r-pill);background:color-mix(in srgb,var(--fanous-color-primary) 20%,transparent);font-size:14px;font-weight:600}
[dir=rtl] .tag{padding:2px 10px 2px 4px}
.tag button{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}
.tag button:hover{background:var(--m-hover)}
.serp{display:grid;gap:2px;padding:14px 16px;border-radius:var(--r-md);background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.serp-url{font-size:13px;color:var(--fanous-color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.serp-title{font-size:19px;color:var(--fanous-color-link);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.serp-desc{font-size:14px;color:var(--fanous-color-text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px}
.meta-dl dt{color:var(--fanous-color-text-muted)}.meta-dl dd{margin:0;text-align:end}
.pub-actions{display:grid;gap:8px}
.actbar{display:none}
@media(max-width:1100px){.actbar{position:sticky;inset-block-end:0;z-index:30;display:flex;gap:8px;margin:0 calc(-1*clamp(16px,3.2vw,40px));padding:10px clamp(16px,3.2vw,40px);background:var(--m-header);box-shadow:0 -1px 0 color-mix(in srgb,var(--fanous-color-primary) 40%,transparent)}.actbar .btn{flex:1}}
@media(max-width:760px){.actbar{inset-block-end:58px}}
.drop{display:grid;justify-items:center;gap:6px;padding:22px 14px;border-radius:var(--r-lg);border:1.5px dashed color-mix(in srgb,var(--fanous-color-primary) 70%,transparent);background:color-mix(in srgb,var(--fanous-color-primary) 9%,transparent);color:var(--fanous-color-text-primary);text-align:center;font-weight:600;cursor:pointer;transition:background var(--fanous-duration-fast)}
.drop .icon{color:var(--fanous-color-text-secondary)}
.drop:hover,.drop.over{background:color-mix(in srgb,var(--fanous-color-primary) 18%,transparent)}
.drop:focus-within{outline:2px solid var(--fanous-c-upload-focus);outline-offset:2px}
.drop[aria-busy=true]{opacity:.7;cursor:progress}
.cover-img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-lg);box-shadow:var(--m-thumb-edge)}

/* Scheduling (#7): the go-live callout and the "publish later" disclosure in the publish panel. */
.sched{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;align-items:center;padding:14px;border-radius:var(--r-lg);background:linear-gradient(var(--to-end,to right),color-mix(in srgb,var(--fanous-color-primary) 22%,transparent),color-mix(in srgb,var(--fanous-color-primary) 6%,transparent));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 50%,transparent)}
[dir=rtl] .sched{--to-end:to left}
.sched-ic{grid-row:span 2;width:44px;height:44px;border-radius:var(--r-md);display:grid;place-items:center;background:var(--m-primary);color:var(--fanous-c-button-primary-text);box-shadow:var(--m-primary-edge)}
.sched-l{font-size:13px;font-weight:600;color:var(--fanous-color-text-secondary)}
.sched-t{font-weight:700;font-size:16px;line-height:1.35;font-variant-numeric:tabular-nums}
.sched-note{grid-column:1/-1;margin:10px 0 0;font-size:13px;color:var(--fanous-color-text-secondary)}
details.later{border-radius:var(--r-lg);background:var(--fanous-c-form-section-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
details.later>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:var(--r-lg);font-weight:600;cursor:pointer;list-style:none}
details.later>summary::-webkit-details-marker{display:none}
details.later>summary::after{content:"";margin-inline-start:auto;width:8px;height:8px;border-inline-end:2px solid currentColor;border-block-end:2px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform var(--fanous-duration-fast) var(--fanous-easing-standard)}
details.later[open]>summary::after{transform:translateY(2px) rotate(-135deg)}
details.later>summary:focus-visible{outline:2px solid var(--fanous-color-focus-ring);outline-offset:2px}
@media(hover:hover){details.later>summary:hover{background:var(--m-hover)}}
.later-b{display:grid;gap:12px;padding:4px 14px 14px}
.later-b input[type=datetime-local]{direction:ltr;text-align:start}
[dir=rtl] .later-b input[type=datetime-local]{text-align:end}

/* Content history (#8): version list (numbered medallions), field changes, line diff. */
.revs{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.rev{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start;padding:10px 12px;border-radius:var(--r-lg);color:inherit;text-decoration:none;box-shadow:inset 0 0 0 1px transparent;transition:background var(--fanous-duration-fast),box-shadow var(--fanous-duration-fast)}
@media(hover:hover){.rev:hover{background:var(--m-hover)}}
.rev[aria-current=true]{background:color-mix(in srgb,var(--fanous-color-primary) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 55%,transparent)}
.rev[aria-current=true] .rev-n{background:var(--m-primary);color:var(--fanous-c-button-primary-text);box-shadow:var(--m-primary-edge)}
.rev-n{display:grid;place-items:center;min-width:32px;height:32px;padding:0 6px;border-radius:var(--r-pill);background:var(--fanous-c-segment-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border);font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}
.rev-b{display:grid;gap:2px;min-width:0}
.rev-t{font-weight:600;font-size:14px}
.rev-w,.rev-f{font-size:13px;color:var(--fanous-color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rev-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.sub-h{margin:8px 0 0;font-size:15px;color:var(--fanous-color-text-secondary);text-transform:none}
.badge.act-create,.badge.act-update,.badge.act-restore{background:color-mix(in srgb,var(--fanous-color-primary) 14%,transparent);color:var(--fanous-color-text-primary)}
.badge.act-restore::before{background:transparent;box-shadow:inset 0 0 0 2px currentColor}
.fc{display:grid;gap:8px;padding-block-start:14px;border-block-start:1px solid var(--fanous-c-divider-line)}
.fc h3{margin:0;font-size:15px}
.ba{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:0;align-items:baseline}
.ba dt{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--fanous-color-text-muted)}
html[lang=ar] .ba dt{text-transform:none;letter-spacing:0}
.ba dd{margin:0;padding:6px 10px;border-radius:var(--r-md);overflow-wrap:anywhere}
.ba dd.was{background:color-mix(in srgb,var(--fanous-color-error-fill) 12%,transparent);box-shadow:inset 3px 0 0 var(--fanous-c-form-error)}
.ba dd.now{background:color-mix(in srgb,var(--fanous-c-badge-status-bg) 18%,transparent);box-shadow:inset 3px 0 0 var(--fanous-c-badge-status-bg)}
[dir=rtl] .ba dd.was{box-shadow:inset -3px 0 0 var(--fanous-c-form-error)}[dir=rtl] .ba dd.now{box-shadow:inset -3px 0 0 var(--fanous-c-badge-status-bg)}[dir=rtl] .dl.add{box-shadow:inset -3px 0 0 var(--fanous-c-badge-status-bg)}
.diff{list-style:none;margin:0;padding:6px 0;border-radius:var(--r-md);background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.6;overflow-x:auto}
html[lang=ar] .diff,.diff[lang=ar]{font-family:var(--fanous-font-arabic);font-size:14px}
.dl{display:grid;grid-template-columns:22px minmax(0,1fr);padding-inline-end:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.dl-m{text-align:center;color:var(--fanous-color-text-muted);user-select:none}
.dl ins,.dl del{text-decoration:none;color:inherit}
.dl.add{background:color-mix(in srgb,var(--fanous-c-badge-status-bg) 20%,transparent);box-shadow:inset 3px 0 0 var(--fanous-c-badge-status-bg)}.dl.add .dl-m{color:var(--fanous-color-text-primary);font-weight:700}
.dl.del{background:color-mix(in srgb,var(--fanous-color-error-fill) 14%,transparent)}.dl.del .dl-m{color:var(--fanous-color-text-primary);font-weight:700}
.dl.del del{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--fanous-c-form-error) 60%,transparent)}
.dl.skip{display:block;padding:2px 12px;padding-inline-start:22px;font-family:var(--fanous-font-latin);font-size:12px;font-style:italic;color:var(--fanous-color-text-muted)}

/* Overview: what goes live next, as a vertical timeline (start-side rail and dots). */
.timeline{list-style:none;margin:0;padding:0;display:grid;gap:0}
.tl{position:relative;display:grid;gap:2px;padding-block:0 18px;padding-inline-start:26px}
.tl::before{content:"";position:absolute;inset-block:6px 0;inset-inline-start:6px;width:2px;background:color-mix(in srgb,var(--fanous-color-primary) 35%,transparent)}
.tl:last-child{padding-block-end:0}.tl:last-child::before{display:none}
.tl-dot{position:absolute;inset-block-start:4px;inset-inline-start:0;width:14px;height:14px;border-radius:50%;background:var(--fanous-color-surface);box-shadow:inset 0 0 0 3px var(--fanous-color-primary)}
.tl-when{font-size:13px;font-weight:700;color:var(--fanous-color-text-secondary);font-variant-numeric:tabular-nums}
.tl .li-title{display:block}
/* Picker */
.picker-form{display:grid;gap:12px}
.picker-results{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.picker-results li{display:grid;grid-template-columns:128px minmax(0,1fr) auto;gap:12px;align-items:center;padding:8px;border-radius:var(--r-lg);background:var(--m-card);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 18%,transparent)}
.picker-results img,.picker-results .ph{width:128px;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-md);background:var(--fanous-c-skeleton-bg)}
.picker-results .t{font-weight:700;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.picker-results .m{font-size:13px;color:var(--fanous-color-text-secondary)}
.picker-results li.picker-more{display:flex;justify-content:center;background:none;box-shadow:none}
.picker-results li[data-added]{opacity:.7}
.picker-results .sk-line{height:12px;border-radius:var(--r-md);background:var(--fanous-c-skeleton-bg);margin-block:6px;width:80%}
.picker-results .sk-line.short{width:40%}
@media (prefers-reduced-motion:no-preference){.picker-results .sk-row .ph,.picker-results .sk-line{animation:pk-pulse 1.4s ease-in-out infinite}}
@keyframes pk-pulse{50%{opacity:.5}}
@media(max-width:600px){.picker-results li{grid-template-columns:96px minmax(0,1fr)}.picker-results img,.picker-results .ph{width:96px}.picker-results li>.btn{grid-column:1/-1}}
.embed{width:100%;aspect-ratio:16/9;border:0;border-radius:var(--r-lg);background:#000}

/* Row lists (navigation, videos, social) */
.rows{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:10px 12px;border-radius:var(--r-lg);background:color-mix(in srgb,var(--fanous-color-surface) 70%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);transition:box-shadow var(--fanous-duration-fast),transform var(--fanous-duration-fast)}
.row.dragging{opacity:.5}.row.drop-before{box-shadow:inset 0 3px 0 var(--fanous-color-primary)}.row.drop-after{box-shadow:inset 0 -3px 0 var(--fanous-color-primary)}
.row.saved{box-shadow:inset 0 0 0 1px var(--fanous-c-form-success)}
.row-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:10px}
.grip{cursor:grab;color:var(--fanous-color-text-muted);display:grid;place-items:center;width:24px}
.row-tools{display:flex;gap:2px}.row-tools .btn.ghost{--b-bg:transparent;--b-bd:transparent;--b-fg:var(--fanous-color-text-secondary)}
@media(hover:hover){.row-tools .btn.ghost:hover{--b-bg:var(--m-hover)}}
.row-tools .danger-ic{--b-fg:var(--fanous-color-error-text)!important}
.add-row{grid-template-columns:minmax(0,1fr) auto;align-items:end;background:transparent;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--fanous-color-primary) 35%,transparent);border-radius:var(--r-lg);padding:14px}
.social-row{grid-template-columns:minmax(0,1fr) auto}
.social-row .row-fields{grid-template-columns:minmax(0,180px) minmax(0,1fr)}
.switch.sm{min-height:36px;gap:8px;font-size:13px}
.vis-label{min-width:64px}
@media(max-width:760px){.row{grid-template-columns:auto minmax(0,1fr)}.row-fields{grid-template-columns:1fr}.row>.switch,.row>.row-tools{grid-column:2}.add-row{grid-template-columns:1fr}.social-row .row-fields{grid-template-columns:1fr}}
.vrow{grid-template-columns:auto 200px minmax(0,1fr) auto;align-items:start;padding:14px}
.vthumb{position:relative;display:grid;place-items:center;aspect-ratio:16/9;border-radius:var(--r-md);overflow:hidden;background:var(--fanous-c-skeleton-bg);color:var(--fanous-color-text-muted);box-shadow:var(--m-thumb-edge)}
.vthumb img{width:100%;height:100%;object-fit:cover}
.vkind{position:absolute;inset-block-end:6px;inset-inline-start:6px;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:var(--r-sm);background:rgb(9 21 30/.86);color:#fff;font-size:12px;font-weight:700}
.vend{display:grid;gap:8px;justify-items:end}
@media(max-width:1000px){.vrow{grid-template-columns:auto 140px minmax(0,1fr)}.vend{grid-column:2/-1;display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center}}
@media(max-width:600px){.vrow{grid-template-columns:minmax(0,1fr)}.vrow>.grip{display:none}.vend{grid-column:auto}}
/* Home timeline (src/admin/screens/timeline.tsx) */
.tl-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start;margin-block-start:16px}
.tl-h{display:flex;align-items:center;gap:8px;margin:0;font-size:18px}
.tl-list{position:relative}
.tl-list::before{content:"";position:absolute;inset-block:18px;inset-inline-start:22px;width:2px;border-radius:2px;background:linear-gradient(to bottom,color-mix(in srgb,var(--fanous-color-primary) 55%,transparent),color-mix(in srgb,var(--fanous-color-primary) 8%,transparent))}
.tl-dot{position:relative;z-index:1;width:12px;height:12px;margin:12px 3px 0;border-radius:50%;background:var(--fanous-color-primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--fanous-color-primary) 22%,transparent)}
.tl-remove{--b-fg:var(--fanous-color-error-text)!important}
.tl-row.is-hidden .vthumb,.tl-row.is-hidden .li-title{opacity:.55}
.tl-row.is-hidden .tl-dot{background:transparent;box-shadow:inset 0 0 0 2px var(--fanous-color-outline)}
.tl-empty{margin:0;padding:14px 16px;border-radius:var(--r-lg);border:1px dashed color-mix(in srgb,var(--fanous-color-primary) 40%,transparent)}
.tl-status-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.tl-status-h{margin:0;font-size:15px}
.tl-led{flex:none;width:12px;height:12px;border-radius:50%;background:var(--fanous-color-primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--fanous-color-primary) 20%,transparent)}
.tl-led.busy{animation:tl-pulse 1.4s ease-in-out infinite}
.tl-led.bad{background:var(--fanous-color-error-text);box-shadow:0 0 0 4px color-mix(in srgb,var(--fanous-color-error-text) 22%,transparent)}
@keyframes tl-pulse{50%{opacity:.35}}
.tl-changes{list-style:none;margin:0;padding:0;display:grid;gap:10px;font-size:14px;line-height:1.5}
.tl-changes li{padding-block-end:10px;border-block-end:1px solid var(--fanous-c-divider-line)}
.tl-changes li:last-child{border:0;padding:0}
.tl-who{font-weight:700;overflow-wrap:anywhere}
@media(max-width:1000px){.tl-layout{grid-template-columns:minmax(0,1fr)}.tl-layout>aside{position:static}}
@media(max-width:600px){.tl-list::before,.tl-dot{display:none}}
/* Library */
.media-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.media-card{display:grid;gap:12px;padding:12px}
.media-card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r-md);background:var(--fanous-c-skeleton-bg)}
.site-hero{grid-template-columns:1fr;min-height:180px}
/* Block and slide editors (src/admin/screens/blocks.tsx) */
.blk-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.blk-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.blk{position:relative;border-radius:var(--r-lg);background:color-mix(in srgb,var(--fanous-color-surface) 78%,transparent);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border),var(--m-card-edge);transition:box-shadow var(--fanous-duration-fast,120ms)}
.blk:focus-within{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 55%,transparent),var(--m-card-edge)}
.blk::before{content:"";position:absolute;inset-block:12px;inset-inline-start:0;width:3px;border-radius:0 3px 3px 0;background:var(--m-primary);opacity:0;transition:opacity var(--fanous-duration-fast,120ms)}
[dir=rtl] .blk::before{border-radius:3px 0 0 3px}
.blk:focus-within::before{opacity:1}
.blk.dragging{opacity:.45}
.blk.drop-before{box-shadow:inset 0 3px 0 var(--fanous-color-primary)}.blk.drop-after{box-shadow:inset 0 -3px 0 var(--fanous-color-primary)}
.blk-h{display:flex;align-items:center;gap:10px;padding:10px 12px;border-block-end:1px solid var(--fanous-c-divider-line)}
.blk-t{margin:0;font-size:15px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk-ic{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:var(--r-md);background:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);color:var(--fanous-color-primary)}
.blk-warn{display:none;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--fanous-color-text-secondary);padding:4px 10px;border-radius:var(--r-pill);background:var(--fanous-c-skeleton-bg)}
.blk[data-incomplete] > .blk-h .blk-warn{display:inline-flex}
.blk-tools{flex:none}
.blk-tools .btn[disabled]{opacity:.35}
.blk-b{padding:14px;display:grid;gap:14px}
.blk > .err{margin:10px 14px 0}
.blk-2{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
.stack-sm{display:grid;gap:12px;align-content:start}
.grip{display:grid;place-items:center;width:28px;height:36px;flex:none;border-radius:var(--r-sm,6px);color:var(--fanous-color-text-muted);cursor:grab}
.grip:active{cursor:grabbing}
[data-seq-grip]{touch-action:none;user-select:none;-webkit-user-select:none}
html.seq-dragging,html.seq-dragging *{cursor:grabbing!important;user-select:none!important;-webkit-user-select:none!important}
.blk.dragging,.sub.dragging{opacity:1!important;position:relative;z-index:3;box-shadow:0 14px 34px -12px color-mix(in srgb,var(--fanous-color-primary) 55%,transparent),0 0 0 2px var(--fanous-color-primary)}
@media(hover:hover){.grip:hover{background:var(--fanous-c-skeleton-bg);color:var(--fanous-color-text-primary)}}
.seq-empty{margin:0;padding:18px;border-radius:var(--r-lg);border:1.5px dashed var(--fanous-c-form-section-border);text-align:center}
.subs{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.subs.gal{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.sub{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px;border-radius:var(--r-md);background:var(--m-card);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.sub.dragging{opacity:.45}.sub.drop-before{box-shadow:inset 0 3px 0 var(--fanous-color-primary)}.sub.drop-after{box-shadow:inset 0 -3px 0 var(--fanous-color-primary)}
.subs.gal .sub{grid-template-columns:1fr;position:relative}
.subs.gal .sub > .grip{position:absolute;inset-block-start:14px;inset-inline-start:14px;z-index:2;background:color-mix(in srgb,var(--fanous-color-surface) 85%,transparent)}
.subs.gal .sub > .row-tools{justify-content:flex-end}
.sub.row-sm{grid-template-columns:auto auto minmax(0,1fr) auto auto;align-items:center}
.sub.row-sm .vthumb{width:96px}
.sub-title{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}
.sub-fields{display:grid;gap:8px;min-width:0}
.img-slot{display:grid;gap:10px}
.img-view{position:relative;display:grid;place-items:center;aspect-ratio:16/9;border-radius:var(--r-md);overflow:hidden;background:var(--fanous-c-skeleton-bg);box-shadow:var(--m-thumb-edge,none)}
.img-slot.big .img-view{aspect-ratio:4/5;max-height:520px}
.img-view img{width:100%;height:100%;object-fit:cover}
.img-empty{display:grid;justify-items:center;gap:6px;color:var(--fanous-color-text-secondary);font-size:13px;text-align:center;padding:12px}
.video-slot{display:grid;gap:10px}
.blk-add{margin-block-start:18px;padding-block-start:16px;border-block-start:1px solid var(--fanous-c-divider-line)}
.blk-add h3{margin:0 0 10px;font-size:15px}
.blk-add-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.blk-add-btn{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"ic t" "ic d";column-gap:12px;row-gap:2px;align-items:center;min-height:64px;padding:10px 12px;border:0;border-radius:var(--r-lg);background:var(--m-card) padding-box,var(--m-border) border-box;border:1px solid transparent;box-shadow:var(--m-card-edge);color:inherit;text-align:start;cursor:pointer;font:inherit}
.blk-add-btn .blk-ic{grid-area:ic}
.blk-add-t{grid-area:t;font-weight:700}
.blk-add-d{grid-area:d;font-size:12.5px;color:var(--fanous-color-text-secondary);line-height:1.35}
@media(hover:hover){.blk-add-btn:hover{background:color-mix(in srgb,var(--fanous-color-primary) 10%,var(--fanous-color-surface))}}
.blk-add-btn:active{transform:translateY(1px)}
/* Phones: two compact columns (icon over title over description) instead of eleven full-width rows. */
@media(max-width:560px){.blk-add-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.blk-add-btn{grid-template-columns:minmax(0,1fr);grid-template-areas:"ic" "t" "d";align-items:start;align-content:start;row-gap:4px;padding:10px}.blk-add-btn .blk-ic{width:32px;height:32px}.blk-add-d{font-size:12px}}
/* Slide overlay: the same scrim and positions as www, so the editor sees what readers see */
.ov{position:absolute;inset:0;display:flex;padding:18px;pointer-events:none;color:#fff}
.ov-top{align-items:flex-start;background:linear-gradient(to bottom,rgba(8,8,10,.78),rgba(8,8,10,.42) 45%,transparent 75%)}
.ov-middle{align-items:center;background:rgba(8,8,10,.58)}
.ov-bottom{align-items:flex-end;background:linear-gradient(to top,rgba(8,8,10,.78),rgba(8,8,10,.42) 45%,transparent 75%)}
.ov-text{display:grid;gap:6px;max-width:34ch;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.ov-middle .ov-text{margin-inline:auto;text-align:center}
.ov-text strong{font-size:clamp(18px,2.2vw,24px);line-height:1.25}
.ov-text span{font-size:14.5px;line-height:1.5}
.ov[hidden]{display:none}
/* Media chooser */
.dlg.media-dlg{width:min(960px,calc(100vw - 24px))}
.media-pick{list-style:none;margin:0;padding:0;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
.mp{position:relative;display:block;width:100%;padding:0;border:0;border-radius:var(--r-md);overflow:hidden;background:var(--fanous-c-skeleton-bg);cursor:pointer;aspect-ratio:1}
.mp img{width:100%;height:100%;object-fit:cover}
.mp[aria-pressed=true]{outline:3px solid var(--fanous-color-primary);outline-offset:2px}
.mp-check{position:absolute;inset-block-start:6px;inset-inline-end:6px;display:none;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--m-primary);color:var(--fanous-c-button-primary-text);font-weight:700}
.mp[aria-pressed=true] .mp-check{display:grid}
/* Block preview */
.bp{display:grid;gap:22px;padding:clamp(16px,3vw,28px);border-radius:var(--r-lg);background:var(--fanous-color-background);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border);line-height:1.7;overflow-wrap:anywhere}
.bp h2,.bp h3{margin:0 0 .4em}.bp p{margin:0 0 .8em}
.bp img{width:100%;height:auto;border-radius:var(--r-md);background:var(--fanous-c-skeleton-bg)}
.bp figure{margin:0;display:grid;gap:6px}.bp figcaption{font-size:13px;color:var(--fanous-color-text-secondary)}
.bp-fig.content{max-width:720px}
.bp-gal{display:grid;gap:10px;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
.bp-gal img{aspect-ratio:1;object-fit:cover}
.bp-shelf{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(160px,200px);gap:12px;overflow-x:auto}
.bp-shelf > div{display:grid;gap:6px;font-size:13px;font-weight:600}.bp-shelf img,.bp-shelf .vthumb{aspect-ratio:16/9;object-fit:cover}
.bp-video{position:relative;display:grid;place-items:center;aspect-ratio:16/9;max-width:720px;border-radius:var(--r-md);overflow:hidden;background:#111}
.bp-video img{position:absolute;inset:0;height:100%;object-fit:cover}
.bp-play{position:relative;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:24px}
.bp-cta{display:grid;gap:8px;justify-items:start;padding:20px;border-radius:var(--r-lg);background:color-mix(in srgb,var(--fanous-color-primary) 14%,var(--fanous-color-surface))}
.bp-cta.quiet{background:var(--fanous-color-surface);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.bp-cols{display:grid;gap:20px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center}
.bp-cols.start > :last-child{order:-1}
.bp-q{margin:0;padding-inline-start:16px;border-inline-start:3px solid var(--fanous-color-primary);font-size:1.1em}
.bp-q.callout{padding:16px;border-inline-start-width:4px;border-radius:var(--r-md);background:color-mix(in srgb,var(--fanous-color-primary) 10%,transparent)}
.bp-q cite{display:block;font-size:14px;color:var(--fanous-color-text-secondary)}
.bp-hr{border:0;border-block-start:1px solid var(--fanous-c-divider-line);margin:0}
.bp-space.s{height:16px}.bp-space.m{height:40px}.bp-space.l{height:80px}
@media(max-width:720px){.blk-2,.bp-cols{grid-template-columns:1fr}.blk-h{flex-wrap:wrap}.blk-warn{order:5;flex-basis:100%;justify-content:flex-start}.sub.row-sm{grid-template-columns:auto minmax(0,1fr) auto}.sub.row-sm .vthumb,.sub.row-sm [data-post-status]{display:none}}
/* Sticky action bar (and the phone bottom bar) must never hide a focused or scrolled-to control (WCAG 2.4.11). */
@media(max-width:1100px){html{scroll-padding-block-end:88px}.split>.sticky{position:static}}
@media(max-width:760px){html{scroll-padding-block-end:160px}}
/* AI assist (docs/AI_ASSIST_SPEC.md §8) */
.ai-status:empty{display:none}
.ai-status{display:flex;align-items:center;gap:8px}
.ai-status.err{color:var(--fanous-c-form-error);font-weight:600}
.ai-spin{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--fanous-color-primary) 30%,transparent);border-block-start-color:var(--fanous-color-primary);animation:ai-spin .8s linear infinite}
@keyframes ai-spin{to{transform:rotate(360deg)}}
.ai-sugg-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}
.ai-sugg-row .btn{min-height:44px}
.ai-item{display:grid;gap:6px;padding:12px 14px;border-radius:var(--r-lg);background:var(--fanous-c-form-section-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.ai-item p{margin:0}
.ai-item-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ai-quote{margin:0;padding-inline-start:12px;border-inline-start:3px solid var(--fanous-color-primary);color:var(--fanous-color-text-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.badge.sev-info{background:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);color:var(--fanous-color-text-primary)}
.badge.sev-warn{background:transparent;color:var(--fanous-color-text-primary);box-shadow:inset 0 0 0 1px var(--fanous-color-outline)}
.badge.sev-high{background:var(--fanous-color-error-fill);color:var(--fanous-color-on-error-fill)}
/* AI assist settings (src/admin/screens/ai-settings.tsx) */
.ai-provider-h{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.ai-provider-h h3{flex:1 1 auto;min-width:0}
.ai-provider .textarea.code{min-height:0}
.input.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}
.ai-provider fieldset,.ai-route{border:0;margin:0;padding:0;min-width:0}
.ai-routes{display:grid;gap:16px}
.ai-route{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:12px;align-items:end}
.ai-route legend{grid-column:1/-1;margin-block-end:4px}
@media(max-width:640px){.ai-route{grid-template-columns:minmax(0,1fr)}}
.ai-header-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) auto;gap:10px;align-items:end}
@media(max-width:640px){.ai-header-row{grid-template-columns:minmax(0,1fr) auto}.ai-header-row .field:nth-child(2){grid-column:1}}
.ai-test-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}.ai-test-row .field{flex:1 1 240px}
.ai-test pre{max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:6px 0 0;padding:10px;border-radius:var(--r-md);background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border);font-size:13px}
.ai-save{position:sticky;inset-block-end:12px;z-index:5;display:flex;justify-content:flex-end}
.ai-errors-list{margin:6px 0 0;padding-inline-start:20px}
.combo{position:relative}
.combo-list{position:absolute;inset-inline:0;inset-block-start:calc(100% + 4px);z-index:20;max-height:240px;overflow:auto;margin:0;padding:4px;list-style:none;border-radius:var(--r-md);background:var(--fanous-c-form-input-bg);box-shadow:0 0 0 1px var(--fanous-c-form-input-border),0 8px 24px rgb(0 0 0/.18)}
.combo-list li{padding:8px 10px;border-radius:var(--r-sm, 6px);cursor:pointer;direction:ltr;text-align:start;overflow-wrap:anywhere}
.combo-list li[aria-selected=true]{background:color-mix(in srgb,var(--fanous-color-primary) 18%,transparent)}
.combo-list li.combo-empty{cursor:default;color:var(--fanous-color-text-muted)}
/* Translation flags (docs/TRANSLATION_FLAGS.md): the highlight layer over a field, the popover, the panel.
   Flagged text is tinted AND underlined (a dashed line, thicker when it is the current flag): never colour alone. */
.trf-wrap{position:relative;display:block}
.trf-mirror{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;color:transparent;background:transparent;border-color:transparent!important;box-shadow:none!important}
.trf-mirror mark{color:transparent;background:color-mix(in srgb,var(--fanous-color-accent) 26%,transparent);border-radius:2px;text-decoration:underline dashed var(--fanous-color-error-text);text-decoration-thickness:2px;text-underline-offset:.25em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.trf-mirror mark.cur{background:color-mix(in srgb,var(--fanous-color-accent) 45%,transparent);text-decoration-style:solid;text-decoration-thickness:3px}
.trf-mirror mark.pend{background:transparent;text-decoration-style:dotted}
.trf-pop{position:absolute;z-index:30;padding:4px;border-radius:var(--r-md);background:var(--fanous-c-dialog-bg);box-shadow:0 0 0 1px var(--fanous-c-dialog-border),var(--fanous-elevation-high)}
.trf-list{gap:8px}
.trf-list>li{display:grid;gap:6px;padding:10px 12px;border-radius:var(--r-md);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.trf-list>li[data-current]{box-shadow:inset 0 0 0 2px var(--fanous-color-primary)}
.trf-list .trf-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;color:var(--fanous-color-text-secondary)}
.trf-list .trf-acts{display:flex;flex-wrap:wrap;gap:6px}
.trf-list .ai-quote{font-size:14px}
.trf-list .trf-sugg{font-size:14px;margin:0}
.trf-list .trf-lost{font-size:13px;color:var(--fanous-color-error-text);margin:0}
.trf-quote{color:var(--fanous-color-text-primary);font-weight:600}
.trf-reasons{border:0;margin:0;padding:0;min-width:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.trf-reasons legend{padding:0;margin-block-end:8px}
.trf-alts{border:0;margin:0;padding:0;min-width:0;display:grid;gap:8px}
.check{display:flex;align-items:center;gap:8px;min-height:32px;cursor:pointer}
.check input{width:18px;height:18px;margin:0;accent-color:var(--fanous-color-primary);flex:none}
.trf-alts .check{align-items:flex-start;padding:10px 12px;border-radius:var(--r-md);box-shadow:inset 0 0 0 1px var(--fanous-c-form-section-border)}
.trf-alts .check:has(input:checked){box-shadow:inset 0 0 0 2px var(--fanous-color-primary)}
.trf-edit-list{margin:0;padding-inline-start:18px;display:grid;gap:4px}
.trf-history summary{cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center}
.trf-history[open] summary{margin-block-end:8px}
.badge.trf{background:color-mix(in srgb,var(--fanous-color-accent) 22%,transparent);color:var(--fanous-color-text-primary)}
.badge.trf::before{display:none}
.gl-list>li{grid-template-columns:minmax(0,1fr) auto}
.gl-terms{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-weight:600}
.gl-form{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
/* The lantern street (Fawanees; html.fanous-street): a flat page behind the distant lights, and blocks that can sit straight on the page are
   tinted against the page colour instead of see-through, so the street never shows through them
   (the same look over the page). */
html.fanous-street body{background:var(--fanous-color-background)}
html.fanous-street .empty{background:color-mix(in srgb,var(--fanous-color-surface) 60%,var(--fanous-color-background))}
html.fanous-street .notice{background:color-mix(in srgb,var(--fanous-color-primary) 12%,var(--fanous-color-background))}
html.fanous-street .notice.bad{background:color-mix(in srgb,var(--fanous-color-error-fill) 14%,var(--fanous-color-background))}
html.fanous-street .md-bar{background:color-mix(in srgb,var(--fanous-color-surface) 70%,var(--fanous-color-background))}
html.fanous-street .row{background:color-mix(in srgb,var(--fanous-color-surface) 70%,var(--fanous-color-background))}
html.fanous-street .blk{background:color-mix(in srgb,var(--fanous-color-surface) 78%,var(--fanous-color-background))}
html.fanous-street .drop{background:color-mix(in srgb,var(--fanous-color-primary) 9%,var(--fanous-color-background))}
html.fanous-street .drop:hover,html.fanous-street .drop.over{background:color-mix(in srgb,var(--fanous-color-primary) 18%,var(--fanous-color-background))}
/* Phones have no side margins for garlands: every fourth list item opens a 76px gap, enough for one (the module needs a 48px free band
   after padding each card by 6px; the same gap as www and the videos site), so the street shows while scrolling and the lists stay dense. */
@media(max-width:639px){html.fanous-street :is(.list,.rows)>:nth-child(4n+1):not(:first-child){margin-block-start:66px}}
`;
