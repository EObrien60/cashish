import { withTenant } from "@/lib/request-context";
import { listReceiptsFor } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withTenant(async () => {
    const { id } = await params;
    return Response.json(await listReceiptsFor(id));
  });
}
