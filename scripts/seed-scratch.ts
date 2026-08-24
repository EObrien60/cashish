#!/usr/bin/env tsx
/**
 * Seeds a throwaway database for exercising the MCP server and the integration
 * surface. Refuses to run unless DATABASE_URL names a scratch path, because the
 * default is the real book.
 *
 *   DATABASE_URL=./cashish-scratch.db npm run seed:scratch
 */
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/scratch|test/i.test(url)) {
    console.error(
      `refusing to seed ${url || "the default database"} — point DATABASE_URL at a path containing "scratch" or "test"`,
    );
    process.exit(1);
  }

  // Imported after the guard: importing the client opens whatever DATABASE_URL names.
  const { db, schema } = await import("../src/db/client");
  const { boot } = await import("../src/lib/boot");
  const { createCustomer } = await import("../src/lib/customers");
  const { createInvoice } = await import("../src/lib/invoices");
  const { uid } = await import("../src/lib/id");

  boot();

  // A miniature version of the real job: bank inflows that arrived, one invoice
  // that explains one of them, and one that nothing explains.
  const { customer } = createCustomer({ name: "Breakthrough Maths", email: "accounts@btm.test" });
  createInvoice({
    customerId: customer.id,
    status: "sent",
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    lines: [{ description: "Support — July", quantity: 1, unitPrice: 5000, vatRateId: null, productId: null }],
  });

  const rows = [
    { id: "tx-1", bookedDate: "2026-07-18", amount: 5000, description: "BREAKTHROUGH MATHS LTD PAYMENT", payer: "Breakthrough Maths" },
    { id: "tx-2", bookedDate: "2026-07-20", amount: 2500, description: "SOME OTHER CLIENT TRANSFER", payer: "Other Co" },
    { id: "tx-3", bookedDate: "2026-07-21", amount: -49.99, description: "HETZNER CLOUD", payer: "" },
  ];
  for (const row of rows) {
    db.insert(schema.transactions)
      .values({
        id: row.id,
        bookedDate: row.bookedDate,
        amount: row.amount,
        description: row.description,
        payer: row.payer,
        importBatch: uid(),
      })
      .run();
  }

  console.log(`seeded ${url}: 1 customer, 1 invoice, ${rows.length} transactions`);
}

main();
