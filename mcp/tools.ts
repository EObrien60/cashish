/**
 * The cashish MCP tool set — one definition, two transports.
 *
 * mcp/stdio.ts serves it over stdio for a local agent; src/app/api/mcp/route.ts
 * serves it over Streamable HTTP for the deployed service. Neither reimplements
 * a tool, and every tool calls the same src/lib functions the UI does.
 *
 * Writes are gated on the CALLER'S ROLE, not on an environment variable. The old
 * CASHISH_MCP_WRITE flag was a property of the process, which is meaningless once
 * one process serves several tenants and several credentials: a read-only API key
 * must not become a writer because the server happened to be started with writes
 * on. The role arrives with the credential and is checked through the same
 * capability map the UI uses.
 *
 * The tenant is already established by the caller (runInTenant), so nothing here
 * mentions a tenant — src/lib/* scopes itself.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { db, schema } from "../src/db/client";
import { can, type Role } from "../src/lib/rbac";
import { listCategories, listVatRates } from "../src/lib/lookups";
import {
  createCustomer,
  findCustomerByName,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../src/lib/customers";
import {
  createInvoice,
  deleteInvoice,
  deletePayment,
  getInvoice,
  listInvoices,
  nextInvoiceNumber,
  recordPayment,
  setInvoiceStatus,
} from "../src/lib/invoices";
import { buildIntegrationSummary } from "../src/lib/integration";
import { applyBatchMatch, openInvoices, reconcileReport, unmatchedInflows } from "../src/lib/reconcile";
import { dashboardStats, monthlyCashflow, profitAndLoss } from "../src/lib/reports";
import {
  applyRulesToAll,
  applyRulesToUncategorized,
  firstMatch,
  listRules,
  ruleMatches,
  saveRule,
  deleteRule,
} from "../src/lib/rules";
import {
  bulkCategorize,
  listTransactions,
  setExcluded,
  transactionCounts,
  updateTransaction,
} from "../src/lib/transactions";
import { computeVatReturn } from "../src/lib/vat";
import { countDue, generateDue, listRecurring, saveRecurring } from "../src/lib/recurring";

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

export function registerTools(server: McpServer, { role }: { role: Role }) {
  const canWrite = can(role, "books:write");

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
      const summary = await buildIntegrationSummary(asOf);
      const rules = await listRules();
      return text({
        asOf: summary.asOf,
        totals: summary.totals,
        bank: summary.bank,
        customers: summary.customers.length,
        recurring: summary.recurring.length,
        rules: { total: rules.length, enabled: rules.filter((r) => r.enabled).length },
        recurringDue: await countDue(),
        canWrite,
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
        excluded: z
          .enum(["hide", "only", "all"])
          .optional()
          .describe("hide (default) omits excluded transactions; only lists them; all shows both"),
        categoryId: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async ({ from, to, search, direction, uncategorized, categoryId, limit, excluded }) => {
      const rows = await listTransactions({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(search ? { search } : {}),
        ...(direction ? { direction } : {}),
        ...(uncategorized ? { uncategorized } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(excluded ? { excluded } : {}),
      });
      const categories = new Map((await listCategories()).map((c) => [c.id, c.name]));
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
        categories: (await listCategories()).map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          vatApplicable: c.vatApplicable,
        })),
        vatRates: await listVatRates(),
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
      const categories = new Map((await listCategories()).map((c) => [c.id, c.name]));
      return text(
        (await listRules()).map((rule) => ({
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

      const existing = (await listRules()).filter((rule) => rule.enabled);
      const all = await listTransactions();
      const matched = all.filter((tx) => ruleMatches(candidate, tx));
      const categories = new Map((await listCategories()).map((c) => [c.id, c.name]));

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
      const summary = new Map((await buildIntegrationSummary()).customers.map((c) => [c.id, c]));
      return text(
        (await listCustomers({
          ...(search ? { search } : {}),
          ...(includeArchived ? { includeArchived } : {}),
        })).map((customer) => ({
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
      const names = new Map((await listCustomers({ includeArchived: true })).map((c) => [c.id, c.name]));
      return text(
        (await listInvoices())
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
      const invoice = await getInvoice(id);
      return invoice ? text(invoice) : fail(`No invoice ${id}`);
    },
  );

  server.registerTool(
    "cashish_reconcile",
    {
      title: "Reconcile bank inflows against invoices",
      description:
        "The migration workhorse. Splits unmatched money received into four lists: inflows that confidently settle a known invoice, transfers that settle SEVERAL invoices at once (batchMatches), inflows that need a human decision, and inflows with no candidate at all — those usually need an invoice raising, possibly copied from the old system. A batch is never confident: check the set and any shortfall, then write it with cashish_match_batch.",
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        minAmount: z.number().optional().describe("Ignore small inflows, e.g. interest"),
      },
    },
    async ({ from, to, minAmount }) => {
      const report = await reconcileReport({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(minAmount !== undefined ? { minAmount } : {}),
      });
      return text({
        ...report,
        hint: canWrite
          ? "Use cashish_match_payment for a confident match, cashish_match_batch for one transfer covering several invoices, or cashish_create_invoice for money with no invoice behind it."
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
        openInvoices: await openInvoices(),
        inflows: await unmatchedInflows({
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
    async () => text({ due: await countDue(), schedules: await listRecurring() }),
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
        ...(want.has("pnl") ? { profitAndLoss: await profitAndLoss(from, to) } : {}),
        ...(want.has("cashflow") ? { cashflow: await monthlyCashflow(from, to) } : {}),
        ...(want.has("dashboard") ? { dashboard: await dashboardStats(from, to) } : {}),
        ...(want.has("vat") ? { vatReturn: await computeVatReturn(from, to) } : {}),
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
    async ({ asOf }) => text(await buildIntegrationSummary(asOf)),
  );

  /* ----------------------------------------------------------------- writing --- */

  const writeGuard = () =>
      fail(
        `This credential has the "${role}" role, which cannot change the books. ` +
          "Ask an owner for a key or token with the accountant or owner role.",
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
      if (!canWrite) return writeGuard();
      await saveRule({
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
      if (applyNow === "uncategorised") applied = await applyRulesToUncategorized();
      if (applyNow === "all") {
        applied = await applyRulesToAll();
      }

      return text({ ok: true, rules: (await listRules()).length, applied });
    },
  );

  server.registerTool(
    "cashish_delete_rule",
    { title: "Delete a category rule", description: "Removes a rule. Categories already applied are left alone.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      if (!canWrite) return writeGuard();
      await deleteRule(id);
      return text({ ok: true, remaining: (await listRules()).length });
    },
  );

  server.registerTool(
    "cashish_apply_rules",
    {
      title: "Apply rules to transactions",
      description:
        "Re-applies the enabled rules across the whole ledger, including transactions that already have a category — so a corrected rule fixes the history it got wrong. A category no rule matches is left alone, and excluded transactions are skipped. Pass onlyUncategorised to leave existing categories untouched.",
      inputSchema: { onlyUncategorised: z.boolean().optional() },
    },
    async ({ onlyUncategorised }) => {
      if (!canWrite) return writeGuard();
      return text(onlyUncategorised ? await applyRulesToUncategorized() : await applyRulesToAll());
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
      if (!canWrite) return writeGuard();
      await bulkCategorize(transactionIds, categoryId);
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
      if (!canWrite) return writeGuard();
      await updateTransaction(id, {
        ...(note !== undefined ? { note } : {}),
        ...(vatRateId !== undefined ? { vatRateId } : {}),
        ...(reconciled !== undefined ? { reconciled } : {}),
      } as Parameters<typeof updateTransaction>[1]);
      return text({ ok: true, id });
    },
  );

  server.registerTool(
    "cashish_exclude_transactions",
    {
      title: "Take transactions out of the books, or put them back",
      description:
        "Excluding keeps the row — so a statement still reconciles line for line — but counts it nowhere: not in reports, not in VAT, not in reconciliation, and not in what Lunar is told. Use it for internal pot transfers, personal spend on the wrong card, and duplicate imports. Excluding also clears the category, since the transaction is out of the books. Reversible with excluded:false.",
      inputSchema: {
        transactionIds: z.array(z.string()).min(1),
        excluded: z.boolean().default(true),
        reason: z
          .string()
          .optional()
          .describe("Why it is out of the books — worth recording, someone will ask"),
      },
    },
    async ({ transactionIds, excluded, reason }) => {
      if (!canWrite) return writeGuard();
      const result = await setExcluded(transactionIds, excluded, reason ?? "");
      return text({ ...result, counts: await transactionCounts() });
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
      if (!canWrite) return writeGuard();
      const { customer, created } = await createCustomer(input);
      return text({ created, customer });
    },
  );

  server.registerTool(
    "cashish_update_customer",
    { title: "Update a customer", description: "Changes customer details.", inputSchema: { id: z.string(), name: z.string().optional(), email: z.string().optional(), vatNumber: z.string().optional(), notes: z.string().optional() } },
    async ({ id, ...patch }) => {
      if (!canWrite) return writeGuard();
      const customer = await updateCustomer(id, patch);
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
        number: z
          .string()
          .optional()
          .describe(
            "The invoice's own number, for history copied from another system — the number on the document the customer already has. Omit for a new invoice to take the next in sequence.",
          ),
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
    async ({ customerId, customerName, number, status, issueDate, dueDate, notes, terms, lines }) => {
      if (!canWrite) return writeGuard();

      let resolvedId = customerId;
      if (!resolvedId && customerName) {
        const existing = await findCustomerByName(customerName);
        resolvedId = existing
          ? existing.id
          : (await createCustomer({ name: customerName })).customer.id;
      }
      if (!resolvedId) return fail("Provide customerId or customerName.");
      if (!(await getCustomer(resolvedId))) return fail(`No customer ${resolvedId}`);

      const invoice = await createInvoice({
        customerId: resolvedId,
        ...(number ? { number } : {}),
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
      return text({ ok: true, nextNumberWouldBe: await nextInvoiceNumber(), invoice });
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
      if (!canWrite) return writeGuard();
      if (!await getInvoice(invoiceId)) return fail(`No invoice ${invoiceId}`);

      let resolvedAmount = amount;
      let resolvedDate = date;
      if (transactionId) {
        const tx = (await listTransactions()).find((row) => row.id === transactionId);
        if (!tx) return fail(`No transaction ${transactionId}`);
        resolvedAmount ??= tx.amount;
        resolvedDate ??= tx.bookedDate;
      }
      if (resolvedAmount === undefined || !resolvedDate) {
        return fail("Provide transactionId, or both amount and date.");
      }

      const invoice = await recordPayment(invoiceId, {
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
    "cashish_match_batch",
    {
      title: "Match one bank inflow to several invoices",
      description:
        "Settles a batch: one transfer covering more than one invoice, as a client who pays the month's invoices in a single payment does. Comes from the batchMatches list in cashish_reconcile. Allocates oldest invoice first, so any shortfall lands on the newest of the set and leaves it partial. Refuses money out, a set of fewer than two invoices, and any invoice raised after the money arrived.",
      inputSchema: {
        transactionId: z.string(),
        invoiceIds: z.array(z.string()).min(2).describe("Every invoice the transfer settles"),
        date: z.string().optional().describe("Defaults to the transaction's booked date"),
        note: z.string().optional(),
      },
    },
    async ({ transactionId, invoiceIds, date, note }) => {
      if (!canWrite) return writeGuard();
      try {
        const result = await applyBatchMatch(transactionId, invoiceIds, {
          ...(date ? { date } : {}),
          ...(note ? { note } : {}),
        });
        return text({ ok: true, ...result });
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "cashish_delete_payment",
    {
      title: "Remove a recorded payment",
      description:
        "Deletes one payment from an invoice and recomputes that invoice's status. For a payment recorded in error, or one recorded without a link to the bank line that settled it — an unlinked payment leaves the invoice looking paid while the money still shows as an unexplained inflow, which is the same figure counted twice. Payment ids come from cashish_invoice.",
      inputSchema: { paymentId: z.string() },
    },
    async ({ paymentId }) => {
      if (!canWrite) return writeGuard();
      await deletePayment(paymentId);
      return text({ ok: true, deleted: paymentId });
    },
  );

  server.registerTool(
    "cashish_delete_invoice",
    {
      title: "Delete an invoice",
      description:
        "Removes an invoice with its lines and recorded payments. For a mistake — a duplicate, or an import that went in wrong. An invoice the customer has already been sent should be voided with cashish_set_invoice_status instead, so the number is not reused and the trail survives.",
      inputSchema: { id: z.string().describe("Invoice id, or its number") },
    },
    async ({ id }) => {
      if (!canWrite) return writeGuard();
      const invoice = await getInvoice(id) ?? (await listInvoices()).find((i) => i.number === id);
      if (!invoice) return fail(`No invoice ${id}`);
      await deleteInvoice(invoice.id);
      return text({ ok: true, deleted: { id: invoice.id, number: invoice.number, total: invoice.total } });
    },
  );

  server.registerTool(
    "cashish_set_invoice_status",
    { title: "Set an invoice status", description: "Forces a status: draft, sent, paid, partial or void.", inputSchema: { id: z.string(), status: z.enum(["draft", "sent", "paid", "partial", "void"]) } },
    async ({ id, status }) => {
      if (!canWrite) return writeGuard();
      await setInvoiceStatus(id, status);
      return text({ ok: true, invoice: await getInvoice(id) });
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
      if (!canWrite) return writeGuard();
      await saveRecurring({
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
      return text({ ok: true, schedules: (await listRecurring()).length, due: await countDue() });
    },
  );

  server.registerTool(
    "cashish_generate_due_recurring",
    { title: "Raise invoices that recurring schedules are due", description: "Generates the invoices any active schedule is due, as opening the app would.", inputSchema: {} },
    async () => {
      if (!canWrite) return writeGuard();
      return text(await generateDue());
    },
  );
}
