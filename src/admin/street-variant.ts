import { STREET_VARIANTS } from "./client/fanous-street.generated.js";

/**
 * The lantern street's tile variant (1..STREET_VARIANTS) for one response, sent as
 * <html data-fanous-street-variant>. The shared module picks it with an inline head script
 * (STREET_VARIANT_SCRIPT); staff screens are never cached, so the CMS picks it while rendering
 * instead and needs no inline script. The aun_street_variant cookie pins it for tests.
 */
export function pickStreetVariant(cookieHeader: string | null | undefined, random: () => number = Math.random): number {
   const pinned = /(?:^|;)\s*aun_street_variant=([1-9])\s*(?:;|$)/.exec(cookieHeader || "");
   if (pinned && Number(pinned[1]) <= STREET_VARIANTS) return Number(pinned[1]);
   return 1 + Math.min(STREET_VARIANTS - 1, Math.floor(random() * STREET_VARIANTS));
}
