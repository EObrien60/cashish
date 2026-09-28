/**
 * Quickshop.
 *
 * The shop is the one unauthenticated read into a tenant's books, so what
 * matters is what it refuses: a shop that is switched off, a product that is
 * hidden or archived, another tenant's product under this tenant's slug, and a
 * photo of anything not currently listed.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { uid } from "../src/lib/id";
import { withShop, listShopProducts, getShopProduct, setProductPhoto } from "../src/lib/shop";
import { GET as photo } from "../src/app/shop/[slug]/img/[id]/route";

let a: { id: string; slug: string };
let b: { id: string; slug: string };

const product = (tenant: string, name: string, extra: Partial<typeof schema.products.$inferInsert> = {}) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.products).values({
      id,
      tenantId: tenant,
      name,
      unitPrice: 100,
      vatRateId: seeded(tenant, "vat-standard"),
      kind: "good",
      ...extra,
    });
    return id;
  });

const enable = (tenant: string, on: boolean) =>
  db.update(schema.settings).set({ shopEnabled: on }).where(eq(schema.settings.tenantId, tenant));

const names = (slug: string) =>
  withShop(slug, async () => (await listShopProducts()).map((p) => p.name));

const photoStatus = async (slug: string, id: string) =>
  (await photo(new Request("http://x"), { params: Promise.resolve({ slug, id }) })).status;

let listed: string;
let hidden: string;

before(async () => {
  a = await makeTenant("shop-a");
  b = await makeTenant("shop-b");
  listed = await product(a.id, "Mug", { shopVisible: true });
  hidden = await product(a.id, "Secret", { shopVisible: false });
  await product(a.id, "Old", { shopVisible: true, archived: true });
  await product(b.id, "B's thing", { shopVisible: true });
  const png = { name: "p.png", type: "image/png", bytes: Buffer.from("png") };
  await asTenant(a.id, () => setProductPhoto(listed, png));
  await asTenant(a.id, () => setProductPhoto(hidden, png));
});
after(closePool);

test("a switched-off shop and an unknown slug both resolve to nothing", async () => {
  await enable(a.id, false);
  assert.equal(await names(a.slug), null);
  assert.equal(await names("no-such-shop"), null);
  assert.equal(await photoStatus(a.slug, listed), 404);
});

test("lists only visible, unarchived products, priced incl. VAT", async () => {
  await enable(a.id, true);
  assert.deepEqual(await names(a.slug), ["Mug"]);
  const mug = await withShop(a.slug, () => getShopProduct(listed));
  assert.equal(mug?.grossPrice, 123);
});

test("one tenant's product is unreachable through another tenant's shop", async () => {
  await enable(a.id, true);
  await enable(b.id, true);
  assert.deepEqual(await names(b.slug), ["B's thing"]);
  assert.equal(await withShop(b.slug, () => getShopProduct(listed)), null);
  assert.equal(await photoStatus(b.slug, listed), 404);
});

test("serves a listed product's photo and refuses a hidden one", async () => {
  await enable(a.id, true);
  assert.equal(await photoStatus(a.slug, listed), 200);
  assert.equal(await photoStatus(a.slug, hidden), 404);
});
