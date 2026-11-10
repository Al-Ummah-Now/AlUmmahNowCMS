/**
 * The CMS component system. Structure is shared; depth comes from the active theme's material
 * (`--m-*`, vendored from the theme demos) and colours from fanous part tokens (`--fanous-c-*`).
 * No rule names a theme. Logical properties only (RTL). Dark = `html.dark`.
 */
export const ADMIN_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{background:var(--fanous-color-background);--rail:84px;--rail-wide:248px;--hd:64px;--gap:var(--fanous-spacing-lg);color-scheme:light;font-family:var(--fanous-font-latin);-webkit-text-size-adjust:100%;text-size-adjust:100%}
html.dark{color-scheme:dark}
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
.brand-mark{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--m-primary);box-shadow:var(--m-primary-edge),0 0 0 1.5px var(--fanous-c-nav-indicator);color:var(--fanous-c-button-primary-text)}
.brand-name{font-weight:700;font-size:17px;line-height:1.1}.brand-sub{display:block;font-size:12px;font-weight:500;color:var(--fanous-c-nav-icon);letter-spacing:.02em}
.ic{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;border-radius:var(--r-pill);background:transparent;color:var(--fanous-c-nav-icon);cursor:pointer;text-decoration:none;transition:background-color var(--fanous-duration-fast),color var(--fanous-duration-fast)}
@media(hover:hover){.ic:hover{background:var(--fanous-c-nav-hover);color:var(--fanous-c-nav-text)}}
.search{display:flex;align-items:stretch;height:44px;border-radius:var(--r-pill);background:var(--fanous-c-nav-search-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-nav-search-border);overflow:hidden}
.search:focus-within{box-shadow:inset 0 0 0 2px var(--fanous-c-upload-focus)}
.search input{flex:1;min-width:0;padding-inline:var(--fanous-spacing-lg);border:0;outline:0;background:transparent;color:var(--fanous-c-nav-search-text)}
.search input::placeholder{color:var(--fanous-c-nav-search-placeholder)}
.search button{width:52px;display:grid;place-items:center;border:0;background:transparent;color:var(--fanous-c-nav-icon);cursor:pointer;border-inline-start:1px solid var(--fanous-c-nav-search-border)}
@media(hover:hover){.search button:hover{background:var(--fanous-c-nav-hover)}}
.who{display:flex;align-items:center;gap:8px;min-height:44px;padding-inline:6px 10px;border-radius:var(--r-pill)}
.avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--fanous-color-surface-raised);color:var(--fanous-color-text-primary);font-weight:700;font-size:14px;box-shadow:0 0 0 1.5px var(--fanous-c-nav-indicator)}
@media(max-width:900px){.hd{grid-template-columns:auto 1fr auto}.hd .search{display:none}.brand-sub{display:none}}
@media(max-width:480px){.hd .brand-name{display:none}.hd summary.btn span{display:none}.hd summary.btn{width:44px;padding:0}}

/* Menus (details/summary popovers) */
.pop{position:relative}
.pop>summary{list-style:none;cursor:pointer}.pop>summary::-webkit-details-marker{display:none}
.pop-panel{position:absolute;inset-block-start:calc(100% + 8px);inset-inline-end:0;z-index:60;min-width:240px;padding:6px;border-radius:var(--r-lg);background:var(--fanous-c-menu-bg);color:var(--fanous-c-menu-text);box-shadow:0 0 0 1px var(--fanous-c-menu-border),var(--fanous-elevation-high)}
.pop-panel.start{inset-inline-end:auto;inset-inline-start:0}
.pop-head{padding:10px 12px 8px;border-block-end:1px solid var(--fanous-c-divider-line);margin-block-end:6px}
.pop-head strong{display:block;overflow-wrap:anywhere}.pop-head span{font-size:13px;color:var(--fanous-c-menu-muted)}
.mi{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 12px;border:0;border-radius:var(--r-md);background:transparent;color:inherit;text-decoration:none;text-align:start;cursor:pointer}
@media(hover:hover){.mi:hover{background:var(--fanous-c-menu-hover)}}
.mi.danger{color:var(--fanous-color-error-text)}

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
.seg [aria-current=true],.seg [aria-pressed=true],.seg label:has(input:checked){background:var(--fanous-c-segment-active-bg);color:var(--fanous-c-segment-active-text);box-shadow:var(--fanous-elevation-low)}
.seg label:has(input:focus-visible){outline:2px solid var(--fanous-color-focus-ring);outline-offset:1px}

/* Badges and chips */
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:var(--r-pill);font-size:12px;font-weight:700;line-height:20px;white-space:nowrap}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.badge.published{background:var(--fanous-c-badge-status-bg);color:var(--fanous-c-badge-status-text)}
.badge.draft{background:transparent;color:var(--fanous-color-text-secondary);box-shadow:inset 0 0 0 1px var(--fanous-color-outline)}
.badge.loc{background:color-mix(in srgb,var(--fanous-color-primary) 16%,transparent);color:var(--fanous-color-text-primary)}
.badge.loc::before{display:none}
.chips{display:flex;flex-wrap:wrap;gap:8px}

/* Lists */
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-block-end:16px}
.toolbar .search{flex:1 1 260px;max-width:420px;background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)}
.toolbar .search input{color:var(--fanous-c-form-input-text)}
.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;border-radius:var(--r-lg);background:var(--m-card);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 18%,transparent);color:inherit;text-decoration:none;transition:box-shadow var(--fanous-duration-fast),transform var(--fanous-duration-fast)}
@media(hover:hover){a.li:hover,.li:has(a.li-main:hover){box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 55%,transparent),var(--m-card-edge)}}
.li-thumb{width:96px;aspect-ratio:16/9;border-radius:var(--r-md);object-fit:cover;background:var(--fanous-c-skeleton-bg);display:grid;place-items:center;color:var(--fanous-color-text-muted);overflow:hidden}
.li-body{min-width:0}
.li-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fanous-color-text-primary);text-decoration:none}
a.li-title:hover{text-decoration:underline}
.li-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-block-start:4px;font-size:13px;color:var(--fanous-color-text-secondary)}
.li-end{display:flex;align-items:center;gap:8px}
@media(max-width:600px){.li{grid-template-columns:minmax(0,1fr) auto}.li-thumb{display:none}}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block-start:18px}

/* Empty state */
.empty{display:grid;justify-items:center;gap:8px;padding:40px 20px;text-align:center;border-radius:var(--r-xl);border:1.5px dashed color-mix(in srgb,var(--fanous-color-primary) 45%,transparent);background:color-mix(in srgb,var(--fanous-color-surface) 60%,transparent)}
.empty .icon{width:40px;height:40px;color:var(--fanous-c-empty-icon)}
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
/* Picker */
.picker-form{display:grid;gap:12px}
.picker-results{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.picker-results li{display:grid;grid-template-columns:128px minmax(0,1fr) auto;gap:12px;align-items:center;padding:8px;border-radius:var(--r-lg);background:var(--m-card);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fanous-color-primary) 18%,transparent)}
.picker-results img,.picker-results .ph{width:128px;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-md);background:var(--fanous-c-skeleton-bg)}
.picker-results .t{font-weight:700;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.picker-results .m{font-size:13px;color:var(--fanous-color-text-secondary)}
@media(max-width:600px){.picker-results li{grid-template-columns:96px minmax(0,1fr)}.picker-results img,.picker-results .ph{width:96px}.picker-results li>.btn{grid-column:1/-1}}
.embed{width:100%;aspect-ratio:16/9;border:0;border-radius:var(--r-lg);background:#000}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
