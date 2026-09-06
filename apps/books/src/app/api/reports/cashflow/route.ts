import { withTenant } from "@/lib/request-context";
import { buildCashflowForecast, defaultWindow } from "@/lib/cashflow";
import { cashflowFilename, cashflowWorkbook } from "@/lib/cashflow-xlsx";
import { getSettings } from "@/lib/lookups";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
// ExcelJS is a Node library; it does not run on the Edge runtime.
export const runtime = "nodejs";

// The forecast as a downloadable workbook. Session-authenticated like the other
// file routes, because this is the browser asking for its own tenant's sheet.
export async function GET(request: Request) {
  return withTenant(async () => {
    const url = new URL(request.url);
    const fallback = defaultWindow(todayISO());
    const from = url.searchParams.get("from") || fallback.from;
    const to = url.searchParams.get("to") || fallback.to;
    const lookbackParam = Number(url.searchParams.get("lookback"));

    if (to < from) {
      return Response.json({ error: "The end of the window is before its start." }, { status: 400 });
    }

    const forecast = await buildCashflowForecast({
      from,
      to,
      ...(Number.isFinite(lookbackParam) && lookbackParam > 0
        ? { lookbackMonths: lookbackParam }
        : {}),
    });

    const settings = await getSettings();
    const businessName = settings?.businessName || "cashish";
    const workbook = await cashflowWorkbook(forecast, businessName);

    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${cashflowFilename(forecast, businessName)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
