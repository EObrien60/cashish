import { db, schema, first, runInTenant, tenantId } from "@cashish/core/db";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { extname } from "node:path";
import { round2 } from "./format";
import { putBlob, deleteBlob } from "./storage";

// ---------------------------------------------------------------------------
// Quickshop: the product library, published at /shop/<tenant slug>.
//
// The one public, unauthenticated read path into a tenant's books, so it is
// deliberately narrow: the shop must be switched on, a product must be both
// shopVisible and not archived, and nothing here ever returns a row wholesale —
// only the fields a storefront shows. The tenant comes from the slug, and
// everything after the lookup runs inside runInTenant like any other request.
// ---------------------------------------------------------------------------

const { tenants, settings, products, vatRates } = schema;

export const PHOTO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export type Shop = {
  slug: string;
  name: string;
  currency: string;
  shipping: number;
  /** Server-only: never pass a Shop to a client component. */
  stripeSecretKey: string;
};

async function loadShop(where: SQL): Promise<(Shop & { tenantId: string }) | null> {
  const row = first(
    await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        currency: tenants.currency,
        name: settings.businessName,
        shipping: settings.shopShipping,
        stripeSecretKey: settings.stripeSecretKey,
      })
      .from(tenants)
      .innerJoin(settings, eq(settings.tenantId, tenants.id))
      .where(and(where, eq(settings.shopEnabled, true)))
      .limit(1),
  );
  return row ? { ...row, stripeSecretKey: row.stripeSecretKey ?? "" } : null;
}

/**
 * Resolves an enabled shop by slug and runs fn in that tenant's context, as a
 * viewer. Returns null for an unknown slug or a shop that is switched off — the
 * two are indistinguishable to a visitor on purpose.
 */
export async function withShop<T>(
  slug: string,
  fn: (shop: Shop) => Promise<T>,
): Promise<T | null> {
  const found = await loadShop(eq(tenants.slug, slug));
  if (!found) return null;
  const { tenantId: id, ...shop } = found;
  return runInTenant({ tenantId: id, role: "viewer", actor: "shop" }, () => fn(shop));
}

/** The current tenant's shop, or null while it is switched off. For the API. */
export async function currentShop(): Promise<Shop | null> {
  const found = await loadShop(eq(tenants.id, tenantId()));
  if (!found) return null;
  const { tenantId: _id, ...shop } = found;
  return shop;
}

/**
 * Stripe metadata for a shop checkout. The tenant id is what lets an order
 * lookup refuse a session that some other shop created on a shared Stripe account.
 */
export const checkoutMetadata = (reference?: string): Record<string, string> => ({
  cashish_tenant: tenantId(),
  ...(reference ? { reference } : {}),
});

export type ShopProduct = {
  id: string;
  name: string;
  description: string;
  kind: string;
  hasPhoto: boolean;
  photoPath: string;
  /** Incl. VAT — what a consumer pays. */
  grossPrice: number;
};

async function shopProducts(id?: string): Promise<ShopProduct[]> {
  const conds = [
    eq(products.tenantId, tenantId()),
    eq(products.shopVisible, true),
    eq(products.archived, false),
  ];
  if (id) conds.push(eq(products.id, id));
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      kind: products.kind,
      photoPath: products.photoPath,
      unitPrice: products.unitPrice,
      rate: vatRates.rate,
    })
    .from(products)
    .leftJoin(
      vatRates,
      and(eq(vatRates.tenantId, products.tenantId), eq(vatRates.id, products.vatRateId)),
    )
    .where(and(...conds))
    .orderBy(asc(products.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    hasPhoto: !!r.photoPath,
    photoPath: r.photoPath,
    grossPrice: round2(r.unitPrice * (1 + (r.rate ?? 0))),
  }));
}

export const listShopProducts = () => shopProducts();
export const getShopProduct = async (id: string) => (await shopProducts(id))[0] ?? null;

/** Replaces a product's shop photo. Caller holds books:write. */
export async function setProductPhoto(
  productId: string,
  file: { name: string; type: string; bytes: Buffer },
) {
  const tid = tenantId();
  const current = first(
    await db
      .select({ photoPath: products.photoPath })
      .from(products)
      .where(and(eq(products.tenantId, tid), eq(products.id, productId)))
      .limit(1),
  );
  if (!current) throw new Error("Product not found.");
  const ext = extname(file.name).toLowerCase();
  if (!PHOTO_MIME[ext]) throw new Error("Photos must be PNG, JPEG or WebP.");
  // A fresh pathname per upload, so a cached old photo can never be served for the new one.
  const pathname = `tenants/${tid}/products/${productId}-${Date.now()}${ext}`;
  await putBlob(pathname, file.bytes, PHOTO_MIME[ext]);
  await db
    .update(products)
    .set({ photoPath: pathname })
    .where(and(eq(products.tenantId, tid), eq(products.id, productId)));
  if (current.photoPath) await deleteBlob(current.photoPath);
}

/** The current tenant's shop path, whether or not the shop is switched on. */
export async function ownShopPath(): Promise<string> {
  const row = first(
    await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId())).limit(1),
  );
  return `/shop/${encodeURIComponent(row?.slug ?? "")}`;
}

export const MAX_QTY = 99;

export type CartLine = { product: ShopProduct; quantity: number };

/**
 * Turns a posted shop form (`qty:<productId>` → quantity) into cart lines.
 * Anything the visitor could tamper with is re-checked here: only products
 * currently listed in THIS shop count, prices come from the database, and a
 * quantity that is not a whole number from 1 to MAX_QTY is dropped.
 */
export async function resolveCart(entries: Iterable<[string, unknown]>): Promise<CartLine[]> {
  const wanted = new Map<string, number>();
  for (const [key, raw] of entries) {
    if (!key.startsWith("qty:")) continue;
    const qty = Number(raw);
    if (Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY) wanted.set(key.slice(4), qty);
  }
  if (wanted.size === 0) return [];
  return (await listShopProducts())
    .filter((p) => wanted.has(p.id) && p.grossPrice > 0)
    .map((product) => ({ product, quantity: wanted.get(product.id)! }));
}
