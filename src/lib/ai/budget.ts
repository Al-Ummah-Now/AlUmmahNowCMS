/**
 * Monthly AI budget per environment (docs/AI_ASSIST_SPEC.md §5.1): the month-to-date estimate from
 * `ai_usage` against the admin's cap. Reaching it stops new jobs (HTTP 402 `budget_reached`) and stops
 * running ones before their next model call; the editor sees a plain sentence, admins see the spend.
 */
import type { AiSettings } from "./settings.ts";

export const monthStart = (now: number) => `${new Date(now).toISOString().slice(0, 8)}01`;

export async function monthSpendUsd(db: D1Database, env: string, now: number): Promise<number> {
   const row = await db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE day >= ?1 AND env = ?2").bind(monthStart(now), env).first<{ usd: number }>();
   return Math.round(Number(row?.usd ?? 0) * 1e6) / 1e6;
}

export interface BudgetState {
   capUsd: number | null;
   spentUsd: number;
   reached: boolean;
}

export async function budgetState(db: D1Database, env: string, settings: Pick<AiSettings, "monthlyBudgetUsd">, now: number): Promise<BudgetState> {
   const spentUsd = await monthSpendUsd(db, env, now);
   const capUsd = settings.monthlyBudgetUsd;
   return { capUsd, spentUsd, reached: capUsd !== null && spentUsd >= capUsd };
}
