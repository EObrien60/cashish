import { db, schema, first, runInTenant, tenantId } from "@cashish/core/db";
import { and, asc, eq } from "drizzle-orm";
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

/**
 * Resolves an enabled shop by slug and runs fn in that tenant's context, as a
 * viewer. Returns null for an unknown slug or a shop that is switched off — the
 * two are indistinguishable to a visitor on purpose.
 */
export async function withShop<T>(
  slug: string,
  fn: (shop: Shop) => Promise<T>,
): Promise<T | null> {
  const row = first(
    await db
      .select({
        tenantId: tenants.id,
        currency: tenants.currency,
        name: settings.businessName,
        shipping: settings.shopShipping,
        stripeSecretKey: settings.stripeSecretKey,
      })
      .from(tenants)
      .innerJoin(settings, eq(settings.tenantId, tenants.id))
      .where(and(eq(tenants.slug, slug), eq(settings.shopEnabled, true)))
      .limit(1),
  );
  if (!row) return null;
  const shop: Shop = {
    slug,
    name: row.name,
    currency: row.currency,
    shipping: row.shipping,
    stripeSecretKey: row.stripeSecretKey ?? "",
  };
  return runInTenant({ tenantId: row.tenantId, role: "viewer", actor: "shop" }, () => fn(shop));
}

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
