import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withShop, listShopProducts, MAX_QTY } from "@/lib/shop";
import { moneyIn } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ paid?: string; empty?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const name = await withShop(slug, async (shop) => shop.name);
  return { title: name ? `${name} — shop` : "Shop" };
}

export default async function ShopPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const { paid, empty } = await searchParams;
  const page = await withShop(slug, async (shop) => ({
    name: shop.name,
    currency: shop.currency,
    shipping: shop.shipping,
    canSell: !!shop.stripeSecretKey,
    products: await listShopProducts(),
  }));
  if (!page) notFound();
  const base = `/shop/${encodeURIComponent(slug)}`;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">{page.name}</h1>
        {page.products.some((p) => p.kind === "good") && (
          <p className="mt-1 text-sm text-ink-soft">
            {page.shipping > 0
              ? `Flat shipping ${moneyIn(page.shipping, page.currency)} per order.`
              : "Free shipping."}{" "}
            Prices include VAT.
          </p>
        )}
      </header>

      {paid && (
        <div className="card mb-6 p-4 text-sm" role="status">
          Thanks — your order is in.
        </div>
      )}
      {empty && (
        <div className="card mb-6 p-4 text-sm" role="alert">
          Pick a quantity for at least one item, then check out.
        </div>
      )}

      {page.products.length === 0 ? (
        <p className="text-ink-soft">Nothing for sale just yet.</p>
      ) : (
        <form method="post" action={`${base}/checkout`}>
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {page.products.map((p) => (
              <li key={p.id} className="card flex flex-col overflow-hidden">
                {p.hasPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized by the tenant
                  <img
                    src={`${base}/img/${p.id}`}
                    alt={p.name}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full bg-paper" aria-hidden />
                )}
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.description && <p className="mt-1 text-sm text-ink-soft">{p.description}</p>}
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <span className="tabular font-medium">
                      {moneyIn(p.grossPrice, page.currency)}
                    </span>
                    {page.canSell && p.grossPrice > 0 && (
                      <label className="flex items-center gap-2 text-sm text-ink-soft">
                        Qty
                        <input
                          className="input w-20 tabular"
                          type="number"
                          name={`qty:${p.id}`}
                          min={0}
                          max={MAX_QTY}
                          step={1}
                          defaultValue={0}
                          aria-label={`Quantity of ${p.name}`}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {page.canSell && (
            <div className="sticky bottom-0 mt-8 flex justify-end border-t border-line bg-paper/90 py-4 backdrop-blur">
              <button className="btn-primary" type="submit">
                Checkout
              </button>
            </div>
          )}
        </form>
      )}
    </main>
  );
}
