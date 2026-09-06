import { createHash } from "node:crypto";
import Papa from "papaparse";
import type { Transaction } from "@cashish/core/db";

// Maps a Revolut Business "account statement" CSV into our transaction rows.
// The provider's `ID` column is a stable UUID per transaction, so re-uploading
// an overlapping statement is safe: we key on id and only the unseen rows get
// inserted (see lib/transactions.ts importTransactions).

// tenantId is excluded deliberately: a parsed CSV row knows nothing about which
// tenant is importing it. importTransactions() stamps it from the tenant context.
export type ParsedRow = Omit<
  Transaction,
  | "categoryId"
  | "vatRateId"
  | "note"
  | "reconciled"
  | "createdAt"
  | "excluded"
  | "excludedReason"
  | "tenantId"
  // A parsed statement row knows nothing about who a payment went to; that is
  // attached afterwards, by hand or by a rule.
  | "employeeId"
  | "vendorId"
  | "customerId"
  // A statement row names its account as text; which account row that is gets
  // resolved on the way in, and a transfer is recognised after that.
  | "accountId"
  | "transferAccountId"
  | "transferPeerId"
> & {
  categoryId: null;
  vatRateId: null;
};

export type ParseResult = {
  rows: ParsedRow[];
  errors: string[];
  totalRows: number;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * The date, as YYYY-MM-DD, from whatever the statement wrote.
 *
 * Card and account exports are already ISO, so those just get trimmed. The
 * savings export is not: it writes "2 Sept 2026, 11:37:44" in local words,
 * with a FOUR letter "Sept" that no date library parses by default and that
 * `new Date()` reads as Invalid on Node. Slicing the first ten characters —
 * which is what this used to do — turned that into "2 Sept 20" and every row
 * in the file sorted and filtered as nonsense.
 */
export function toISODate(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(v);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }

  // Last resort, and only for something a runtime can genuinely parse; an
  // unreadable date must not silently become today's.
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Accept a handful of header spellings so this isn't brittle to minor Revolut
// export tweaks. Keys are normalised: lowercased, non-alphanumerics stripped.
function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIASES: Record<string, string[]> = {
  id: ["id", "transactionid"],
  dateStarted: ["datestartedutc", "datestarted", "starteddate", "dateinitiated"],
  // A savings statement has one plain "Date" column and nothing else.
  dateCompleted: ["datecompletedutc", "datecompleted", "completeddate", "date"],
  type: ["type"],
  state: ["state", "status"],
  description: ["description"],
  reference: ["reference"],
  payer: ["payer"],
  cardLabel: ["cardlabel"],
  origCurrency: ["origcurrency", "originalcurrency"],
  origAmount: ["origamount", "originalamount"],
  currency: ["paymentcurrency", "currency"],
  // Revolut's savings export writes the amount as "Value, EUR" — the currency
  // is in the header rather than in a column of its own.
  amount: ["amount", "valueeur", "valuegbp", "valueusd", "value"],
  totalAmount: ["totalamount"],
  fee: ["fee"],
  balance: ["balance"],
  account: ["account", "product"],
  mcc: ["mcc"],
};

/**
 * A stable id for a statement that has no ID column.
 *
 * Revolut BUSINESS exports carry a UUID per transaction, which is what makes a
 * re-upload of an overlapping period safe. The PERSONAL export has no such
 * column, so one is derived from the fields that identify the line: the dates,
 * the description, the amount and the running balance. Balance is what makes it
 * safe — two identical €3.50 coffees on the same day differ by the balance they
 * left behind, so they hash differently and both survive, while re-importing
 * the same file produces the same hashes and inserts nothing.
 *
 * Prefixed so a synthesised id is never mistaken for a provider's own.
 */
function derivedId(parts: (string | number | null)[]): string {
  const digest = createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex");
  return `csv_${digest.slice(0, 32)}`;
}

function buildResolver(headers: string[]) {
  const map = new Map<string, string>(); // normalised header -> original header
  for (const h of headers) map.set(normKey(h), h);
  return (field: string): string | undefined => {
    for (const alias of FIELD_ALIASES[field] ?? []) {
      const orig = map.get(alias);
      if (orig) return orig;
    }
    return undefined;
  };
}

export function parseStatementCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const errors: string[] = [];
  const headers = parsed.meta.fields ?? [];
  const resolve = buildResolver(headers);

  const idHeader = resolve("id");
  const amountHeader = resolve("amount");
  const dateHeader = resolve("dateCompleted") ?? resolve("dateStarted");
  // No ID column is normal — a personal Revolut export has none — so long as
  // there is enough else to identify a line with. Without a date there is not.
  if (!idHeader && !dateHeader) {
    return {
      rows: [],
      errors: [
        "Could not find an 'ID' column, nor a date to derive one from — is this a Revolut statement?",
      ],
      totalRows: 0,
    };
  }
  if (!amountHeader) {
    return {
      rows: [],
      errors: ["Could not find an 'Amount' column."],
      totalRows: 0,
    };
  }

  const get = (row: Record<string, string>, field: string): string => {
    const h = resolve(field);
    return h ? (row[h] ?? "").trim() : "";
  };

  // "Value, EUR" names the currency in the header. Without this every row in a
  // savings statement would be booked as EUR by default, which is right today
  // and wrong the moment somebody exports a sterling one.
  const amountHeaderCurrency = /value,?\s*([A-Z]{3})/i.exec(amountHeader ?? "")?.[1]?.toUpperCase();

  const rows: ParsedRow[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];

    const amount = num(get(r, "amount"));
    const dateCompleted = get(r, "dateCompleted") || null;
    const dateStarted = get(r, "dateStarted") || null;
    const bookedDate = toISODate(dateCompleted || dateStarted);

    const id =
      get(r, "id") ||
      derivedId([
        dateCompleted,
        dateStarted,
        get(r, "description"),
        get(r, "reference"),
        get(r, "amount"),
        get(r, "balance"),
        get(r, "currency"),
      ]);
    if (!id) {
      errors.push(`Row ${i + 2}: missing transaction ID, skipped.`);
      continue;
    }
    // de-dupe within the same file too
    if (seenInFile.has(id)) continue;
    seenInFile.add(id);

    if (amount === null) {
      errors.push(`Row ${i + 2} (${id}): unparseable amount, skipped.`);
      continue;
    }
    if (!bookedDate) {
      errors.push(
        `Row ${i + 2}: could not read the date "${dateCompleted || dateStarted || ""}", skipped.`,
      );
      continue;
    }

    rows.push({
      id,
      dateStarted,
      dateCompleted,
      bookedDate,
      type: get(r, "type") || null,
      state: get(r, "state") || null,
      description: get(r, "description"),
      reference: get(r, "reference"),
      payer: get(r, "payer"),
      cardLabel: get(r, "cardLabel"),
      origCurrency: get(r, "origCurrency"),
      origAmount: num(get(r, "origAmount")),
      currency: get(r, "currency") || amountHeaderCurrency || "EUR",
      amount,
      fee: num(get(r, "fee")) ?? 0,
      balance: num(get(r, "balance")),
      account: get(r, "account"),
      mcc: get(r, "mcc"),
      importBatch: null,
      categoryId: null,
      vatRateId: null,
    });
  }

  return { rows, errors, totalRows: parsed.data.length };
}
