/**
 * People, and attaching payments to them.
 *
 * The point of this module is that none of it requires an RPN import or a pay
 * run, so that is what the first test asserts. The second is the isolation
 * guarantee: an employee id from another business must not be writable onto
 * these rows, because the column's foreign key knows nothing about tenants.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { uid } from "../src/lib/id";
import {
  createPerson,
  listPeople,
  setTransactionEmployee,
  getPersonDetail,
  paidByEmployee,
  splitName,
  fullName,
} from "../src/lib/people";
import { saveRule, applyRulesToAll } from "../src/lib/rules";
import { setExcluded } from "../src/lib/transactions";

let a: string;
let b: string;

before(async () => {
  a = (await makeTenant("people-a")).id;
  b = (await makeTenant("people-b")).id;
});
after(closePool);

const pay = (tenant: string, description: string, amount: number, date = "2026-03-01") =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate: date,
      amount: -Math.abs(amount),
      description,
      importBatch: uid(),
    });
    return id;
  });

test("a name is enough to create someone", () => {
  assert.deepEqual(splitName("Sarah Jane Hughes"), {
    firstName: "Sarah Jane",
    familyName: "Hughes",
  });
  assert.deepEqual(splitName("Cher"), { firstName: "Cher", familyName: "" });
  assert.deepEqual(splitName("  "), { firstName: "", familyName: "" });
});

test("payments attach to a person without any payroll setup", async () => {
  const t1 = await pay(a, "To Sarah Jane Hughes", 1700, "2026-01-15");
  const t2 = await pay(a, "To Sarah Jane Hughes", 1700, "2026-02-15");

  await asTenant(a, async () => {
    const { employee, created } = await createPerson({ name: "Sarah Jane Hughes" });
    assert.equal(created, true);
    assert.equal(fullName(employee), "Sarah Jane Hughes");

    // Creating the same person again is a no-op rather than a duplicate.
    const again = await createPerson({ name: "sarah jane hughes" });
    assert.equal(again.created, false);
    assert.equal(again.employee.id, employee.id);

    const result = await setTransactionEmployee([t1, t2], employee.id);
    assert.equal(result.updated, 2);

    const detail = await getPersonDetail(employee.id);
    assert.equal(detail?.totals.paid, 3400);
    assert.equal(detail?.totals.count, 2);
    assert.equal(detail?.totals.firstPaid, "2026-01-15");
    assert.equal(detail?.totals.lastPaid, "2026-02-15");
    // The whole point: no RPN, no pay run, no payslip, and the figures work.
    assert.equal(detail?.rpnCount, 0);
    assert.equal(detail?.payslips.length, 0);

    const paid = await paidByEmployee();
    assert.equal(paid.get(employee.id)?.paid, 3400);
  });
});

test("an excluded payment stops counting towards a person", async () => {
  const t = await pay(a, "To Someone Wrong", 500, "2026-04-01");
  await asTenant(a, async () => {
    const { employee } = await createPerson({ name: "Someone Wrong" });
    await setTransactionEmployee([t], employee.id);
    assert.equal((await getPersonDetail(employee.id))?.totals.paid, 500);

    await setExcluded([t], true, "personal card");
    const detail = await getPersonDetail(employee.id);
    assert.equal(detail?.totals.paid, 0, "excluded money is counted nowhere, here too");
    assert.equal(detail?.totals.excludedCount, 1, "but the row is still shown");
    assert.equal((await paidByEmployee()).get(employee.id), undefined);
  });
});

test("a rule can attach a person, and reach the whole history", async () => {
  await pay(a, "To Xinyu Zhang", 1200, "2025-06-01");
  await pay(a, "To Xinyu Zhang", 1200, "2025-07-01");
  await pay(a, "To Xinyu Zhang", 1200, "2025-08-01");

  await asTenant(a, async () => {
    const { employee } = await createPerson({ name: "Xinyu Zhang" });
    const cats = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.tenantId, a));
    const wages = cats.find((c) => c.id.endsWith(":cat-wages"))!;

    await saveRule({
      name: "Xinyu Zhang",
      matchField: "description",
      matchType: "contains",
      matchValue: "XINYU ZHANG",
      direction: "out",
      categoryId: wages.id,
      vatRateId: null,
      enabled: true,
      employeeId: employee.id,
    });
    await applyRulesToAll();

    const detail = await getPersonDetail(employee.id);
    assert.equal(detail?.totals.count, 3, "one rule reached every past payment");
    assert.equal(detail?.totals.paid, 3600);
    assert.ok(
      detail?.transactions.every((t) => t.categoryId === wages.id),
      "and categorised them at the same time",
    );
  });
});

test("an employee from another business cannot be attached", async () => {
  const mine = await pay(a, "To Local Person", 100, "2026-05-01");
  const theirs = await asTenant(b, async () => (await createPerson({ name: "Their Person" })).employee.id);

  await asTenant(a, async () => {
    await assert.rejects(
      () => setTransactionEmployee([mine], theirs),
      /does not belong to this business/,
      "the foreign key does not know about tenants, so this check must",
    );
  });

  // And the other tenant's person list never showed them anyway.
  await asTenant(a, async () => {
    const names = (await listPeople({ includeLeavers: true })).map(fullName);
    assert.ok(!names.includes("Their Person"));
  });
});

test("money in from a person is not counted as money paid to them", async () => {
  const out = await pay(a, "To The Director", 2000, "2026-06-01");
  const inflow = await asTenant(a, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: a,
      bookedDate: "2026-06-05",
      amount: 5000, // the director putting money IN
      description: "From The Director",
      payer: "The Director",
      importBatch: uid(),
    });
    return id;
  });

  await asTenant(a, async () => {
    const { employee } = await createPerson({ name: "The Director" });
    await setTransactionEmployee([out, inflow], employee.id);

    const detail = await getPersonDetail(employee.id);
    assert.equal(detail?.totals.paid, 2000, "only the outflow is pay");
    assert.equal(detail?.totals.count, 1);
    assert.equal(detail?.totals.receivedFrom, 5000, "the inflow is reported separately");
    assert.equal(detail?.totals.receivedCount, 1);
    assert.equal(detail?.transactions.length, 2, "both are still listed");
    assert.equal((await paidByEmployee()).get(employee.id)?.paid, 2000);
  });
});
