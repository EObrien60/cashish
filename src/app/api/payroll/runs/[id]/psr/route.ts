import { boot } from "@/lib/boot";
import { buildPsr } from "@/lib/payroll";

export const dynamic = "force-dynamic";

// Downloads the PAYE Modernisation Payroll Submission Request (PSR) JSON for a
// pay run. Validate against ROS before filing live.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  boot();
  const { id } = await params;
  const psr = buildPsr(id, "0.2.0");
  if (!psr) return new Response("Not found", { status: 404 });
  const ref = psr.payrollSubmission.payrollRunReference;
  return new Response(JSON.stringify(psr, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="psr-${ref}.json"`,
    },
  });
}
