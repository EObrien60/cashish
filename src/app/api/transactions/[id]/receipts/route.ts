import { boot } from "@/lib/boot";
import { listReceiptsFor } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  boot();
  const { id } = await params;
  return Response.json(listReceiptsFor(id));
}
