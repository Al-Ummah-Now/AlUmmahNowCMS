/** @jsxImportSource hono/jsx */
/**
 * "Write in Studio" (docs/SCHOLARS.md §7, decision SS18): a scholar's home in the CMS. Scholars write
 * every post in Studio on the videos site; the CMS keeps their profile and editors' featuring.
 */
import { PageHead, type View } from "../ui/layout.tsx";
import { trimSlash } from "../../env.ts";
import { scholarOfSub } from "../../lib/scholars/profiles.ts";

export async function writeScreen(v: View, db: D1Database) {
   const tw = v.t.write;
   const scholar = await scholarOfSub(db, v.user.sub ?? null);
   const stored = scholar ? await db.prepare("SELECT primary_channel_id FROM scholars WHERE id = ?1").bind(scholar.id).first<{ primary_channel_id: string | null }>() : null;
   const primary = stored?.primary_channel_id ?? scholar?.channel_ids[0] ?? null;
   const videos = trimSlash(v.videosWebUrl ?? "");
   const lang = v.prefs.lang;
   const studio = primary ? `${videos}/${lang}/settings/channel/${encodeURIComponent(primary)}/community` : `${videos}/${lang}/studio`;
   return (
      <>
         <PageHead title={tw.title} intro={tw.intro} />
         <section class="card" style="max-width:640px" data-write-in-studio>
            {primary ? (
               <p style="display:flex;gap:8px;flex-wrap:wrap">
                  <a class="btn primary" href={`${studio}/new`} data-write-new>
                     {tw.openNew}
                  </a>
                  <a class="btn" href={studio}>
                     {tw.open}
                  </a>
               </p>
            ) : (
               <p class="notice">{tw.noChannel}</p>
            )}
            <p style="display:flex;gap:16px;flex-wrap:wrap">
               {scholar ? <a href={`${trimSlash(v.wwwUrl)}/${lang}/scholars/${encodeURIComponent(scholar.slug)}/`}>{tw.page}</a> : null}
               <a href="/scholars/me">{tw.profile}</a>
            </p>
         </section>
      </>
   );
}
