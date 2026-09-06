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
 *
 * This default is also one the AI Gateway FREE TIER will actually serve, which
 * is not true of most of them: claude-haiku-4.5 and gemini-3-flash both answer
 * 403 "free tier users do not have access to this model", and several others
 * rate-limit immediately. Verified against the gateway rather than assumed.
 * Override with AI_MODEL once the team has credits.
 */
export const REPORT_MODEL = process.env.AI_MODEL || "openai/gpt-5.4-mini";

// There is deliberately NO fallback model list.
//
// One was tried — quietly swapping to a smaller model when the first was
// unavailable — and it made the rule proposer return an empty array while the
// intended model was producing fifteen good suggestions. The failure was
// invisible: no error, no warning, just a feature that appeared to have nothing
// to say. A weaker answer nobody asked for is worse than an error, because an
// error can be read. If the configured model cannot be reached, that is what
// gets reported, and AI_MODEL is how it gets changed.

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
  // The gateway's own errors do not always arrive as APICallError — a
  // rate limit surfaces as "Failed after 3 attempts. Last error:
  // GatewayRateLimitError: …", which is a stack trace pretending to be a
  // sentence. Matched by name so the page can say something useful.
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/GatewayRateLimitError|rate-limited/i.test(text)) {
    return {
      ok: false,
      reason:
        "The AI Gateway free tier rate-limited this request. Add credits, or try again in a minute.",
    };
  }
  if (/free tier users do not have access/i.test(text)) {
    return {
      ok: false,
      reason:
        "This AI Gateway plan does not include the configured model. Set AI_MODEL to one it allows, or add credits.",
    };
  }

  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 402:
        return { ok: false, reason: "The AI budget for this month is spent." };
      case 403:
        // What a free team gets for asking for a model it cannot have. Worth
        // saying plainly, because the fix is a setting rather than a retry.
        return {
          ok: false,
          reason:
            "This AI Gateway plan does not include the configured model. Set AI_MODEL to one the plan allows, or add credits.",
        };
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
