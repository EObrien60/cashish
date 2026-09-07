import type { Customer, Settings, VatRate } from "@cashish/core/db";
import { money, fmtDate, pct, round2 } from "./format";
import type { InvoicePdfInvoice } from "./invoice-pdf";

// ---------------------------------------------------------------------------
// The email body itself, not just a link to one. Table-based layout and
// inline styles throughout — email clients (Outlook especially) don't run a
// CSS engine, so anything not inlined here silently doesn't apply. Same data
// as the PDF (see invoice-pdf.tsx), rendered as HTML instead of a page.
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function invoiceEmailHtml(input: {
  invoice: InvoicePdfInvoice;
  customer: Customer | null;
  settings: Settings | null;
  vatRates: Map<string, VatRate>;
  paymentLinkUrl?: string | null;
}) {
  const { invoice: inv, customer, settings, vatRates, paymentLinkUrl } = input;
  const breakdown = new Map<string, { label: string; vat: number }>();
  for (const l of inv.lines) {
    const key = l.vatRateId ?? "none";
    const label = l.vatRateId ? (vatRates.get(l.vatRateId)?.name ?? pct(l.vatRate)) : "No VAT";
    const cur = breakdown.get(key) ?? { label, vat: 0 };
    cur.vat = round2(cur.vat + l.lineVat);
    breakdown.set(key, cur);
  }
  const due = round2(inv.total - inv.amountPaid);
  const businessName = settings?.businessName || "cashish";

  const lineRows = inv.lines
    .map(
      (l) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;">${esc(l.description)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;text-align:right;">${l.quantity}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;text-align:right;">${money(l.unitPrice)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;text-align:right;font-weight:600;">${money(l.lineNet)}</td>
    </tr>`,
    )
    .join("");

  const vatRows = [...breakdown.values()]
    .filter((b) => b.vat > 0)
    .map(
      (b) => `
    <tr>
      <td colspan="3" style="padding:2px 0;font-size:13px;color:#666;text-align:right;">VAT — ${esc(b.label)}</td>
      <td style="padding:2px 0;font-size:13px;color:#666;text-align:right;">${money(b.vat)}</td>
    </tr>`,
    )
    .join("");

  const paidRows =
    inv.amountPaid > 0
      ? `
    <tr>
      <td colspan="3" style="padding:2px 0;font-size:13px;color:#666;text-align:right;">Paid</td>
      <td style="padding:2px 0;font-size:13px;color:#666;text-align:right;">-${money(inv.amountPaid)}</td>
    </tr>
    <tr>
      <td colspan="3" style="padding:2px 0;font-size:13px;font-weight:700;text-align:right;">Balance due</td>
      <td style="padding:2px 0;font-size:13px;font-weight:700;text-align:right;">${money(due)}</td>
    </tr>`
      : "";

  const payButton = paymentLinkUrl
    ? `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:6px;background:#111827;">
        <a href="${paymentLinkUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Pay ${money(due)} now</a>
      </td>
    </tr>
  </table>`
    : "";

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td>
        ${settings?.logoDataUrl ? `<img src="${settings.logoDataUrl}" alt="${esc(businessName)}" style="max-height:40px;max-width:180px;" />` : `<div style="font-size:18px;font-weight:700;">${esc(businessName)}</div>`}
      </td>
      <td style="text-align:right;">
        <div style="font-size:20px;font-weight:700;">Invoice</div>
        <div style="font-size:13px;color:#666;">${esc(inv.number)}</div>
      </td>
    </tr>
  </table>

  <p style="font-size:14px;">Hi ${esc(customer?.name ?? "")},</p>
  <p style="font-size:14px;color:#444;">
    Please find your invoice from ${esc(businessName)} below${inv.dueDate ? `, due ${fmtDate(inv.dueDate)}` : ""}.
  </p>

  ${payButton}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:2px solid #d0d0d0;">
    <thead>
      <tr>
        <th style="padding:8px 0;text-align:left;font-size:11px;text-transform:uppercase;color:#888;">Description</th>
        <th style="padding:8px 0;text-align:right;font-size:11px;text-transform:uppercase;color:#888;">Qty</th>
        <th style="padding:8px 0;text-align:right;font-size:11px;text-transform:uppercase;color:#888;">Unit price</th>
        <th style="padding:8px 0;text-align:right;font-size:11px;text-transform:uppercase;color:#888;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
    <tr>
      <td colspan="3" style="padding:2px 0;font-size:13px;color:#666;text-align:right;">Subtotal</td>
      <td style="padding:2px 0;font-size:13px;color:#666;text-align:right;">${money(inv.subtotal)}</td>
    </tr>
    ${vatRows}
    <tr>
      <td colspan="3" style="padding:8px 0 2px;border-top:2px solid #d0d0d0;font-size:15px;font-weight:700;text-align:right;">Total</td>
      <td style="padding:8px 0 2px;border-top:2px solid #d0d0d0;font-size:15px;font-weight:700;text-align:right;">${money(inv.total)}</td>
    </tr>
    ${paidRows}
  </table>

  ${inv.notes ? `<p style="margin-top:20px;font-size:13px;color:#444;white-space:pre-wrap;">${esc(inv.notes)}</p>` : ""}

  <p style="margin-top:24px;font-size:12px;color:#888;border-top:1px solid #e0e0e0;padding-top:12px;">
    A PDF copy of this invoice is attached.${settings?.invoiceFooter ? ` ${esc(settings.invoiceFooter)}` : ""}
  </p>
</div>`;
}
