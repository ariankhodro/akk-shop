# Permission matrix

Generated sections come from code (`node scripts/generate-permission-matrix.mjs`); a test (`backend/tests/rbac.test.js`) fails if any route mounted behind `adminRoute` lacks exactly one rule, or any rule has no route.

## Model

- **Deny by default.** A customer, an inactive admin, or an admin with a missing, malformed, empty or unknown permission list gets nothing. The legacy wildcard `*` is ignored at authorization time.
- **Owner tier** (`isOwner: true`): holds every permission. Only an existing owner, or the operator running `scripts/bootstrap-owner.mjs` (shell + database access), can create an owner. At least one active owner must always remain (enforced in the access-change transaction under the administrator-access lock).
- **Delegation.** An administrator holding `roles.manage` may change access only for administrators who do not hold `roles.manage` and are not owners; may grant only permissions they hold themselves; may never grant `roles.manage` or the owner tier; may not change their own access.
- **Presets** are server-side templates expanded into explicit permission lists (the label is informational).
- **Immediate effect.** The user record is reloaded on every request; any change to role, activity, owner flag or permissions increments `tokenVersion` (revoking outstanding access tokens) and deletes the refresh session. Password reset does the same.
- **Unmapped admin routes are denied for everyone, owners included.**
- **Audit.** Access changes (before/after, target email), refund updates, customer list views, newsletter list views and the sales CSV export are recorded. Access changes, refund changes and the CSV export fail the request if the audit write fails (access changes roll back).
- The frontend only decides which tabs to offer, from the server-computed `effectivePermissions`; it is not an enforcement boundary.

### Route to permission table (generated)

| Method | Route | Required permission |
|---|---|---|
| GET | `/api/analytics` | reports.view |
| GET | `/api/analytics/export` | reports.export |
| GET | `/api/orders/admin` | orders.manage |
| PATCH | `/api/orders/:id/shipment` | orders.manage |
| GET | `/api/products` | catalogue.manage **or** marketing.manage |
| POST | `/api/products` | catalogue.manage |
| PATCH | `/api/products/:id/stock` | catalogue.manage **or** inventory.manage |
| PUT | `/api/products/:id` | catalogue.manage |
| PATCH | `/api/products/:id/active` | catalogue.manage |
| PATCH | `/api/products/:id/variant-stock` | catalogue.manage **or** inventory.manage |
| PATCH | `/api/products/:id` | catalogue.manage |
| DELETE | `/api/products/:id` | catalogue.manage |
| GET | `/api/categories/admin` | catalogue.manage |
| POST | `/api/categories` | catalogue.manage |
| PATCH | `/api/categories/:id` | catalogue.manage |
| DELETE | `/api/categories/:id` | catalogue.manage |
| GET | `/api/campaigns/admin` | marketing.manage |
| POST | `/api/campaigns` | marketing.manage |
| PATCH | `/api/campaigns/:id` | marketing.manage |
| DELETE | `/api/campaigns/:id` | marketing.manage |
| GET | `/api/coupons/admin` | marketing.manage |
| POST | `/api/coupons` | marketing.manage |
| PATCH | `/api/coupons/:id` | marketing.manage |
| DELETE | `/api/coupons/:id` | marketing.manage |
| GET | `/api/newsletter/admin` | marketing.manage |
| PUT | `/api/shipping` | settings.manage |
| GET | `/api/admin/customers` | roles.manage (if held) else customers.manage |
| PATCH | `/api/admin/customers/:id/access` | roles.manage |
| POST | `/api/admin/customers` | wholesale.manage |
| PATCH | `/api/admin/customers/:id/wholesale` | wholesale.manage |
| POST | `/api/admin/customers/:id/password` | wholesale.manage |
| GET | `/api/admin/service-cases` | support.manage |
| PATCH | `/api/admin/service-cases/:id` | support.manage **or** refunds.manage |
| GET | `/api/admin/inventory` | inventory.manage |
| GET | `/api/admin/audit-logs` | audit.view |
| GET | `/api/admin/operations` | system.view |

### Role presets (generated)

| Permission | owner | manager | catalogue_editor | fulfillment | support | sales | marketing | analyst |
|---|---|---|---|---|---|---|---|---|
| `catalogue.manage` | yes | yes | yes |  |  |  |  |  |
| `inventory.manage` | yes | yes | yes | yes |  |  |  |  |
| `orders.manage` | yes | yes |  | yes |  | yes |  |  |
| `customers.manage` | yes | yes |  |  | yes | yes |  |  |
| `wholesale.manage` | yes | yes |  |  |  | yes |  |  |
| `support.manage` | yes | yes |  |  | yes |  |  |  |
| `refunds.manage` | yes | yes |  |  |  |  |  |  |
| `marketing.manage` | yes | yes |  |  |  |  | yes |  |
| `reports.view` | yes | yes |  |  |  | yes |  | yes |
| `reports.export` | yes | yes |  |  |  |  |  |  |
| `settings.manage` | yes | yes |  |  |  |  |  |  |
| `audit.view` | yes | yes |  |  |  |  |  |  |
| `system.view` | yes | yes |  |  |  |  |  |  |
| `roles.manage` | yes |  |  |  |  |  |  |  |

### Other protected actions (permission checked inside the handler)

| Action | Requirement |
|---|---|
| Change refund status / amount / reference on a service case | `refunds.manage` (route also needs `support.manage` or `refunds.manage`) |
| Change case status / resolution note | `support.manage` |
| See other administrators' permission lists, owner flags and role presets in `GET /api/admin/customers` | `roles.manage` or owner |
| Grant or revoke `roles.manage`, change owner flag, modify owners or access managers | Owner only |

### Test coverage

`rbac.test.js` (pure rules, every route x every single permission, unauthenticated/customer/inactive/legacy/malformed lists, delegation and last-owner rules, router-vs-rules enumeration), `auth.integration.test.js` (HTTP: legacy admin denied on every endpoint, owner presets, token revocation, delegate escalation attempts, last-owner protection, audit rows), `admin-migration.test.js` (migration/bootstrap scripts) and the browser journeys in `e2e/run.mjs` (owner, analyst, legacy admin, fulfilment role).
