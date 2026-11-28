/**
 * SSRF & URL guard for admin-configured AI HTTP provider endpoints (injection audit CMS-1, CMS-2).
 *
 * Rules:
 * - Only `https:` is allowed, except `http:` to explicit loopback (`127.0.0.1`, `localhost`, `[::1]`)
 *   when `local: true` (ENVIRONMENT === "local").
 * - `{{model}}` may appear only in the path or query string, never in the scheme, userinfo, host, or port.
 * - Private/reserved IPv4, private/link-local/loopback/IPv4-mapped IPv6, cloud metadata hosts,
 *   single-label hostnames, and `.local`/`.internal`/`.localhost`/`.home.arpa` domains are refused
 *   (loopback is permitted only when `local: true`).
 * - Control characters and whitespace are rejected before parsing so `new URL()` cannot strip them.
 */

export const MODEL_ID_RE = /^[\w@.:/+-]{1,128}$/;

const CTRL_OR_SPACE = /[\u0000-\u0020\u007f]/;

const BLOCKED_HOSTNAMES = new Set([
   "localhost",
   "metadata",
   "metadata.google.internal",
   "metadata.goog",
   "metadata.azure.internal",
   "instance-data",
   "instance-data.ec2.internal",
]);

const BLOCKED_SUFFIXES = [
   ".localhost",
   ".local",
   ".internal",
   ".home.arpa",
   ".localdomain",
   ".arpa",
   ".corp",
   ".lan",
   ".home",
   ".intranet",
];

function parseIpv4(host: string): [number, number, number, number] | null {
   const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
   if (!m) return null;
   const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
   if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
   return parts as [number, number, number, number];
}

function isBlockedIpv4(ip: [number, number, number, number], local: boolean): boolean {
   const [a, b, c] = ip;
   if (a === 127) return !local; // 127.0.0.0/8 loopback
   if (a === 0) return true; // 0.0.0.0/8 "this network"
   if (a === 10) return true; // 10.0.0.0/8 RFC 1918
   if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
   if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
   if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC 1918
   if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
   if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
   if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC 1918
   if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
   if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
   if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
   if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
   return false;
}

function parseIpv6(rawHost: string): number[] | null {
   const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
   if (!host.includes(":")) return null;
   // Strip zone id if present; zone-scoped IPv6 literals are always link-local/private anyway.
   if (host.includes("%")) return null;

   // Handle IPv4 tail in IPv6 (e.g. ::ffff:127.0.0.1)
   let work = host.toLowerCase();
   const lastColon = work.lastIndexOf(":");
   if (work.includes(".")) {
      const tail = work.slice(lastColon + 1);
      const ipv4 = parseIpv4(tail);
      if (!ipv4) return null;
      const hi = ((ipv4[0] << 8) | ipv4[1]).toString(16);
      const lo = ((ipv4[2] << 8) | ipv4[3]).toString(16);
      work = `${work.slice(0, lastColon)}:${hi}:${lo}`;
   }

   const halves = work.split("::");
   if (halves.length > 2) return null;
   const parseSide = (s: string) => (s === "" ? [] : s.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
   const left = parseSide(halves[0]!);
   const right = halves.length === 2 ? parseSide(halves[1]!) : [];
   if (left.some(Number.isNaN) || right.some(Number.isNaN)) return null;
   if (halves.length === 1) return left.length === 8 ? left : null;
   const fill = 8 - (left.length + right.length);
   if (fill < 1) return null;
   return [...left, ...Array<number>(fill).fill(0), ...right];
}

function isBlockedIpv6(hextets: number[], local: boolean): boolean {
   const allZero = hextets.every((h) => h === 0);
   if (allZero) return true; // :: unspecified
   const isLoopback = hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1;
   if (isLoopback) return !local; // ::1 loopback

   // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96), IPv4-translated (::ffff:0:0:0/96), NAT64 (64:ff9b::/96)
   const embeddedV4 =
      (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && (hextets[5] === 0xffff || hextets[5] === 0)) ||
      (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0xffff && hextets[5] === 0) ||
      (hextets[0] === 0x0064 && hextets[1] === 0xff9b && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0);
   if (embeddedV4) {
      const ip: [number, number, number, number] = [
         (hextets[6]! >> 8) & 0xff,
         hextets[6]! & 0xff,
         (hextets[7]! >> 8) & 0xff,
         hextets[7]! & 0xff,
      ];
      return isBlockedIpv4(ip, local);
   }

   const h0 = hextets[0]!;
   const h1 = hextets[1]!;
   if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 Unique Local
   if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-Local
   if ((h0 & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated Site-Local
   if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 Multicast
   if (h0 === 0x0100 && h1 === 0) return true; // 100::/64 discard
   if (h0 === 0x2001 && h1 === 0x0db8) return true; // 2001:db8::/32 documentation
   if (h0 === 0x2001 && h1 === 0x0000) return true; // 2001::/32 Teredo
   if (h0 === 0x2002) return true; // 2002::/16 6to4 (can embed private IPv4)
   if (h0 === 0x0064 && h1 === 0xff9b) return true; // 64:ff9b:1::/48 local-use NAT64
   return false;
}

export function isLoopbackHostname(rawHostname: string): boolean {
   const h = rawHostname.toLowerCase().replace(/\.+$/, "");
   return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
}

/** True when `rawHostname` (typically `url.hostname`) targets a private, loopback, link-local, or internal host. */
export function isBlockedProviderHost(rawHostname: string, opts: { local: boolean }): boolean {
   if (!rawHostname || CTRL_OR_SPACE.test(rawHostname)) return true;
   const h = rawHostname.toLowerCase().replace(/\.+$/, "");
   if (!h) return true;

   // IPv6 literal
   if (h.startsWith("[") || h.includes(":")) {
      const hextets = parseIpv6(h);
      if (!hextets) return true;
      return isBlockedIpv6(hextets, opts.local);
   }

   // IPv4 literal (note: URL parser already canonicalizes hex/octal/decimal/short IPv4 to dotted-quad)
   const ipv4 = parseIpv4(h);
   if (ipv4) return isBlockedIpv4(ipv4, opts.local);

   // Loopback hostname
   if (h === "localhost") return !opts.local;

   // Metadata & internal hostnames
   if (BLOCKED_HOSTNAMES.has(h)) return true;
   if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;

   // Single-label hostnames (e.g. `redis`, `metadata`, `db`) are never public Internet hosts
   if (!h.includes(".")) return true;

   // Reject numeric-only TLDs (e.g., malformed IPv4 forms)
   const tld = h.slice(h.lastIndexOf(".") + 1);
   if (!tld || /^\d+$/.test(tld)) return true;

   return false;
}

/**
 * Checks whether a template URL has any placeholder (`{{...}}`) in its scheme or authority (userinfo/host/port).
 * Placeholders are only permitted in the path or query string.
 */
export function hasPlaceholderInAuthority(raw: string): boolean {
   const sep = raw.indexOf("://");
   if (sep < 0) return raw.includes("{") || raw.includes("}");
   const scheme = raw.slice(0, sep);
   if (scheme.includes("{") || scheme.includes("}")) return true;
   const rest = raw.slice(sep + 3);
   const endOfAuthority = rest.search(/[/?#]/);
   const authority = endOfAuthority < 0 ? rest : rest.slice(0, endOfAuthority);
   return authority.includes("{") || authority.includes("}");
}

/** Runtime check on a fully rendered provider URL right before `fetch()`. */
export function isAllowedProviderUrl(raw: string, opts: { local: boolean }): boolean {
   if (!raw || raw.length > 1000 || CTRL_OR_SPACE.test(raw)) return false;
   let u: URL;
   try {
      u = new URL(raw);
   } catch {
      return false;
   }
   if (u.username || u.password) return false;
   const loopback = isLoopbackHostname(u.hostname);
   if (u.protocol !== "https:" && !(opts.local && loopback && u.protocol === "http:")) return false;
   if (isBlockedProviderHost(u.hostname, opts)) return false;
   return true;
}
