/** @jsxImportSource hono/jsx */
/** People (admins): bknd's users table, a cache of SSO identities. Roles live in auth. */
import type { Data } from "../data.ts";
import { Empty, PageHead, type View } from "../ui/layout.tsx";
import { Icon } from "../ui/icons.tsx";

export async function peopleScreen(v: View, data: Data) {
   const { t } = v;
   const users = await data.list<{ id: number; email: string; role: string }>("users", { limit: 200, sort: "email", select: ["id", "email", "role"] });
   const authAdmin = v.adminWebUrl.replace("://admin.", "://admin.auth.");
   return (
      <>
         <PageHead title={t.people.title} intro={t.people.intro}>
            <a class="btn" href={`${authAdmin}/`}>
               <Icon name="external" size={18} class="flip" /> {t.people.manage}
            </a>
         </PageHead>
         {users.data.length ? (
            <ul class="list" aria-label={t.people.title}>
               {users.data.map((u) => (
                  <li class="li" style="grid-template-columns:auto minmax(0,1fr) auto">
                     <span class="avatar" aria-hidden="true">{(u.email[0] ?? "?").toUpperCase()}</span>
                     <div class="li-body">
                        <div class="li-title" dir="ltr" style="text-align:start">{u.email}</div>
                     </div>
                     <span class={`badge ${u.role === "admin" ? "published" : "draft"}`}>{u.role === "admin" ? t.header.roleAdmin : t.header.roleEditor}</span>
                  </li>
               ))}
            </ul>
         ) : (
            <Empty icon="users" title={t.people.empty} />
         )}
      </>
   );
}
