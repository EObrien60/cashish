import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Customer, Settings, VatRate } from "@cashish/core/db";
import { money, fmtDate, pct, round2 } from "./format";

// ---------------------------------------------------------------------------
// The emailed PDF, deliberately built from the same data as the on-screen
// invoice (app/invoices/[id]/page.tsx) so the two never drift apart — same
// header, same line-item table, same VAT breakdown, same totals. This is a
// separate renderer (react-pdf, not the browser) because a serverless
// function has no browser to print from; it is not a separate design.
//
// react-pdf over a headless-Chrome route (Puppeteer): no Chromium binary to
// ship into a Vercel function, no cold-start hit from launching a browser —
// this stays a plain Node render, same cost profile as everything else here.
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  logo: { maxHeight: 48, maxWidth: 180, marginBottom: 6 },
  businessName: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  faint: { color: "#666666" },
  small: { fontSize: 9 },
  invoiceTitle: { fontSize: 18, fontWeight: 700, textAlign: "right" },
  section: { marginTop: 20 },
  label: { fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, color: "#888888", marginBottom: 3 },
  table: { marginTop: 20, borderTop: "2 solid #d0d0d0", borderBottom: "1 solid #e0e0e0" },
  th: { fontSize: 8, textTransform: "uppercase", color: "#888888", paddingVertical: 6 },
  tr: { flexDirection: "row", borderBottom: "1 solid #f0f0f0", paddingVertical: 6 },
  colDesc: { flex: 3 },
  colNum: { flex: 1, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "2 solid #d0d0d0",
    marginTop: 4,
    paddingTop: 6,
    fontSize: 12,
    fontWeight: 700,
  },
  footer: { marginTop: 32, paddingTop: 12, borderTop: "1 solid #e0e0e0", fontSize: 8, color: "#888888" },
});

export type InvoicePdfInvoice = {
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: number;
  total: number;
  amountPaid: number;
  notes: string | null;
  terms: string | null;
  lines: {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatRateId: string | null;
    lineNet: number;
    lineVat: number;
  }[];
};

export type InvoicePdfInput = {
  invoice: InvoicePdfInvoice;
  customer: Customer | null;
  settings: Settings | null;
  vatRates: Map<string, VatRate>;
};

function InvoiceDocument({ invoice: inv, customer, settings, vatRates }: InvoicePdfInput) {
  const breakdown = new Map<string, { label: string; vat: number }>();
  for (const l of inv.lines) {
    const key = l.vatRateId ?? "none";
    const label = l.vatRateId ? (vatRates.get(l.vatRateId)?.name ?? pct(l.vatRate)) : "No VAT";
    const cur = breakdown.get(key) ?? { label, vat: 0 };
    cur.vat = round2(cur.vat + l.lineVat);
    breakdown.set(key, cur);
  }
  const due = round2(inv.total - inv.amountPaid);

  return (
    <Document title={`Invoice ${inv.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {settings?.logoDataUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={settings.logoDataUrl} style={styles.logo} />
            ) : (
              <Text style={styles.businessName}>{settings?.businessName ?? ""}</Text>
            )}
            <Text style={styles.small}>{settings?.addressLine1}</Text>
            <Text style={styles.small}>{settings?.addressLine2}</Text>
            <Text style={styles.small}>{settings?.city}</Text>
            <Text style={styles.small}>{settings?.country}</Text>
            {settings?.vatNumber ? <Text style={styles.small}>VAT: {settings.vatNumber}</Text> : null}
          </View>
          <View>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={[styles.small, { textAlign: "right", marginTop: 4 }]}>{inv.number}</Text>
            <View style={{ marginTop: 10 }}>
              <View style={styles.row}>
                <Text style={[styles.small, styles.faint]}>Issued</Text>
                <Text style={[styles.small, { marginLeft: 12 }]}>{fmtDate(inv.issueDate)}</Text>
              </View>
              {inv.dueDate ? (
                <View style={styles.row}>
                  <Text style={[styles.small, styles.faint]}>Due</Text>
                  <Text style={[styles.small, { marginLeft: 12 }]}>{fmtDate(inv.dueDate)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Bill to</Text>
          <Text style={{ fontWeight: 700 }}>{customer?.name}</Text>
          {customer?.addressLine1 ? <Text style={styles.small}>{customer.addressLine1}</Text> : null}
          {customer?.addressLine2 ? <Text style={styles.small}>{customer.addressLine2}</Text> : null}
          {customer?.city ? <Text style={styles.small}>{customer.city}</Text> : null}
          {customer?.country ? <Text style={styles.small}>{customer.country}</Text> : null}
          {customer?.vatNumber ? (
            <Text style={[styles.small, styles.faint]}>VAT: {customer.vatNumber}</Text>
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            <Text style={[styles.th, styles.colNum]}>Qty</Text>
            <Text style={[styles.th, styles.colNum]}>Unit price</Text>
            <Text style={[styles.th, styles.colNum]}>VAT</Text>
            <Text style={[styles.th, styles.colNum]}>Amount</Text>
          </View>
          {inv.lines.map((l) => (
            <View style={styles.tr} key={l.id}>
              <Text style={styles.colDesc}>{l.description}</Text>
              <Text style={styles.colNum}>{l.quantity}</Text>
              <Text style={styles.colNum}>{money(l.unitPrice)}</Text>
              <Text style={[styles.colNum, styles.faint]}>{l.vatRate ? pct(l.vatRate) : "—"}</Text>
              <Text style={[styles.colNum, { fontWeight: 700 }]}>{money(l.lineNet)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.faint}>Subtotal</Text>
            <Text>{money(inv.subtotal)}</Text>
          </View>
          {[...breakdown.values()]
            .filter((b) => b.vat > 0)
            .map((b) => (
              <View style={styles.totalRow} key={b.label}>
                <Text style={styles.faint}>VAT — {b.label}</Text>
                <Text>{money(b.vat)}</Text>
              </View>
            ))}
          <View style={styles.grandTotal}>
            <Text>Total</Text>
            <Text>{money(inv.total)}</Text>
          </View>
          {inv.amountPaid > 0 ? (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.faint}>Paid</Text>
                <Text>-{money(inv.amountPaid)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={{ fontWeight: 700 }}>Balance due</Text>
                <Text style={{ fontWeight: 700 }}>{money(due)}</Text>
              </View>
            </>
          ) : null}
        </View>

        {inv.notes || settings?.iban ? (
          <View style={styles.footer}>
            {inv.notes ? <Text style={{ marginBottom: 4 }}>{inv.notes}</Text> : null}
            {settings?.iban || settings?.bic ? (
              <Text>
                Payment details: {settings?.iban ? `IBAN ${settings.iban}` : ""}
                {settings?.bic ? ` · BIC ${settings.bic}` : ""}
              </Text>
            ) : null}
          </View>
        ) : null}
        {inv.terms ? <Text style={[styles.footer, { borderTop: "none", marginTop: 4 }]}>{inv.terms}</Text> : null}
        {settings?.invoiceFooter ? (
          <Text style={[styles.small, styles.faint, { textAlign: "center", marginTop: 20 }]}>
            {settings.invoiceFooter}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...input} />);
}
