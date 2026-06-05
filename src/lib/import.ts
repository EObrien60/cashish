import Papa from "papaparse";
import type { Transaction } from "@/db/schema";

// Maps a Revolut Business "account statement" CSV into our transaction rows.
// The provider's `ID` column is a stable UUID per transaction, so re-uploading
// an overlapping statement is safe: we key on id and only the unseen rows get
// inserted (see lib/transactions.ts importTransactions).

export type ParsedRow = Omit<
  Transaction,
  "categoryId" | "vatRateId" | "note" | "reconciled" | "createdAt"
> & {
  categoryId: null;
  vatRateId: null;
};

export type ParseResult = {
  rows: ParsedRow[];
  errors: string[];
  totalRows: number;
};

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
  dateCompleted: ["datecompletedutc", "datecompleted", "completeddate"],
  type: ["type"],
  state: ["state", "status"],
  description: ["description"],
  reference: ["reference"],
  payer: ["payer"],
  cardLabel: ["cardlabel"],
  origCurrency: ["origcurrency", "originalcurrency"],
  origAmount: ["origamount", "originalamount"],
  currency: ["paymentcurrency", "currency"],
  amount: ["amount"],
  totalAmount: ["totalamount"],
  fee: ["fee"],
  balance: ["balance"],
  account: ["account"],
  mcc: ["mcc"],
};

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
  if (!idHeader) {
    return {
      rows: [],
      errors: ["Could not find an 'ID' column — is this a Revolut statement?"],
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

  const rows: ParsedRow[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const id = get(r, "id");
    if (!id) {
      errors.push(`Row ${i + 2}: missing transaction ID, skipped.`);
      continue;
    }
    // de-dupe within the same file too
    if (seenInFile.has(id)) continue;
    seenInFile.add(id);

    const amount = num(get(r, "amount"));
    if (amount === null) {
      errors.push(`Row ${i + 2} (${id}): unparseable amount, skipped.`);
      continue;
    }

    const dateCompleted = get(r, "dateCompleted") || null;
    const dateStarted = get(r, "dateStarted") || null;
    const bookedDate = (dateCompleted || dateStarted || "").slice(0, 10);

    rows.push({
      id,
      dateStarted,
      dateCompleted,
      bookedDate: bookedDate || dateStarted || dateCompleted || "",
      type: get(r, "type") || null,
      state: get(r, "state") || null,
      description: get(r, "description"),
      reference: get(r, "reference"),
      payer: get(r, "payer"),
      cardLabel: get(r, "cardLabel"),
      origCurrency: get(r, "origCurrency"),
      origAmount: num(get(r, "origAmount")),
      currency: get(r, "currency") || "EUR",
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
