#!/usr/bin/env tsx
/**
 * Seeds a throwaway tenant for exercising the MCP server and the integration
 * surface. Refuses to run unless DATABASE_URL names a scratch or test database.
 *
 *   DATABASE_URL=postgres://…/cashish_scratch npm run seed:scratch
 */
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/scratch|test/i.test(url)) {
    console.error(
      `refusing to seed ${url || "the default database"} — point DATABASE_URL at a database whose name contains "scratch" or "test"`,
    );
    process.exit(1);
  }

  // Imported after the guard: importing the client opens whatever DATABASE_URL names.
  const { db, schema, pool } = await import("@cashish/core/db");
  const { createTenant } = await import("../src/db/seed");
  const { runInTenant } = await import("@cashish/core/db");
  const { createCustomer } = await import("../src/lib/customers");
  const { createInvoice } = await import("../src/lib/invoices");
  const { uid } = await import("../src/lib/id");

  const slug = `scratch-${uid().slice(0, 8)}`;
  const tenantId = await createTenant({ slug, name: "Scratch Books" });

  await runInTenant({ tenantId, role: "owner", actor: "seed-scratch" }, async () => {
    // A miniature version of the real job: bank inflows that arrived, one invoice
    // that explains one of them, and one that nothing explains.
    const { customer } = await createCustomer({
      name: "Breakthrough Maths",
      email: "accounts@btm.test",
    });
    await createInvoice({
      customerId: customer.id,
      status: "sent",
      issueDate: "2026-07-01",
      dueDate: "2026-07-15",
      lines: [
        { description: "Support — July", quantity: 1, unitPrice: 5000, vatRateId: null, productId: null },
      ],
    });

    const rows = [
      { id: "tx-1", bookedDate: "2026-07-18", amount: 5000, description: "BREAKTHROUGH MATHS LTD PAYMENT", payer: "Breakthrough Maths" },
      { id: "tx-2", bookedDate: "2026-07-20", amount: 2500, description: "SOME OTHER CLIENT TRANSFER", payer: "Other Co" },
      { id: "tx-3", bookedDate: "2026-07-21", amount: -49.99, description: "HETZNER CLOUD", payer: "" },
    ];
    await db.insert(schema.transactions).values(
      rows.map((row) => ({ ...row, tenantId, importBatch: uid() })),
    );

    console.log(`seeded tenant ${slug} (${tenantId})`);
    console.log(`  1 customer, 1 invoice, ${rows.length} transactions`);
    console.log(`  DATABASE_URL=${url} CASHISH_TENANT=${slug} npm run mcp`);
  });

  await pool.end();
}

main();
