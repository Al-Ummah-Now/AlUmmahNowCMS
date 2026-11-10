/**
 * Community content policy for the pre-publish check — the **same** categories and rules as epic 28.
 * Copied from AlUmmahNow `docs/specs/AI-MODERATION.md` §1 (principle 3) and §3 at commit b4596fbe.
 * Do not add CMS-only categories: change that spec first, then copy it here.
 */

/** §3 base categories (Llama Guard 3). */
export const BASE_CATEGORIES = [
   { id: "violent_crimes", label: "Violent crimes" },
   { id: "non_violent_crimes", label: "Non-violent crimes" },
   { id: "sex_related_crimes", label: "Sex-related crimes" },
   { id: "child_sexual_exploitation", label: "Child sexual exploitation" },
   { id: "defamation", label: "Defamation" },
   { id: "specialised_advice", label: "Specialised advice" },
   { id: "privacy", label: "Privacy" },
   { id: "intellectual_property", label: "Intellectual property" },
   { id: "indiscriminate_weapons", label: "Indiscriminate weapons" },
   { id: "hate", label: "Hate" },
   { id: "self_harm", label: "Self-harm" },
   { id: "sexual_content", label: "Sexual content" },
   { id: "elections", label: "Elections" },
   { id: "code_interpreter_abuse", label: "Code interpreter abuse" },
] as const;

/** §3 platform extensions, with the example and default action from the table. */
export const EXTENSION_CATEGORIES = [
   { id: "sectarian_hate", example: "Takfir or incitement against a sect/group, dehumanising language", action: "Hold for review" },
   {
      id: "violent_extremism",
      example: "Praise/recruitment for terrorist groups, calls to violence (distinguished from scripture/history discussion)",
      action: "Hold + escalate",
   },
   { id: "charity_scam", example: 'Fake zakat/sadaqah/fundraising, crypto doubling, "send to this account"', action: "Hold; auto-hide if high confidence + low trust" },
   { id: "impersonation", example: "Posing as a verified scholar/institution", action: "Hold" },
   { id: "harassment", example: "Targeted insults, doxxing", action: "Hold" },
   { id: "spam", example: "Repeated links, SEO spam, promotion unrelated to content", action: "Auto-hide (reversible)" },
   { id: "sexual", example: "Explicit content (not fiqh discussion)", action: "Hold (auto-hide on images)" },
   { id: "misinfo_health", example: 'Dangerous medical claims (e.g. "stop insulin, use only…")', action: "Flag for review" },
   {
      id: "religious_authenticity",
      example: "Fabricated hadith attribution, flagged for scholar review, never auto-actioned",
      action: "Flag only",
   },
] as const;

export type PolicyCategory = (typeof BASE_CATEGORIES)[number]["id"] | (typeof EXTENSION_CATEGORIES)[number]["id"];

export const POLICY_CATEGORY_IDS: PolicyCategory[] = [...BASE_CATEGORIES.map((c) => c.id), ...EXTENSION_CATEGORIES.map((c) => c.id)];

/** §1 principle 3 (Islamic context awareness), verbatim. */
export const ISLAMIC_CONTEXT_RULE =
   "Quoting Qur'an verses about battles, discussing fiqh of marriage/purity, or historical accounts must not be flagged as violence or sexual content. " +
   "Conversely, catch harms specific to our community (sectarian takfir/hate, fake charity scams, impersonation of scholars).";

/** The policy as prompt text (stable: it is part of the cached system prompt and of PROMPT_VERSION). */
export function policyText(): string {
   const base = BASE_CATEGORIES.map((c) => `- ${c.id}: ${c.label}`).join("\n");
   const ext = EXTENSION_CATEGORIES.map((c) => `- ${c.id}: ${c.example} (on user content: ${c.action})`).join("\n");
   return `Base categories:\n${base}\n\nPlatform extensions:\n${ext}\n\nIslamic context: ${ISLAMIC_CONTEXT_RULE}`;
}
