/** Editor-facing sentences for AI assist failures (no DOM: shared with the unit tests). Never a raw error. */
export interface AiErrorStrings {
   errors: Record<"rate_limited" | "too_long" | "empty" | "declined" | "not_configured" | "unavailable" | "failed" | "budget_reached", string>;
}

/** A job that finished as failed (its error code is the message). */
export class AiFailure extends Error {}

interface HttpError {
   status: number;
   body: unknown;
}
const isHttpError = (e: unknown): e is HttpError => !!e && typeof e === "object" && typeof (e as HttpError).status === "number" && "body" in (e as object);

export function aiErrorText(T: AiErrorStrings, e: unknown): string {
   if (isHttpError(e)) {
      const b = (e.body ?? {}) as { error?: string; retryAfter?: number };
      if (e.status === 429) return T.errors.rate_limited.replace("{n}", String(Math.max(1, Math.ceil((b.retryAfter ?? 60) / 60))));
      if (e.status === 413) return T.errors.too_long;
      if (b.error === "budget_reached") return T.errors.budget_reached;
      if (b.error === "empty") return T.errors.empty;
      if (b.error === "ai_not_configured") return T.errors.not_configured;
      if (e.status === 503) return T.errors.unavailable;
      return T.errors.failed;
   }
   if (e instanceof AiFailure) {
      if (e.message === "declined") return T.errors.declined;
      if (e.message === "not_configured") return T.errors.not_configured;
      if (e.message === "budget_reached") return T.errors.budget_reached;
      return T.errors.failed;
   }
   return T.errors.failed;
}
