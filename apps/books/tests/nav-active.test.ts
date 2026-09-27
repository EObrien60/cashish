import assert from "node:assert/strict";
import test from "node:test";
import { activeHref } from "../src/lib/nav-active";

const hrefs = ["/", "/reports", "/reports/cashflow", "/payroll", "/invoices"];

test("the longest matching href wins", () => {
  assert.equal(activeHref("/reports/cashflow", hrefs), "/reports/cashflow");
  assert.equal(activeHref("/reports", hrefs), "/reports");
  assert.equal(activeHref("/payroll/runs/abc", hrefs), "/payroll");
});

test("/ only matches itself, and a shared prefix is not a match", () => {
  assert.equal(activeHref("/", hrefs), "/");
  assert.equal(activeHref("/settings", hrefs), null);
  assert.equal(activeHref("/invoicesx", hrefs), null);
});
