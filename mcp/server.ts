#!/usr/bin/env tsx
/**
 * Cashish as an MCP server.
 *
 * Built for the job of getting books *into* cashish: look at bank transactions,
 * write rules that categorise them, build up customers, raise the invoices that
 * explain the money that arrived, and match payments to them. That work is mostly
 * judgement plus a lot of typing, which is exactly what an agent is good for.
 *
 *   npm run mcp                      read-only
 *   CASHISH_MCP_WRITE=true npm run mcp   with the write tools
 *
 * Every tool goes through src/lib/*, the same code the UI uses, so nothing here
 * reimplements a query or a total. Writes are off by default because they change
 * real books.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { db, schema } from "../src/db/client";
import { boot } from "../src/lib/boot";
import {
  createCustomer,
  findCustomerByName,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../src/lib/customers";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  nextInvoiceNumber,
  recordPayment,
  setInvoiceStatus,
} from "../src/lib/invoices";
import { buildIntegrationSummary } from "../src/lib/integration";
import { openInvoices, reconcileReport, suggestMatches, unmatchedInflows } from "../src/lib/reconcile";
import { dashboardStats, monthlyCashflow, profitAndLoss } from "../src/lib/reports";
import {
  applyRulesToTransactions,
  applyRulesToUncategorized,
  firstMatch,
  listRules,
  ruleMatches,
  saveRule,
  deleteRule,
} from "../src/lib/rules";
import { bulkCategorize, listTransactions, updateTransaction } from "../src/lib/transactions";
import { computeVatReturn } from "../src/lib/vat";
import { countDue, generateDue, listRecurring, saveRecurring } from "../src/lib/recurring";

const WRITES_ENABLED = process.env.CASHISH_MCP_WRITE === "true";

boot();

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

const server = new McpServer({ name: "cashish", version: "1.0.0" });

/* ----------------------------------------------------------------- reading --- */

server.registerTool(
  "cashish_overview",
  {
    title: "Books overview",
    description:
      "Where the books stand: totals invoiced and received, what is outstanding and overdue, unmatched bank inflows, and how much is still uncategorised. Start here.",
    inputSchema: { asOf: z.string().optional().describe("ISO date, defaults to today") },
  },
  async ({ asOf }) => {
    const summary = buildIntegrationSummary(asOf);
    const rules = listRules();
    return text({
      asOf: summary.asOf,
      totals: summary.totals,
      bank: summary.bank,
      customers: summary.customers.length,
      recurring: summary.recurring.length,
      rules: { total: rules.length, enabled: rules.filter((r) => r.enabled).length },
      recurringDue: countDue(),
      writesEnabled: WRITES_ENABLED,
    });
  },
);

server.registerTool(
  "cashish_transactions",
  {
    title: "List bank transactions",
    description:
      "Bank transactions with filters. Use uncategorized:true to find what still needs a category, or direction:'in' to look at money received.",
    inputSchema: {
      from: z.string().optional(),
      to: z.string().optional(),
      search: z.string().optional(),
      direction: z.enum(["in", "out"]).optional(),
      uncategorized: z.boolean().optional(),
      categoryId: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
  },
  async ({ from, to, search, direction, uncategorized, categoryId, limit }) => {
    const rows = listTransactions({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(search ? { search } : {}),
      ...(direction ? { direction } : {}),
      ...(uncategorized ? { uncategorized } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
    const categories = new Map(db.select().from(schema.categories).all().map((c) => [c.id, c.name]));
    return text({
      count: rows.length,
      transactions: rows.slice(0, limit ?? 50).map((tx) => ({
        id: tx.id,
        date: tx.bookedDate,
        amount: tx.amount,
        description: tx.description,
        reference: tx.reference,
        payer: tx.payer,
        category: tx.categoryId ? (categories.get(tx.categoryId) ?? tx.categoryId) : null,
        reconciled: tx.reconciled,
      })),
    });
  },
);

server.registerTool(
  "cashish_categories",
  {
    title: "List categories and VAT rates",
    description: "The income and expense categories, and the VAT rates available to rules and invoice lines.",
    inputSchema: {},
  },
  async () =>
    text({
      categories: db.select().from(schema.categories).all().map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        vatApplicable: c.vatApplicable,
      })),
      vatRates: db.select().from(schema.vatRates).all(),
    }),
);

server.registerTool(
  "cashish_rules",
  {
    title: "List category rules",
    description: "The rules that auto-categorise transactions, in the order they are applied.",
    inputSchema: {},
  },
  async () => {
    const categories = new Map(db.select().from(schema.categories).all().map((c) => [c.id, c.name]));
    return text(
      listRules().map((rule) => ({
        id: rule.id,
        name: rule.name,
        match: `${rule.matchField} ${rule.matchType} "${rule.matchValue}"`,
        direction: rule.direction,
        category: rule.categoryId ? (categories.get(rule.categoryId) ?? rule.categoryId) : null,
        enabled: rule.enabled,
        sortOrder: rule.sortOrder,
        timesApplied: rule.timesApplied,
      })),
    );
  },
);

server.registerTool(
  "cashish_test_rule",
  {
    title: "Test a rule before saving it",
    description:
      "Dry run: shows which transactions a rule would match, and how many of them another rule already claims. Nothing is written. Use this before cashish_save_rule.",
    inputSchema: {
      matchField: z.enum(["description", "reference", "payer", "mcc", "any"]).default("description"),
      matchType: z.enum(["contains", "equals", "startsWith", "regex"]).default("contains"),
      matchValue: z.string(),
      direction: z.enum(["any", "in", "out"]).default("any"),
      limit: z.number().int().positive().max(100).optional(),
    },
  },
  async ({ matchField, matchType, matchValue, direction, limit }) => {
    const candidate = {
      id: "__test__",
      name: "test",
      matchField,
      matchType,
      matchValue,
      direction,
      categoryId: null,
      vatRateId: null,
      enabled: true,
      sortOrder: -1,
      timesApplied: 0,
      createdAt: "",
    } as Parameters<typeof ruleMatches>[0];

    const existing = listRules().filter((rule) => rule.enabled);
    const all = listTransactions();
    const matched = all.filter((tx) => ruleMatches(candidate, tx));
    const categories = new Map(db.select().from(schema.categories).all().map((c) => [c.id, c.name]));

    return text({
      wouldMatch: matched.length,
      ofTotal: all.length,
      alreadyClaimedByAnotherRule: matched.filter((tx) => firstMatch(existing, tx) !== null).length,
      uncategorisedAmongMatches: matched.filter((tx) => !tx.categoryId).length,
      sample: matched.slice(0, limit ?? 15).map((tx) => ({
        date: tx.bookedDate,
        amount: tx.amount,
        description: tx.description,
        currentCategory: tx.categoryId ? (categories.get(tx.categoryId) ?? tx.categoryId) : null,
      })),
    });
  },
);

server.registerTool(
  "cashish_customers",
  {
    title: "List customers",
    description: "Customers with their invoiced, received and outstanding balances.",
    inputSchema: { search: z.string().optional(), includeArchived: z.boolean().optional() },
  },
  async ({ search, includeArchived }) => {
    const summary = new Map(buildIntegrationSummary().customers.map((c) => [c.id, c]));
    return text(
      listCustomers({
        ...(search ? { search } : {}),
        ...(includeArchived ? { includeArchived } : {}),
      }).map((customer) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        vatNumber: customer.vatNumber,
        archived: customer.archived,
        balances: summary.get(customer.id)
          ? {
              invoiced: summary.get(customer.id)!.invoicedTotal,
              outstanding: summary.get(customer.id)!.outstanding,
              overdue: summary.get(customer.id)!.overdue,
            }
          : null,
      })),
    );
  },
);

server.registerTool(
  "cashish_invoices",
  {
    title: "List invoices",
    description: "Invoices, newest first, with what is still outstanding on each.",
    inputSchema: { status: z.string().optional(), customerId: z.string().optional() },
  },
  async ({ status, customerId }) => {
    const names = new Map(listCustomers({ includeArchived: true }).map((c) => [c.id, c.name]));
    return text(
      listInvoices()
        .filter((invoice) => (status ? invoice.status === status : true))
        .filter((invoice) => (customerId ? invoice.customerId === customerId : true))
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          customer: names.get(invoice.customerId) ?? invoice.customerId,
          status: invoice.status,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          total: invoice.total,
          paid: invoice.amountPaid,
          outstanding: Math.round((invoice.total - invoice.amountPaid) * 100) / 100,
        })),
    );
  },
);

server.registerTool(
  "cashish_invoice",
  {
    title: "Get one invoice",
    description: "One invoice in full: lines, VAT and payments.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const invoice = getInvoice(id);
    return invoice ? text(invoice) : fail(`No invoice ${id}`);
  },
);

server.registerTool(
  "cashish_reconcile",
  {
    title: "Reconcile bank inflows against invoices",
    description:
      "The migration workhorse. Splits unmatched money received into three lists: inflows that confidently settle a known invoice, inflows that need a human decision, and inflows with no candidate at all — those usually need an invoice raising, possibly copied from the old system.",
    inputSchema: {
      from: z.string().optional(),
      to: z.string().optional(),
      minAmount: z.number().optional().describe("Ignore small inflows, e.g. interest"),
    },
  },
  async ({ from, to, minAmount }) => {
    const report = reconcileReport({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(minAmount !== undefined ? { minAmount } : {}),
    });
    return text({
      ...report,
      hint: WRITES_ENABLED
        ? "Use cashish_match_payment to settle a confident match, or cashish_create_invoice for one that needs an invoice."
        : "Read-only: start with CASHISH_MCP_WRITE=true to act on these.",
    });
  },
);

server.registerTool(
  "cashish_unmatched_inflows",
  {
    title: "Money in with nothing to explain it",
    description: "Bank inflows with no invoice payment linked to them.",
    inputSchema: { from: z.string().optional(), to: z.string().optional(), minAmount: z.number().optional() },
  },
  async ({ from, to, minAmount }) =>
    text({
      openInvoices: openInvoices(),
      inflows: unmatchedInflows({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(minAmount !== undefined ? { minAmount } : {}),
      }),
    }),
);

server.registerTool(
  "cashish_recurring",
  {
    title: "Recurring invoices",
    description: "Recurring invoice schedules, their next run dates, and how many are due now.",
    inputSchema: {},
  },
  async () => text({ due: countDue(), schedules: listRecurring() }),
);

server.registerTool(
  "cashish_reports",
  {
    title: "Reports",
    description: "Profit and loss, monthly cashflow, dashboard stats and the cash-basis VAT return for a period.",
    inputSchema: {
      from: z.string().describe("ISO date"),
      to: z.string().describe("ISO date"),
      include: z.array(z.enum(["pnl", "cashflow", "dashboard", "vat"])).optional(),
    },
  },
  async ({ from, to, include }) => {
    const want = new Set(include ?? ["pnl", "dashboard", "vat"]);
    return text({
      period: { from, to },
      ...(want.has("pnl") ? { profitAndLoss: profitAndLoss(from, to) } : {}),
      ...(want.has("cashflow") ? { cashflow: monthlyCashflow(from, to) } : {}),
      ...(want.has("dashboard") ? { dashboard: dashboardStats(from, to) } : {}),
      ...(want.has("vat") ? { vatReturn: computeVatReturn(from, to) } : {}),
    });
  },
);

server.registerTool(
  "cashish_integration_summary",
  {
    title: "The integration summary",
    description:
      "Exactly what other systems (Lunar) consume: per-customer balances, recurring schedules and top-line totals. State, not ledger.",
    inputSchema: { asOf: z.string().optional() },
  },
  async ({ asOf }) => text(buildIntegrationSummary(asOf)),
);

/* ----------------------------------------------------------------- writing --- */

const writeGuard = () =>
  fail(
    "Write tools are disabled. Restart with CASHISH_MCP_WRITE=true — these change real books, so they are off by default.",
  );

server.registerTool(
  "cashish_save_rule",
  {
    title: "Create or update a category rule",
    description:
      "Saves a rule. Run cashish_test_rule first to see what it would catch. Pass applyNow to categorise matching transactions immediately.",
    inputSchema: {
      id: z.string().optional().describe("Omit to create"),
      name: z.string().optional(),
      matchField: z.enum(["description", "reference", "payer", "mcc", "any"]).default("description"),
      matchType: z.enum(["contains", "equals", "startsWith", "regex"]).default("contains"),
      matchValue: z.string(),
      direction: z.enum(["any", "in", "out"]).default("any"),
      categoryId: z.string().nullable().optional().describe("Category to assign; null leaves it uncategorised"),
      vatRateId: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      applyNow: z.enum(["none", "uncategorised", "all"]).default("uncategorised"),
    },
  },
  async ({ id, name, matchField, matchType, matchValue, direction, categoryId, vatRateId, enabled, applyNow }) => {
    if (!WRITES_ENABLED) return writeGuard();
    saveRule({
      ...(id ? { id } : {}),
      name: name ?? matchValue,
      matchField,
      matchType,
      matchValue,
      direction,
      categoryId: categoryId ?? null,
      vatRateId: vatRateId ?? null,
      enabled: enabled ?? true,
    } as Parameters<typeof saveRule>[0]);

    let applied = null;
    if (applyNow === "uncategorised") applied = applyRulesToUncategorized();
    if (applyNow === "all") {
      applied = applyRulesToTransactions(listTransactions(), { onlyUncategorized: false });
    }

    return text({ ok: true, rules: listRules().length, applied });
  },
);

server.registerTool(
  "cashish_delete_rule",
  { title: "Delete a category rule", description: "Removes a rule. Categories already applied are left alone.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    if (!WRITES_ENABLED) return writeGuard();
    deleteRule(id);
    return text({ ok: true, remaining: listRules().length });
  },
);

server.registerTool(
  "cashish_apply_rules",
  {
    title: "Apply rules to transactions",
    description:
      "Runs the enabled rules. By default only over uncategorised transactions, so manual categorisations survive; overwrite:true re-categorises everything.",
    inputSchema: { overwrite: z.boolean().optional() },
  },
  async ({ overwrite }) => {
    if (!WRITES_ENABLED) return writeGuard();
    return text(
      overwrite
        ? applyRulesToTransactions(listTransactions(), { onlyUncategorized: false })
        : applyRulesToUncategorized(),
    );
  },
);

server.registerTool(
  "cashish_categorise",
  {
    title: "Categorise transactions directly",
    description: "Sets a category on specific transactions, for the ones no rule should exist for.",
    inputSchema: { transactionIds: z.array(z.string()).min(1), categoryId: z.string().nullable() },
  },
  async ({ transactionIds, categoryId }) => {
    if (!WRITES_ENABLED) return writeGuard();
    bulkCategorize(transactionIds, categoryId);
    return text({ ok: true, updated: transactionIds.length });
  },
);

server.registerTool(
  "cashish_note_transaction",
  {
    title: "Annotate a transaction",
    description: "Sets the note, VAT rate or reconciled flag on one transaction.",
    inputSchema: {
      id: z.string(),
      note: z.string().optional(),
      vatRateId: z.string().nullable().optional(),
      reconciled: z.boolean().optional(),
    },
  },
  async ({ id, note, vatRateId, reconciled }) => {
    if (!WRITES_ENABLED) return writeGuard();
    updateTransaction(id, {
      ...(note !== undefined ? { note } : {}),
      ...(vatRateId !== undefined ? { vatRateId } : {}),
      ...(reconciled !== undefined ? { reconciled } : {}),
    } as Parameters<typeof updateTransaction>[1]);
    return text({ ok: true, id });
  },
);

server.registerTool(
  "cashish_create_customer",
  {
    title: "Create a customer",
    description: "Creates a customer, or returns the existing one if the name already exists — safe to call repeatedly while working through bank descriptions.",
    inputSchema: {
      name: z.string(),
      email: z.string().optional(),
      vatNumber: z.string().optional(),
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (input) => {
    if (!WRITES_ENABLED) return writeGuard();
    const { customer, created } = createCustomer(input);
    return text({ created, customer });
  },
);

server.registerTool(
  "cashish_update_customer",
  { title: "Update a customer", description: "Changes customer details.", inputSchema: { id: z.string(), name: z.string().optional(), email: z.string().optional(), vatNumber: z.string().optional(), notes: z.string().optional() } },
  async ({ id, ...patch }) => {
    if (!WRITES_ENABLED) return writeGuard();
    const customer = updateCustomer(id, patch);
    return customer ? text(customer) : fail(`No customer ${id}`);
  },
);

server.registerTool(
  "cashish_create_invoice",
  {
    title: "Create an invoice",
    description:
      "Raises an invoice. For historic invoices copied from the old system, pass the original issue date and set status to 'sent' (or 'paid' and then record the payment). customerName is accepted instead of customerId and will match or create.",
    inputSchema: {
      customerId: z.string().optional(),
      customerName: z.string().optional().describe("Used if customerId is omitted"),
      status: z.enum(["draft", "sent", "paid", "partial", "void"]).default("sent"),
      issueDate: z.string().describe("ISO date"),
      dueDate: z.string().nullable().optional(),
      notes: z.string().optional(),
      terms: z.string().optional(),
      lines: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number().default(1),
            unitPrice: z.number().describe("Net, excluding VAT"),
            vatRateId: z.string().nullable().optional(),
            productId: z.string().nullable().optional(),
          }),
        )
        .min(1),
    },
  },
  async ({ customerId, customerName, status, issueDate, dueDate, notes, terms, lines }) => {
    if (!WRITES_ENABLED) return writeGuard();

    let resolvedId = customerId;
    if (!resolvedId && customerName) {
      resolvedId = (findCustomerByName(customerName) ?? createCustomer({ name: customerName }).customer).id;
    }
    if (!resolvedId) return fail("Provide customerId or customerName.");
    if (!getCustomer(resolvedId)) return fail(`No customer ${resolvedId}`);

    const invoice = createInvoice({
      customerId: resolvedId,
      status,
      issueDate,
      dueDate: dueDate ?? null,
      notes: notes ?? "",
      terms: terms ?? "",
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRateId: line.vatRateId ?? null,
        productId: line.productId ?? null,
      })),
    });
    return text({ ok: true, nextNumberWouldBe: nextInvoiceNumber(), invoice });
  },
);

server.registerTool(
  "cashish_match_payment",
  {
    title: "Match a bank inflow to an invoice",
    description:
      "Records a payment against an invoice and links it to the bank transaction that settles it — the write half of cashish_reconcile. Amount and date default to the transaction's.",
    inputSchema: {
      invoiceId: z.string(),
      transactionId: z.string().optional(),
      amount: z.number().optional(),
      date: z.string().optional(),
      method: z.string().optional(),
      note: z.string().optional(),
    },
  },
  async ({ invoiceId, transactionId, amount, date, method, note }) => {
    if (!WRITES_ENABLED) return writeGuard();
    if (!getInvoice(invoiceId)) return fail(`No invoice ${invoiceId}`);

    let resolvedAmount = amount;
    let resolvedDate = date;
    if (transactionId) {
      const tx = listTransactions().find((row) => row.id === transactionId);
      if (!tx) return fail(`No transaction ${transactionId}`);
      resolvedAmount ??= tx.amount;
      resolvedDate ??= tx.bookedDate;
    }
    if (resolvedAmount === undefined || !resolvedDate) {
      return fail("Provide transactionId, or both amount and date.");
    }

    const invoice = recordPayment(invoiceId, {
      date: resolvedDate,
      amount: resolvedAmount,
      method: method ?? "bank",
      transactionId: transactionId ?? null,
      note: note ?? "",
    });
    return text({ ok: true, invoice });
  },
);

server.registerTool(
  "cashish_set_invoice_status",
  { title: "Set an invoice status", description: "Forces a status: draft, sent, paid, partial or void.", inputSchema: { id: z.string(), status: z.enum(["draft", "sent", "paid", "partial", "void"]) } },
  async ({ id, status }) => {
    if (!WRITES_ENABLED) return writeGuard();
    setInvoiceStatus(id, status);
    return text({ ok: true, invoice: getInvoice(id) });
  },
);

server.registerTool(
  "cashish_save_recurring",
  {
    title: "Create or update a recurring invoice",
    description: "A schedule that raises invoices automatically — the right home for a monthly retainer.",
    inputSchema: {
      id: z.string().optional(),
      name: z.string().optional(),
      customerId: z.string(),
      frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
      interval: z.number().int().positive().default(1),
      startDate: z.string(),
      endDate: z.string().nullable().optional(),
      dueDays: z.number().int().nonnegative().default(14).describe("Payment terms in days"),
      autoSend: z.boolean().default(false),
      notes: z.string().optional(),
      terms: z.string().optional(),
      lines: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number().default(1),
            unitPrice: z.number(),
            vatRateId: z.string().nullable().optional(),
          }),
        )
        .min(1),
    },
  },
  async ({ id, name, customerId, frequency, interval, startDate, endDate, dueDays, autoSend, notes, terms, lines }) => {
    if (!WRITES_ENABLED) return writeGuard();
    saveRecurring({
      ...(id ? { id } : {}),
      name: name ?? "",
      customerId,
      frequency,
      interval,
      startDate,
      endDate: endDate ?? null,
      dueDays,
      autoSend,
      notes: notes ?? "",
      terms: terms ?? "",
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRateId: line.vatRateId ?? null,
      })),
    });
    return text({ ok: true, schedules: listRecurring().length, due: countDue() });
  },
);

server.registerTool(
  "cashish_generate_due_recurring",
  { title: "Raise invoices that recurring schedules are due", description: "Generates the invoices any active schedule is due, as opening the app would.", inputSchema: {} },
  async () => {
    if (!WRITES_ENABLED) return writeGuard();
    return text(generateDue());
  },
);

// The package is CommonJS (no "type": "module"), so top-level await is out.
async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  // stdout is the protocol channel — diagnostics must go to stderr.
  console.error("cashish mcp failed to start:", error);
  process.exit(1);
});
