import re, json, sys

NUM = r'[\d,]+\.\d{2}'
def money(s): return round(float(s.replace(',', '')), 2)

def parse(path):
    text = open(path, encoding='utf-8', errors='replace').read()
    lines = text.split('\n')
    invoices = []
    cur = None
    for i, ln in enumerate(lines):
        m = re.search(r'INVOICE\s+(\d{3,})\s*$', ln)
        if m:
            if cur: invoices.append(cur)
            cur = {"number": m.group(1), "lines": [], "paid": False,
                   "customer": None, "date": None, "dueDate": None,
                   "subtotal": None, "tax": None, "total": None, "po": None}
            # Customer sits at the start of the NEXT line (same row as DATE).
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                cust = re.split(r'\s{3,}', nxt.strip())[0].strip()
                cur["customer"] = re.sub(r"[,;]+$", "", cust).strip() or None
            continue
        if not cur: continue

        if (d := re.search(r'\bDATE\s+(\d{2}-\d{2}-\d{4})', ln)) and 'DUE' not in ln and not cur["date"]:
            dd, mm, yy = d.group(1).split('-'); cur["date"] = f"{yy}-{mm}-{dd}"
        if d := re.search(r'DUE DATE\s+(\d{2}-\d{2}-\d{4})', ln):
            dd, mm, yy = d.group(1).split('-'); cur["dueDate"] = f"{yy}-{mm}-{dd}"
        if d := re.search(rf'SUBTOTAL\s+({NUM})', ln): cur["subtotal"] = money(d.group(1))
        if d := re.search(rf'\bTAX\s+({NUM})\s*$', ln): cur["tax"] = money(d.group(1))
        if d := re.search(rf'\bTOTAL\s+({NUM})', ln) and 'SUBTOTAL' not in ln:
            mm2 = re.search(rf'\bTOTAL\s+({NUM})', ln)
            if 'SUBTOTAL' not in ln: cur["total"] = money(mm2.group(1))
        if d := re.search(r'\bPO:?\s+(\S+)', ln): cur["po"] = d.group(1)
        if re.search(r'^\s*PAID\s*$', ln) or re.search(r'\s+PAID\s*$', ln): cur["paid"] = True

        # A line item row: "<desc…>  Standard  <qty>  <rate>  <amount>"
        # A line item row. The VAT class column is one of these words; Export is
        # the 0% class used for services sold outside the EU.
        CLS = r'Standard|Zero|Exempt|Reduced|Export'
        # Normal shape: desc … CLASS  qty  rate  amount
        li = re.search(rf'^(.*?)\s+({CLS})\s+(\d+)\s+({NUM})\s+({NUM})\s*$', ln)
        qty = None
        if li:
            qty = int(li.group(3)); rate = money(li.group(4)); amt = money(li.group(5))
            desc_raw, cls = li.group(1), li.group(2)
        else:
            # Some rows omit the quantity entirely (a flat-fee line), leaving
            # desc … CLASS  rate  amount. Infer the quantity from the two.
            li2 = re.search(rf'^(.*?)\s+({CLS})\s+({NUM})\s+({NUM})\s*$', ln)
            if li2:
                rate = money(li2.group(3)); amt = money(li2.group(4))
                qty = round(amt / rate) if rate else 1
                desc_raw, cls = li2.group(1), li2.group(2)
        if qty is not None:
            # -layout duplicates the description into two columns; keep the longer half.
            parts = [p.strip() for p in re.split(r'\s{3,}', desc_raw.strip()) if p.strip()]
            desc = max(parts, key=len) if parts else desc_raw.strip()
            cur["lines"].append({
                "description": desc, "vat": cls,
                "quantity": qty, "unitPrice": rate, "amount": amt,
            })
    if cur: invoices.append(cur)
    return invoices

out = []
for f in sys.argv[1:]:
    out.extend(parse(f))
# newest-first in the files; sort ascending by number for sanity
out.sort(key=lambda x: int(x["number"]))
print(json.dumps(out, indent=1))
