import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { uid } from "./id";

const { rpns, employees } = schema;

// Parses a Revenue Payroll Notification (RPN) JSON as retrieved from ROS and
// upserts one RPN per employment. The ROS RPN response varies in envelope shape
// and key casing between integrations, so we walk the JSON, index every leaf by
// a normalised key, and resolve fields by alias — robust to the exact format.
// Field meanings follow Revenue's "RPN Data Items" spec (items 104–137).

export type RpnImportSummary = {
  parsed: number;
  imported: number;
  matched: number;
  unmatched: number;
  errors: string[];
};

function norm(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Flatten an object to a map of normalised-leaf-key -> value (last writer wins,
// which is fine because RPN leaf names are unique enough: ppsn, employmentID…).
function flatten(obj: unknown, out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, out);
      else out.set(norm(k), v);
    }
  }
  return out;
}

function pick(map: Map<string, unknown>, aliases: string[]): unknown {
  for (const a of aliases) {
    const v = map.get(norm(a));
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function bool(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === "true";
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

// Percent fields in the RPN are expressed as percentage points (e.g. 20, 0.5);
// we store fractions (0.20, 0.005).
function pctToFraction(v: unknown): number {
  const n = num(v);
  return n > 1 ? n / 100 : n === 0 ? 0 : n / 100;
}

// Find the array of RPN records regardless of envelope.
function extractRecords(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["rpns", "rpnList", "rpnsList", "data", "rpnDataItems"]) {
      const v = o[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    // single RPN object?
    if (o.rpnNumber || o.RPNNumber || o.employeeID || o.employeePPSN) return [o];
  }
  return [];
}

function buildUscBands(map: Map<string, unknown>) {
  const bands: { rate: number; yearlyCutOff: number }[] = [];
  for (let i = 1; i <= 4; i++) {
    const rate = pick(map, [`uscRate${i}Percent`, `uscRate${i}`]);
    const cut = pick(map, [`yearlyUSCRate${i}CutOff`, `uscRate${i}CutOff`, `yearlyUscRate${i}CutOff`]);
    if (rate === undefined && cut === undefined) continue;
    bands.push({ rate: pctToFraction(rate), yearlyCutOff: num(cut) });
  }
  return bands;
}

function matchEmployee(ppsn: string, employmentId: string, employerRef: string): string | null {
  const all = db.select().from(employees).all();
  const p = ppsn.toUpperCase().trim();
  // Prefer PPSN + employmentId, then PPSN, then employer reference.
  let hit = all.find((e) => (e.ppsn ?? "").toUpperCase().trim() === p && p && (employmentId ? e.employmentId === employmentId : true));
  if (!hit && p) hit = all.find((e) => (e.ppsn ?? "").toUpperCase().trim() === p);
  if (!hit && employerRef) hit = all.find((e) => (e.employerReference ?? "") === employerRef);
  return hit?.id ?? null;
}

export function importRpnJson(text: string, fallbackTaxYear: number): RpnImportSummary {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { parsed: 0, imported: 0, matched: 0, unmatched: 0, errors: ["File is not valid JSON."] };
  }
  const records = extractRecords(json);
  if (records.length === 0) {
    return { parsed: 0, imported: 0, matched: 0, unmatched: 0, errors: ["No RPN records found in the file."] };
  }

  const errors: string[] = [];
  let imported = 0;
  let matched = 0;
  let unmatched = 0;

  for (let i = 0; i < records.length; i++) {
    const map = flatten(records[i]);
    const ppsn = str(pick(map, ["employeePPSN", "ppsn"]));
    const employmentId = str(pick(map, ["employmentID", "employmentId"]));
    const employerReference = str(pick(map, ["employerReference"]));
    const rpnNumber = str(pick(map, ["rpnNumber"]));
    const taxYear = num(pick(map, ["taxYear"])) || fallbackTaxYear;

    if (!ppsn && !employerReference) {
      errors.push(`Record ${i + 1}: no PPSN or employer reference — skipped.`);
      continue;
    }

    const employeeId = matchEmployee(ppsn, employmentId, employerReference);
    if (employeeId) matched++;
    else unmatched++;

    const row = {
      id: uid(),
      employeeId,
      taxYear,
      rpnNumber,
      rpnIssueDate: str(pick(map, ["rpnIssueDate"])) || null,
      firstName: str(pick(map, ["firstName"])),
      familyName: str(pick(map, ["familyName", "lastName", "surname"])),
      ppsn,
      employmentId,
      employerReference,
      incomeTaxBasis: str(pick(map, ["incomeTaxCalculationBasis", "incomeTaxBasis", "taxBasis"])) || "Cumulative",
      exclusionOrder: bool(pick(map, ["exclusionOrder"])),
      effectiveDate: str(pick(map, ["effectiveDate"])) || null,
      endDate: str(pick(map, ["endDate"])) || null,
      payForIncomeTaxToDate: num(pick(map, ["payForIncomeTaxToDate"])),
      incomeTaxDeductedToDate: num(pick(map, ["incomeTaxDeductedToDate"])),
      yearlyTaxCredit: num(pick(map, ["yearlyTaxCredit", "yearlyTaxCredits", "taxCredits"])),
      taxRate1Pct: pctToFraction(pick(map, ["taxRate1Percent", "taxRate1"])) || 0.2,
      yearlyRate1CutOff: num(pick(map, ["yearlyRate1CutOff", "standardRateCutOff"])),
      taxRate2Pct: pctToFraction(pick(map, ["taxRate2Percent", "taxRate2"])) || 0.4,
      prsiExempt: bool(pick(map, ["employeeIsExemptFromPRSIInIreland", "prsiExempt"])),
      prsiClass: str(pick(map, ["prsiClassAndSubclass", "prsiClass"])),
      uscStatus: str(pick(map, ["uscStatus"])) || "Ordinary",
      uscBands: JSON.stringify(buildUscBands(map)),
      payForUscToDate: num(pick(map, ["payForUSCToDate", "payForUscToDate"])),
      uscDeductedToDate: num(pick(map, ["uscDeductedToDate"])),
      lptToDeduct: num(pick(map, ["lptToBeDeducted", "lptToDeduct"])),
      employmentCessationDate: str(pick(map, ["employmentCessationDate"])) || null,
      statePensionContributory: bool(pick(map, ["statePensionContributory"])),
      rawJson: JSON.stringify(records[i]),
    };

    // Replace any existing RPN for the same employment/year (latest wins).
    db.transaction((trx) => {
      if (employeeId) {
        trx.delete(rpns).where(and(eq(rpns.employeeId, employeeId), eq(rpns.taxYear, taxYear))).run();
      }
      trx.insert(rpns).values(row).run();
    });
    imported++;
  }

  return { parsed: records.length, imported, matched, unmatched, errors };
}

// The current (latest) RPN for an employee in a tax year.
export function currentRpn(employeeId: string, taxYear: number) {
  return db
    .select()
    .from(rpns)
    .where(and(eq(rpns.employeeId, employeeId), eq(rpns.taxYear, taxYear)))
    .orderBy(rpns.effectiveDate)
    .all()
    .at(-1) ?? null;
}
