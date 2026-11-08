/**
 * Headless SSO for the CMS (no browser), adapted from AlUmmahNow admin-web e2e/support/oauth.ts
 * for the CMS's PKCE flow: CMS /sso/login (sets the signed state cookie and builds the PKCE
 * authorize URL) → auth password sign-in → redirect to CMS /sso/callback?code&state.
 *
 * `beginSignIn` stops BEFORE the callback so a browser can finish it (the code is single-use);
 * `signIn` finishes it headlessly and returns the CMS session cookie.
 */
import { AUTH_URL, CALLBACK_URL, CMS_URL, type Account } from "./env.ts";

export class CookieJar {
   readonly cookies = new Map<string, { value: string; host: string }>();

   store(response: Response, url: string) {
      const host = new URL(url).host;
      for (const header of response.headers.getSetCookie()) {
         const [pair] = header.split(";");
         const index = pair.indexOf("=");
         if (index <= 0) continue;
         const name = pair.slice(0, index).trim();
         const value = pair.slice(index + 1).trim();
         if (value === "" || /max-age=0/i.test(header)) this.cookies.delete(`${host}|${name}`);
         else this.cookies.set(`${host}|${name}`, { value, host });
      }
   }

   header(url: string): string {
      const host = new URL(url).host;
      return [...this.cookies]
         .filter(([, c]) => c.host === host)
         .map(([k, c]) => `${k.split("|")[1]}=${c.value}`)
         .join("; ");
   }

   forHost(host: string): { name: string; value: string }[] {
      return [...this.cookies].filter(([, c]) => c.host === host).map(([k, c]) => ({ name: k.split("|")[1], value: c.value }));
   }
}

async function step(jar: CookieJar, url: string, init: RequestInit = {}): Promise<Response> {
   const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers as Record<string, string>), cookie: jar.header(url) },
   });
   jar.store(response, url);
   return response;
}

export interface PendingSignIn {
   jar: CookieJar;
   /** The CMS callback URL with code and state (not yet visited). */
   callbackUrl: string;
   authorizeUrl: URL;
}

export async function beginSignIn(account: Account, returnPath = "/"): Promise<PendingSignIn> {
   const jar = new CookieJar();
   const login = await step(jar, `${CMS_URL}/sso/login?return=${encodeURIComponent(returnPath)}`);
   const authorizeUrl = new URL(login.headers.get("location") ?? "");
   if (login.status !== 302 || !authorizeUrl.href.startsWith(`${AUTH_URL}/authorize`)) {
      throw new Error(`CMS /sso/login did not redirect to auth (status ${login.status})`);
   }

   let response = await step(jar, authorizeUrl.toString());
   for (let hops = 0; response.status >= 300 && response.status < 400 && hops < 10; hops++) {
      response = await step(jar, new URL(response.headers.get("location")!, AUTH_URL).toString());
   }
   if (response.status >= 400) {
      throw new Error(`auth /authorize answered ${response.status} (is the CMS client registered with redirect_uri ${CALLBACK_URL}?)`);
   }

   response = await step(jar, `${AUTH_URL}/password/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: account.email, password: account.password }).toString(),
   });
   let location = response.headers.get("location");
   for (let hops = 0; location && !location.startsWith(CALLBACK_URL) && hops < 10; hops++) {
      response = await step(jar, new URL(location, AUTH_URL).toString());
      location = response.headers.get("location");
   }
   if (!location?.startsWith(CALLBACK_URL)) {
      throw new Error(`Login for ${account.email} did not reach the CMS callback (status ${response.status})`);
   }
   return { jar, callbackUrl: location, authorizeUrl };
}

/** Full headless sign-in; returns the callback response and the CMS cookie header. */
export async function signIn(account: Account, returnPath = "/"): Promise<{ status: number; location: string | null; cookie: string; body: string }> {
   const pending = await beginSignIn(account, returnPath);
   const res = await step(pending.jar, pending.callbackUrl);
   return { status: res.status, location: res.headers.get("location"), cookie: pending.jar.header(CMS_URL), body: await res.text() };
}
