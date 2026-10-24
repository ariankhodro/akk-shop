# Persian Commerce Store

A Persian-first, right-to-left e-commerce storefront for Iranian customers. The active checkout configuration is limited to **IRT (Toman)** pricing and **Zarinpal** payment.

## Core features

- Persian RTL home, shop, category, product, cart, wishlist, account, and order pages.
- Whole-Toman price formatting, product/variant stock validation, coupons, campaigns, and shipping settings.
- Server-side Zarinpal checkout, payment verification, inventory reservation, idempotent finalization, and scheduled reconciliation.
- Customer order history, Iranian delivery addresses, shipment tracking, admin fulfillment operations, audit logs, and operational metrics.
- Persian/Arabic search normalization, explicit security headers, credentialed CORS allowlisting, origin checks, and rate limiting.
- React/Vite frontend, Express API, MongoDB/Mongoose, Redis, and Cloudinary media storage.

## Payment and currency policy

The application supports one order currency (`IRT`) and one payment provider (`zarinpal`). The order schema restricts those fields to these values and the frontend price helper displays Toman only.

Checkout remains disabled until `IRT_CATALOG_PRICES_CONFIRMED=true` is set after each product price and shipping amount has been checked and confirmed as a whole-Toman value. The application converts the verified Toman amount to Rial only when preparing the gateway request.

Order documents without explicit IRT/Zarinpal metadata are preserved in the database but excluded from the active customer/admin order lists and revenue metrics. Their numeric amount fields are not automatically converted. This avoids silently changing historical financial values.

## Local development

From the repository root:

```bash
npm ci
npm ci --prefix frontend
npm run dev
npm run dev --prefix frontend
```

Configure the backend variables documented in the main [README](../README.md). Set `VITE_API_URL` only when the API is not reachable through the same-origin `/api` path.

## Existing database

Before deployment, take a verified backup and run the guarded migration documented in [Persian commerce setup](PERSIAN_COMMERCE_SETUP.md):

```bash
node scripts/migrate-orders-to-zarinpal-only.mjs
```

This removes the obsolete checkout-session index and stale provider/currency metadata while preserving order documents and amount fields. It does not perform currency conversion. After the migration, only records explicitly marked with the active IRT/Zarinpal policy appear in the current order history.

## Production checklist

- Verify catalogue and shipping prices before enabling checkout.
- Configure `MONGO_URI`, Redis, authentication secrets, Cloudinary, Zarinpal, exact CORS origins, `API_URL`, `CLIENT_URL`, and `CRON_SECRET`.
- Use a replica set or compatible managed MongoDB deployment for transactions.
- Test the full sandbox lifecycle, including failed requests, timeouts, duplicate callbacks, stock release, and reconciliation.
- Schedule reconciliation and monitor its results. A deployed API does not start a scheduler by itself.
- Run frontend builds and backend tests on the exact release commit.

See [Persian commerce setup](PERSIAN_COMMERCE_SETUP.md) for detailed environment, hosting, database, migration, and operational instructions.
