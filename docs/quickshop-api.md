# Quickshop API

The quickshop, for your own app: list what the shop sells, open a Stripe checkout
for a cart, and check whether it was paid. Checkout runs on the business's own
Stripe key (Settings → Payments); the money goes straight to their Stripe account.

- **Auth:** a cashish API key (`Authorization: Bearer ck_live_…`) or OAuth access
  token. The key decides whose shop it is — there is no slug in the URL. A
  `viewer` key is enough. Call from your server: the key is a secret.
- **The shop must be switched on** (Settings → Quickshop), or every call is
  `404 {"error":"shop_disabled"}`.
- Prices are **incl. VAT**, in major units (`24.6` = €24.60).

## List products

```sh
curl https://<cashish>/api/shop/products -H "Authorization: Bearer $CASHISH_KEY"
```

```json
{
  "shop": { "name": "Quickshop Demo", "currency": "EUR", "shipping": 5 },
  "products": [
    { "id": "416c…", "name": "Enamel Mug", "description": "Hand-dipped, 350ml.",
      "kind": "good", "price": 24.6, "currency": "EUR",
      "photoUrl": "https://<cashish>/shop/<slug>/img/416c…" }
  ]
}
```

## Create a checkout

```sh
curl -X POST https://<cashish>/api/shop/checkout \
  -H "Authorization: Bearer $CASHISH_KEY" -H "Content-Type: application/json" \
  -d '{
    "items": [{ "id": "416c…", "quantity": 2 }],
    "successUrl": "https://yourapp.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancelUrl": "https://yourapp.example/cart",
    "reference": "your-order-id"
  }'
```

`201 { "sessionId": "cs_…", "url": "https://checkout.stripe.com/…" }` — send the
customer to `url`. Stripe replaces `{CHECKOUT_SESSION_ID}` in `successUrl`.

- Each `id` must be a product the shop currently lists, once, with a whole
  `quantity` from 1 to 99. Otherwise `400 {"error":"invalid_items","ids":[…]}` —
  the cart is refused whole, never trimmed.
- Flat shipping and an address form are added when any item is a good.
- `409 stripe_not_configured` if the business has no Stripe key.

## Check an order

```sh
curl https://<cashish>/api/shop/orders/cs_… -H "Authorization: Bearer $CASHISH_KEY"
```

```json
{
  "sessionId": "cs_…", "status": "complete", "paid": true,
  "currency": "EUR", "amountTotal": 54.2, "email": "buyer@example.com",
  "items": [{ "name": "Enamel Mug", "quantity": 2, "amountTotal": 49.2 }],
  "shippingAddress": { "name": "Buyer", "line1": "1 Main St", "city": "Cork", "country": "IE", … },
  "reference": "your-order-id"
}
```

Read live from Stripe; cashish stores no orders. Call it when the customer lands
on your `successUrl`. Only sessions created by this shop are returned — anything
else is `404`.

**Not yet:** webhooks. If you need to hear about a payment without the customer
coming back to `successUrl`, poll this endpoint for now.
