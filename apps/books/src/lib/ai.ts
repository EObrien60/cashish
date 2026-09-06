import { APICallError } from "ai";

// ---------------------------------------------------------------------------
// Talking to a model, through the Vercel AI Gateway.
//
// One place, so that the model choice, the spend tags and the failure handling
// are decided once. Plain "provider/model" strings route through the gateway on
// their own; no wrapper is needed unless routing options are.
//
// Authentication is OIDC on Vercel (VERCEL_OIDC_TOKEN, refreshed automatically)
// or AI_GATEWAY_API_KEY anywhere else. Neither being present is not an error —
// it means this deployment has no AI features, and every caller here degrades
// to saying so rather than throwing. cashish has to work without them: a set of
// books that stops balancing because a model is unreachable would be a poor
// trade for a paragraph of commentary.
// ---------------------------------------------------------------------------

/**
 * Cheap enough to run over a whole ledger, capable enough to be worth reading.
 *
 * Deliberately not the biggest model available. Everything asked of it here is
 * summarising and classifying against facts it has been handed — no arithmetic,
 * no retrieval, no long chains of reasoning — and paying four times as much per
 * token to describe the same numbers is money for nothing.
 */
export const REPORT_MODEL = "anthropic/claude-haiku-4.5";

export function aiIsConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

export type AiFailure = { ok: false; reason: string };
export type AiSuccess<T> = { ok: true; value: T; usage?: { input: number; output: number } };
export type AiResult<T> = AiSuccess<T> | AiFailure;

/** Spend attribution, so a bill can be traced to a feature and a book. */
export function gatewayOptions(feature: string, tenantId: string) {
  return {
    gateway: {
      user: tenantId,
      tags: [`feature:${feature}`, `env:${process.env.VERCEL_ENV ?? "development"}`],
    },
  };
}

/**
 * Turns the ways a gateway call can fail into something a page can render.
 *
 * A budget cap, a rate limit and an outage are all "no report today", and none
 * of them should be a stack trace on a page about somebody's money.
 */
export function describeFailure(error: unknown): AiFailure {
  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 402:
        return { ok: false, reason: "The AI budget for this month is spent." };
      case 429:
        return { ok: false, reason: "Too many requests just now — try again in a minute." };
      case 503:
        return { ok: false, reason: "The model provider is unavailable at the moment." };
      default:
        return { ok: false, reason: `The model could not be reached (${error.statusCode}).` };
    }
  }
  return { ok: false, reason: error instanceof Error ? error.message : "Unknown error." };
}
