#!/usr/bin/env tsx
/**
 * Creates the people a business pays, and links their payments.
 *
 *   npx tsx scripts/people/setup.ts --tenant obh [--commit]
 *   npx tsx scripts/people/setup.ts --tenant quantumharbour --commit
 *
 * Works by attaching an employee to the rule that already recognises their name,
 * then re-applying the rules — which backfills every historic payment in one
 * pass rather than a person at a time.
 *
 * Companies are deliberately not included. A pattern like "To <Name> <Name>"
 * matches "To Buzzworks Design Studio LTD" and "To Hetzner Online GmbH" just as
 * happily as a person, and a supplier on the payroll would be wrong in a way
 * that is annoying to unpick, so the list below is explicit rather than derived.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool, runInTenant, schema, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { createPerson, listPeople, fullName, paidByEmployee } from "../../src/lib/people";
import { listRules, applyRulesToAll } from "../../src/lib/rules";
import { listTransactions } from "../../src/lib/transactions";
import { round2 } from "../../src/lib/format";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");

type Person = {
  name: string;
  /** Rule matchValue(s) that identify this person's payments. */
  matches: string[];
  director?: "proprietary" | "non-proprietary";
  note?: string;
};

const PEOPLE: Record<string, Person[]> = {
  obh: [
    { name: "Sarah Jane Hughes", matches: ["To Sarah Jane Hughes"] },
    { name: "Jiahong Lin", matches: ["To Jiahong Lin"] },
    { name: "Ronan Kenny", matches: ["To Ronan Kenny"] },
    { name: "Lu Han", matches: ["To Lu Han"] },
    { name: "Gopal Patil", matches: ["To Gopal Patil"] },
    {
      name: "Ethan Paul O'Brien",
      matches: ["To ETHAN PAUL OBRIEN"],
      director: "proprietary",
      note: "Existing rule books these to Wages & salaries; left as-is.",
    },
  ],
  quantumharbour: [
    { name: "Xinyu Zhang", matches: ["XINYU ZHANG"] },
    { name: "Kefan Chen", matches: ["KEFAN CHEN"] },
    { name: "Jiahong Lin", matches: ["JIAHONG LIN"] },
    { name: "Yu Xia", matches: ["YU XIA"] },
    { name: "Matthew Ryan", matches: ["MATTHEW RYAN"] },
    { name: "Katelynn O'Brien", matches: ["KATELYNN O'BRIEN"] },
    {
      name: "Ethan Paul O'Brien",
      // Both directions: money out to the director, and money the director put
      // in. The person page reports the two separately.
      matches: ["TO ETHAN PAUL OBRIEN", "ETHAN PAUL OBRIEN"],
      director: "proprietary",
      note: "Booked to Owner drawings / transfers; category left as-is.",
    },
  ],
};

async function main() {
  const slug = flag("tenant");
  if (!slug || !PEOPLE[slug]) {
    console.error(`--tenant must be one of: ${Object.keys(PEOPLE).join(", ")}`);
    process.exit(1);
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }

  console.log(`${COMMIT ? "COMMITTING to" : "DRY RUN against"} ${slug}\n`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "people-setup" }, async () => {
    const tid = tenantId();
    const rules = await listRules();
    const byMatch = new Map(rules.map((r) => [r.matchValue.toUpperCase(), r]));

    for (const person of PEOPLE[slug]) {
      const existing = (await listPeople({ includeLeavers: true })).find(
        (e) => fullName(e).toLowerCase() === person.name.toLowerCase(),
      );
      let employeeId = existing?.id;

      if (!employeeId) {
        if (COMMIT) {
          const { employee } = await createPerson({ name: person.name });
          employeeId = employee.id;
          if (person.director) {
            await db
              .update(schema.employees)
              .set({ director: person.director })
              .where(and(eq(schema.employees.tenantId, tid), eq(schema.employees.id, employee.id)));
          }
        }
        console.log(`   ${COMMIT ? "created" : "would create"}  ${person.name}${person.director ? "  (director)" : ""}`);
      } else {
        console.log(`   exists          ${person.name}`);
      }

      for (const match of person.matches) {
        const rule = byMatch.get(match.toUpperCase());
        if (!rule) {
          console.log(`     ! no rule matching "${match}" — payments will not auto-link`);
          continue;
        }
        if (rule.employeeId && rule.employeeId === employeeId) {
          console.log(`     rule "${match}" already linked`);
          continue;
        }
        if (COMMIT && employeeId) {
          await db
            .update(schema.categoryRules)
            .set({ employeeId })
            .where(and(eq(schema.categoryRules.tenantId, tid), eq(schema.categoryRules.id, rule.id)));
        }
        console.log(`     ${COMMIT ? "linked" : "would link"} rule "${match}"`);
      }
      if (person.note) console.log(`     note: ${person.note}`);
    }

    if (COMMIT) {
      // Re-applying reaches the whole history, which is the point.
      const applied = await applyRulesToAll();
      console.log(
        `\n   re-applied rules: matched ${applied.matched}, updated ${applied.updated}, ` +
          `recategorised ${applied.recategorised}`,
      );

      const paid = await paidByEmployee();
      const people = await listPeople({ includeLeavers: true });
      console.log("\n   who has been paid what:");
      let total = 0;
      for (const e of people) {
        const p = paid.get(e.id);
        total = round2(total + (p?.paid ?? 0));
        console.log(
          `     ${String(p?.paid ?? 0).padStart(11)}  x${String(p?.count ?? 0).padStart(3)}  ` +
            `${fullName(e)}${p?.last ? `   last ${p.last}` : ""}`,
        );
      }
      console.log(`     ${String(total).padStart(11)}  total attributed`);

      // Anything still looking like a person but attached to nobody.
      const unlinked = (await listTransactions({ direction: "out" })).filter(
        (t) => !t.employeeId && /^To [A-Z][\w'’.-]+ [A-Z]/.test((t.description ?? "").trim()),
      );
      if (unlinked.length) {
        const byName = new Map<string, { n: number; t: number }>();
        for (const t of unlinked) {
          const k = (t.description ?? "").trim();
          const c = byName.get(k) ?? { n: 0, t: 0 };
          c.n++;
          c.t = round2(c.t + Math.abs(t.amount));
          byName.set(k, c);
        }
        console.log("\n   still unattached, and name-shaped (companies expected here):");
        for (const [k, v] of [...byName.entries()].sort((x, y) => y[1].t - x[1].t)) {
          console.log(`     ${String(v.t).padStart(11)}  x${String(v.n).padStart(3)}  ${k}`);
        }
      }
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
