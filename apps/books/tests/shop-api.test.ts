/**
 * Quickshop API.
 *
 * What an app integrating payments relies on: a key only ever sees its own
 * tenant's shop, a bad cart is refused rather than quietly trimmed, the session
 * Stripe is asked for carries the right lines, prices and owner, and an order
 * lookup will not hand one shop another shop's order — even when both share a
 * Stripe account. Stripe itself is a local fake (STRIPE_API_BASE), so this
 * checks what cashish sends and how it reads the answer, not Stripe's validation.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { uid } from "../src/lib/id";
import { createApiKey } from "../src/lib/auth";
import { GET as products } from "../src/app/api/shop/products/route";
import { POST as checkout } from "../src/app/api/shop/checkout/route";
import { GET as order } from "../src/app/api/shop/orders/[id]/route";

// --- a fake Stripe: remembers every session created, serves them back ---------
const sessions = new Map<string, { form: URLSearchParams; paid: boolean }>();
let lastForm: URLSearchParams;
let fake: Server;

function startFakeStripe(): Promise<string> {
  fake = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "POST" && path === "/v1/checkout/sessions") {
        const id = `cs_test_${sessions.size + 1}`;
        lastForm = new URLSearchParams(raw);
        sessions.set(id, { form: lastForm, paid: false });
        return send(200, { id, object: "checkout.session", url: `https://checkout.test/${id}` });
      }
      const m = path.match(/^\/v1\/checkout\/sessions\/(cs_\w+)(\/line_items)?$/);
      const s = m && sessions.get(m[1]);
      if (!s) return send(404, { error: { type: "invalid_request_error", message: "No such checkout.session" } });
      const metadata: Record<string, string> = {};
      for (const [k, v] of s.form) {
        const key = k.match(/^metadata\[(.+)\]$/)?.[1];
        if (key) metadata[key] = v;
      }
      if (m[2]) {
        return send(200, {
          object: "list",
          has_more: false,
          data: [{ description: s.form.get("line_items[0][price_data][product_data][name]"), quantity: Number(s.form.get("line_items[0][quantity]")), amount_total: 4920 }],
        });
      }
      return send(200, {
        id: m[1],
        object: "checkout.session",
        status: s.paid ? "complete" : "open",
        payment_status: s.paid ? "paid" : "unpaid",
        currency: "eur",
        amount_total: 5420,
        customer_details: { email: "buyer@example.com" },
        collected_information: {
          shipping_details: { name: "Buyer", address: { line1: "1 Main St", city: "Cork", country: "IE", line2: null, postal_code: null, state: null } },
        },
        metadata,
      });
    });
  });
  return new Promise((resolve) =>
    fake.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(fake.address() as AddressInfo).port}`)),
  );
}

// --- fixtures -----------------------------------------------------------------
let a: { id: string; slug: string };
let b: { id: string; slug: string };
let keyA: string;
let keyB: string;
let mug: string;
let secret: string;
let bThing: string;

const product = (tenant: string, name: string, shopVisible: boolean) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.products).values({
      id,
      tenantId: tenant,
      name,
      unitPrice: 20,
      vatRateId: seeded(tenant, "vat-standard"),
      kind: "good",
      shopVisible,
    });
    return id;
  });

const shopSettings = (tenant: string, set: Partial<typeof schema.settings.$inferInsert>) =>
  db.update(schema.settings).set(set).where(eq(schema.settings.tenantId, tenant));

const call = (handler: (r: Request) => Promise<Response>, key: string | null, body?: unknown) =>
  handler(
    new Request("http://books.test/api/shop", {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const lookup = (key: string, id: string) =>
  order(new Request("http://books.test/api/shop/orders", { headers: { authorization: `Bearer ${key}` } }), {
    params: Promise.resolve({ id }),
  });

const good = (items: unknown, extra: Record<string, unknown> = {}) => ({
  items,
  successUrl: "https://app.example/thanks?s={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.example/cart",
  ...extra,
});

before(async () => {
  process.env.STRIPE_API_BASE = await startFakeStripe();
  a = await makeTenant("shopapi-a");
  b = await makeTenant("shopapi-b");
  keyA = (await createApiKey({ tenantId: a.id, name: "app", role: "viewer", createdBy: null })).key;
  keyB = (await createApiKey({ tenantId: b.id, name: "app", role: "viewer", createdBy: null })).key;
  mug = await product(a.id, "Mug", true);
  secret = await product(a.id, "Secret", false);
  bThing = await product(b.id, "B's thing", true);
  await shopSettings(a.id, { shopEnabled: true, shopShipping: 5, stripeSecretKey: "sk_test_fake" });
  await shopSettings(b.id, { shopEnabled: true, stripeSecretKey: "sk_test_fake" });
});
after(async () => {
  delete process.env.STRIPE_API_BASE;
  fake.closeAllConnections();
  fake.close();
  await closePool();
});

test("no key, a junk key → 401", async () => {
  assert.equal((await call(products, null)).status, 401);
  assert.equal((await call(products, "ck_live_nope")).status, 401);
  assert.equal((await call(checkout, null, good([{ id: mug, quantity: 1 }]))).status, 401);
});

test("a key lists only its own tenant's listed products, priced incl. VAT", async () => {
  const bodyA = await (await call(products, keyA)).json();
  assert.deepEqual(
    bodyA.products.map((p: { name: string; price: number }) => [p.name, p.price]),
    [["Mug", 24.6]],
  );
  assert.equal(bodyA.shop.shipping, 5);
  const bodyB = await (await call(products, keyB)).json();
  assert.deepEqual(bodyB.products.map((p: { name: string }) => p.name), ["B's thing"]);
});

test("a switched-off shop is closed to the API too", async () => {
  await shopSettings(a.id, { shopEnabled: false });
  const res = await call(products, keyA);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "shop_disabled");
  await shopSettings(a.id, { shopEnabled: true });
});

test("a bad cart is refused whole, naming the lines", async () => {
  for (const [items, ids] of [
    [[{ id: mug, quantity: 1 }, { id: secret, quantity: 1 }], [secret]], // hidden
    [[{ id: bThing, quantity: 1 }], [bThing]], // another tenant's
    [[{ id: mug, quantity: 0 }], [mug]],
    [[{ id: mug, quantity: 1.5 }], [mug]],
    [[{ id: mug, quantity: 100 }], [mug]],
  ] as const) {
    const res = await call(checkout, keyA, good(items));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).ids, ids);
  }
  for (const body of [
    good([]),
    good([{ id: mug, quantity: 1 }, { id: mug, quantity: 2 }]),
    good([{ id: mug, quantity: 1 }], { successUrl: "javascript:alert(1)" }),
    good([{ id: mug, quantity: 1 }], { cancelUrl: "not a url" }),
  ]) {
    assert.equal((await call(checkout, keyA, body)).status, 400);
  }
});

test("checkout asks Stripe for the right lines, price, shipping and owner", async () => {
  const res = await call(checkout, keyA, good([{ id: mug, quantity: 2 }], { reference: "order-42" }));
  assert.equal(res.status, 201);
  const { sessionId, url } = await res.json();
  assert.match(sessionId, /^cs_test_/);
  assert.equal(url, `https://checkout.test/${sessionId}`);
  assert.equal(lastForm.get("line_items[0][price_data][unit_amount]"), "2460");
  assert.equal(lastForm.get("line_items[0][quantity]"), "2");
  assert.equal(lastForm.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "500");
  assert.equal(lastForm.get("success_url"), "https://app.example/thanks?s={CHECKOUT_SESSION_ID}");
  assert.equal(lastForm.get("metadata[cashish_tenant]"), a.id);
  assert.equal(lastForm.get("metadata[reference]"), "order-42");
});

test("an order reads back paid state; another shop's order is a 404", async () => {
  const { sessionId } = await (await call(checkout, keyA, good([{ id: mug, quantity: 2 }], { reference: "r-1" }))).json();

  let res = await lookup(keyA, sessionId);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.paid, false);
  assert.equal(body.reference, "r-1");

  sessions.get(sessionId)!.paid = true;
  body = await (await lookup(keyA, sessionId)).json();
  assert.equal(body.paid, true);
  assert.equal(body.amountTotal, 54.2);
  assert.equal(body.shippingAddress.city, "Cork");
  assert.deepEqual(body.items, [{ name: "Mug", quantity: 2, amountTotal: 49.2 }]);

  // Same (fake) Stripe account, different cashish tenant: refused.
  assert.equal((await lookup(keyB, sessionId)).status, 404);
  assert.equal((await lookup(keyA, "cs_test_missing")).status, 404);
  assert.equal((await lookup(keyA, "../../v1/balance")).status, 404);
});
