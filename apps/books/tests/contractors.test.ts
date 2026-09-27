/**
 * Contractors, timesheets, and the platform charge that pays them.
 *
 * Upwork charges one lump a week: everybody's hours plus its own fee. So the
 * numbers this file protects are the ones that make that lump legible — which
 * timesheets it paid, and how much of it was the platform's cut.
 *
 * The CSV below is a PLAUSIBLE Upwork client "Transaction History" export,
 * written from memory of the format. It has not been checked against a real
 * download; the aliases in lib/contractors.ts are there to absorb the
 * difference once one is.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import {
  importUpworkCsv,
  createContractor,
  createTimesheet,
  listContractors,
  listTimesheets,
  linkPayment,
  unlinkPayment,
  suggestPayments,
  contractorTotals,
} from "../src/lib/contractors";
import { uid } from "../src/lib/id";

const UPWORK_CSV = `"Date","Ref ID","Type","Description","Agency","Freelancer","Team","Account Name","PO","Amount","Amount in local currency","Currency","Balance"
"Sep 8, 2026","880001","Hourly","Invoice for 09/01/2026-09/07/2026 - 12:30 hrs @ €40.00/hr","","Xinyu Zhang","OBH Software","OBH","","-500.00","-500.00","EUR","-500.00"
"Sep 8, 2026","880002","Hourly","Invoice for 09/01/2026-09/07/2026 - 10:00 hrs @ €30.00/hr","","Lu Han","OBH Software","OBH","","-300.00","-300.00","EUR","-800.00"
"Sep 8, 2026","880003","Service Fee","Service Fee for Ref ID 880001","","","OBH Software","OBH","","-40.00","-40.00","EUR","-840.00"
"Sep 8, 2026","880004","Payment","Payment to Upwork","","","OBH Software","OBH","","840.00","840.00","EUR","0.00"
"Sep 10, 2026","880005","Fixed Price","Milestone 2: landing page","","Lu Han","OBH Software","OBH","","-150.00","-150.00","EUR","-150.00"
`;

let tenant: string;
before(async () => {
  tenant = (await makeTenant("contractors")).id;
});
after(closePool);

const addTx = (description: string, amount: number, bookedDate: string, t = tenant) =>
  asTenant(t, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({ id, tenantId: t, bookedDate, amount, description });
    return id;
  });

test("imports billing rows as timesheets and skips fees and funding", async () => {
  const r = await asTenant(tenant, () => importUpworkCsv(UPWORK_CSV));
  assert.equal(r.parsed, 5);
  assert.equal(r.imported, 3);
  assert.equal(r.skipped, 2);
  assert.equal(r.contractorsCreated, 2);
  assert.deepEqual(r.errors, []);

  const sheets = await asTenant(tenant, () => listTimesheets());
  const xinyu = sheets.find((s) => s.externalRef === "880001")!;
  assert.equal(xinyu.contractorName, "Xinyu Zhang");
  assert.equal(xinyu.hours, 12.5);
  assert.equal(xinyu.rate, 40);
  assert.equal(xinyu.amount, 500);
  assert.equal(xinyu.periodStart, "2026-09-01");
  assert.equal(xinyu.periodEnd, "2026-09-07");
  assert.equal(xinyu.source, "upwork_csv");
  assert.equal(xinyu.status, "unpaid");

  // A fixed-price milestone has an amount and no hours; it ends on its date.
  const milestone = sheets.find((s) => s.externalRef === "880005")!;
  assert.equal(milestone.hours, 0);
  assert.equal(milestone.amount, 150);
  assert.equal(milestone.periodEnd, "2026-09-10");

  const people = await asTenant(tenant, () => listContractors());
  assert.ok(people.every((c) => c.platform === "upwork"));
});

test("re-importing the same file inserts nothing", async () => {
  const r = await asTenant(tenant, () => importUpworkCsv(UPWORK_CSV));
  assert.equal(r.imported, 0);
  assert.equal(r.contractorsCreated, 0);
  assert.equal(r.duplicates, 3);
  assert.equal((await asTenant(tenant, () => listTimesheets())).length, 3);
});

test("a manual timesheet defaults its amount to hours × rate, rounded", async () => {
  const sheet = await asTenant(tenant, async () => {
    const { contractor } = await createContractor({ name: "Direct Dev", platform: "direct", defaultRate: 33.33 });
    return createTimesheet({ contractorId: contractor.id, periodEnd: "2026-09-14", hours: 7.5 });
  });
  assert.equal(sheet.rate, 33.33);
  assert.equal(sheet.amount, 249.98);
  assert.equal(sheet.source, "manual");
});

test("one Upwork charge pays many timesheets; the difference is the fee", async () => {
  const txId = await addTx("Upwork -REF 880004", -840, "2026-09-09");
  await addTx("Tesco", -840, "2026-09-09"); // same amount, not Upwork
  const sheets = await asTenant(tenant, () => listTimesheets());
  const weekly = sheets.filter((s) => s.externalRef === "880001" || s.externalRef === "880002");

  const suggestions = await asTenant(tenant, () => suggestPayments(weekly.map((s) => s.id)));
  assert.deepEqual(suggestions.map((s) => s.id), [txId]);
  assert.equal(suggestions[0].fee, 40);

  const link = await asTenant(tenant, () => linkPayment(txId, weekly.map((s) => s.id)));
  assert.equal(link.allocated, 800);
  assert.equal(link.fee, 40);

  const after = await asTenant(tenant, () => listTimesheets());
  for (const s of after.filter((x) => weekly.some((w) => w.id === x.id))) {
    assert.equal(s.status, "paid");
    assert.equal(s.paidBy[0]?.transactionId, txId);
  }

  const totals = await asTenant(tenant, () => contractorTotals());
  const xinyu = (await asTenant(tenant, () => listContractors())).find((c) => c.name === "Xinyu Zhang")!;
  assert.deepEqual(totals.get(xinyu.id), { hours: 12.5, billed: 500, paid: 500, unpaid: 0, count: 1 });

  // Already paid: linking again allocates nothing more.
  const again = await asTenant(tenant, () => linkPayment(txId, weekly.map((s) => s.id)));
  assert.equal(again.allocated, 0);

  await asTenant(tenant, () => unlinkPayment(weekly[0].id, txId));
  const undone = await asTenant(tenant, () => listTimesheets());
  assert.equal(undone.find((s) => s.id === weekly[0].id)!.status, "unpaid");
});

test("another tenant sees none of it and cannot link to it", async () => {
  const other = (await makeTenant("contractors-other")).id;
  assert.equal((await asTenant(other, () => listTimesheets())).length, 0);
  assert.equal((await asTenant(other, () => listContractors())).length, 0);

  const mine = await asTenant(tenant, () => listTimesheets());
  const theirTx = await addTx("Upwork", -100, "2026-09-09", other);
  await assert.rejects(asTenant(other, () => linkPayment(theirTx, [mine[0].id])), /timesheet/i);
});
