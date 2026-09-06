import { generateObject } from "ai";
import { z } from "zod";
import { REPORT_MODEL, aiIsConfigured, describeFailure, gatewayOptions, type AiResult } from "./ai";
import { buildFactSheet, type FactSheet } from "./insights";
import { tenantId } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// The written report.
//
// The model is handed a fact sheet and asked what is worth saying about it. It
// chooses the sections, the emphasis, and which charts to show — and it can
// only ask for a chart of a series THIS FILE computed. It cannot supply data
// points, because a chart is a claim about numbers and those numbers have to
// come from the ledger.
//
// Everything quoted in prose is likewise from the fact sheet. The prompt says
// so, and the render puts the app's own figures beside the narrative, so a
// mis-stated number is visible rather than authoritative.
// ---------------------------------------------------------------------------

const CHART_SERIES = ["months", "categories", "merchants", "position"] as const;

const ReportSchema = z.object({
  headline: z
    .string()
    .describe("One sentence a person could read and know how the period went."),
  sections: z
    .array(
      z.object({
        title: z.string(),
        body: z
          .string()
          .describe(
            "Two to four sentences. Quote figures only from the fact sheet, verbatim.",
          ),
        chart: z
          .object({
            series: z.enum(CHART_SERIES),
            kind: z.enum(["bars", "line", "breakdown"]),
            title: z.string(),
          })
          .nullable()
          .describe("A chart of one of the supplied series, or null for none."),
      }),
    )
    .min(2)
    .max(5),
  watchOut: z
    .array(z.string())
    .max(4)
    .describe("Things that look wrong or worth acting on. Empty if nothing does."),
});

export type AiReport = z.infer<typeof ReportSchema>;
export type ReportResult = AiResult<{ report: AiReport; facts: FactSheet }>;

const SYSTEM = `You write the monthly commentary for a bookkeeping app.

You are given a FACT SHEET computed from the ledger. Every figure you state must
be copied from it. You must not add, average, project or otherwise derive any
number — if a figure you want is not in the fact sheet, describe the shape of it
in words instead, or say it is not known.

Write plainly, for the person whose money it is. No filler, no "in conclusion",
no restating the question. Prefer the specific over the general: name the
merchant, name the category, give the figure.

If the books look untidy — a lot uncategorised, an account with no statement, a
cost that has jumped — say so directly in watchOut. That is more useful than
praise.

A chart must reference one of the supplied series by name. You are choosing
which view helps; the app draws it from its own data.`;

function factsForModel(facts: FactSheet) {
  // Trimmed deliberately: the model is given what it needs to comment on, not
  // the ledger. Fewer tokens, and nobody's individual transactions leave the
  // database.
  return {
    period: { from: facts.from, to: facts.to, currency: facts.currency, book: facts.bookKind },
    totals: facts.totals,
    months: facts.months,
    categories: facts.categories.slice(0, 15),
    topMerchants: facts.merchants.slice(0, 20),
    accounts: facts.accounts,
    position: facts.position,
    availableChartSeries: CHART_SERIES,
  };
}

export async function generateReport(input: {
  from: string;
  to: string;
}): Promise<ReportResult> {
  const facts = await buildFactSheet(input);

  if (!aiIsConfigured()) {
    return {
      ok: false,
      reason:
        "No AI credentials on this deployment. Set AI_GATEWAY_API_KEY, or enable AI Gateway on the Vercel project so OIDC provides one.",
    };
  }
  if (facts.months.length === 0) {
    return { ok: false, reason: "There are no transactions in this period to report on." };
  }

  try {
    const result = await generateObject({
      model: REPORT_MODEL,
      schema: ReportSchema,
      system: SYSTEM,
      prompt: `Fact sheet:\n\n${JSON.stringify(factsForModel(facts), null, 2)}`,
      providerOptions: gatewayOptions("insights-report", tenantId()),
    });

    return {
      ok: true,
      value: { report: result.object, facts },
      usage: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    };
  } catch (error) {
    return describeFailure(error);
  }
}
