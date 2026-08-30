#!/usr/bin/env python3
"""
Parses Quantum Harbour invoice PDFs (via `pdftotext -layout`) into JSON.

  pdftotext -layout qh2025inv.pdf /tmp/a.txt
  python3 parse-invoices.py /tmp/a.txt /tmp/b.txt > invoices.json

Line items are read by COLUMN POSITION, taken from each invoice's own table
header, rather than by splitting on runs of whitespace. The description cells
wrap over several lines, and a whitespace split keeps only the first — which
turns "Lenovo ThinkCentre neo 50q Gen 6 13HR - Core Ultra 5 226V 16/512GB" into
"Lenovo ThinkCentre neo 50q Gen". Fine for a total, useless as a product name.
"""
import re, json, sys

NUM = r'[\d,]+\.\d{2}'
CLS = r'Standard|Zero|Exempt|Reduced|Export'

def money(s): return round(float(s.replace(',', '')), 2)

def _collapse_repeat(desc):
    """Collapse a description that restarts partway through.

    The fallback path can join the item-name column to the description column,
    giving "Lenovo V14 G5 IRL c5- Lenovo V14 G5 IRL c5-120u 16GB". Where a run of
    at least three leading words reappears later, the later copy is the fuller
    one, so keep from there.
    """
    words = desc.split()
    for start in range(1, len(words)):
        n = min(3, len(words) - start)
        if n < 3:
            break
        if words[start:start + n] == words[:n]:
            tail = " ".join(words[start:])
            head = " ".join(words[:start])
            return tail if len(tail) >= len(head) else head
    return desc


def _boundary_safe(line, at):
    """True when slicing `line` at `at` does not cut through a word.

    `pdftotext -layout` does not always place a wide first column exactly where
    the header implies. When it does not, slicing at the header offset lands
    inside a word ("HP Pro|Desk"), so the caller falls back to splitting on
    whitespace rather than trusting the column position.
    """
    if at <= 0 or at >= len(line):
        return True
    return line[at - 1] == " " or line[at] == " "


def parse(path):
    lines = open(path, encoding='utf-8', errors='replace').read().split('\n')
    invoices, cur, cols = [], None, None

    def flush_item(item):
        if not item: return
        desc = ' '.join(w for w in ' '.join(item['desc_parts']).split() if w)
        item['out']['description'] = _collapse_repeat(desc)
        cur['lines'].append(item['out'])

    pending = None
    for i, ln in enumerate(lines):
        m = re.search(r'INVOICE\s+(\d{3,})\s*$', ln)
        if m:
            flush_item(pending); pending = None
            if cur: invoices.append(cur)
            cur = {"number": m.group(1), "lines": [], "paid": False, "customer": None,
                   "date": None, "dueDate": None, "subtotal": None, "tax": None,
                   "total": None, "po": None}
            cols = None
            if i + 1 < len(lines):
                cust = re.split(r'\s{3,}', lines[i + 1].strip())[0].strip()
                cur["customer"] = re.sub(r'[,;]+$', '', cust).strip() or None
            continue
        if not cur: continue

        # The table header fixes the column boundaries for this invoice.
        if 'DESCRIPTION' in ln and 'TAX' in ln and 'AMOUNT' in ln:
            flush_item(pending); pending = None
            # "cls" is filled from the first data row: the VAT-class column is
            # left-aligned a few characters before the header's own "TAX", so
            # slicing to the header position drags in "Stan"/"Expo".
            cols = {"desc": ln.index('DESCRIPTION'), "tax": ln.index('TAX'), "cls": None}
            continue

        if d := re.search(r'\bDATE\s+(\d{2}-\d{2}-\d{4})', ln):
            if 'DUE' not in ln and not cur["date"]:
                dd, mm, yy = d.group(1).split('-'); cur["date"] = f"{yy}-{mm}-{dd}"
        if d := re.search(r'DUE DATE\s+(\d{2}-\d{2}-\d{4})', ln):
            dd, mm, yy = d.group(1).split('-'); cur["dueDate"] = f"{yy}-{mm}-{dd}"
        if d := re.search(rf'SUBTOTAL\s+({NUM})', ln): cur["subtotal"] = money(d.group(1))
        if d := re.search(rf'\bTAX\s+({NUM})\s*$', ln): cur["tax"] = money(d.group(1))
        if 'SUBTOTAL' not in ln and (d := re.search(rf'\bTOTAL\s+({NUM})', ln)):
            cur["total"] = money(d.group(1))
        if d := re.search(r'\bPO:?\s+(\S+)', ln): cur["po"] = d.group(1)
        if re.search(r'(^|\s)PAID\s*$', ln): cur["paid"] = True

        row = re.search(rf'^(.*?)\s+({CLS})\s+(\d+)\s+({NUM})\s+({NUM})\s*$', ln)
        qty = rate = amt = None
        if row:
            qty, rate, amt = int(row.group(3)), money(row.group(4)), money(row.group(5))
            cls = row.group(2)
        else:
            # Some rows omit the quantity (a flat fee): CLASS rate amount.
            row2 = re.search(rf'^(.*?)\s+({CLS})\s+({NUM})\s+({NUM})\s*$', ln)
            if row2:
                rate, amt = money(row2.group(3)), money(row2.group(4))
                qty = round(amt / rate) if rate else 1
                cls = row2.group(2)
        if qty is not None:
            flush_item(pending)
            if cols is not None and cols.get("cls") is None:
                cols["cls"] = (row or row2).start(2)
            # Take the description cell by position; fall back to the widest
            # whitespace-split field when a header was never seen.
            if cols and _boundary_safe(ln, cols["desc"]):
                cell = ln[cols["desc"]:cols["cls"] or cols["tax"]].strip()
            else:
                parts = [p.strip() for p in re.split(r'\s{3,}', ln.strip()) if p.strip()]
                cell = max(parts, key=len) if parts else ''
            pending = {"desc_parts": [cell],
                       "out": {"vat": cls, "quantity": qty, "unitPrice": rate, "amount": amt}}
            continue

        # A continuation line: description text only, no class and no amount.
        # A page footer is never part of a description.
        if re.search(r'Page \d+ of \d+', ln):
            flush_item(pending); pending = None
            continue
        if (
            pending
            and cols
            and ln.strip()
            and not re.search(rf'({CLS})|{NUM}', ln)
            and _boundary_safe(ln, cols["desc"])
        ):
            cell = ln[cols["desc"]:cols["cls"] or cols["tax"]].strip()
            if cell: pending["desc_parts"].append(cell)
            continue
        # Anything structural ends the current item.
        if pending and re.search(r'SUBTOTAL|Recipient:|VAT SUMMARY|Page \d', ln):
            flush_item(pending); pending = None

    flush_item(pending)
    if cur: invoices.append(cur)
    return invoices

out = []
for f in sys.argv[1:]:
    out.extend(parse(f))
out.sort(key=lambda x: int(x["number"]))
print(json.dumps(out, indent=1))
