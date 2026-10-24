# HTTP hardening (SEC-2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 16; FE-13..15; roadmap S-1, S-2, X-1, X-2)

This file records what was changed, why the Content-Security-Policy looks the way it does, and what the
deployment and frontend still need to do.

## 1. Security headers for HTML (SEC-2, S-1)

Source of truth: `seo/security-headers.js`. The same values are in `vercel.json` (`headers`, applied to every
path except `/api/*`, which is proxied to the backend and keeps its own API headers) and are set by
`sendHtml()` for the `/api/page-shell` and `/api/share-preview` functions. `backend/tests/http-hardening.test.js`
fails if `vercel.json`, `sendHtml` and `frontend/index.html` drift apart.

| Header | Value | Why |
| --- | --- | --- |
| Content-Security-Policy | see below | defence in depth against XSS and data exfiltration |
| X-Frame-Options | `DENY` | clickjacking of cart, profile, admin panel (old browsers; CSP `frame-ancestors` is the modern control) |
| Referrer-Policy | `strict-origin-when-cross-origin` | the password-reset token travels in `/reset-password?token=`; it must not leak via Referer |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | the storefront uses none of these |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` | no `preload` on purpose: submit to the preload list only after all subdomains are confirmed HTTPS |
| X-Content-Type-Options | `nosniff` | |

### CSP rationale

```
default-src 'self'; script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: https://res.cloudinary.com https://trustseal.enamad.ir;
connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-src 'none';
frame-ancestors 'none'; base-uri 'self';
form-action 'self' https://www.zarinpal.com https://sandbox.zarinpal.com;
upgrade-insecure-requests
```

* `script-src 'self'`: no inline script, no `eval`. The only inline script (theme bootstrap) was moved to
  `frontend/public/theme-init.js`, so no hash is needed and nothing has to be recomputed when it changes.
  JSON-LD blocks are `type="application/ld+json"` (data, not executed).
* `style-src 'unsafe-inline'`: required by React `style={...}` props and by the inline `style=""` attributes of
  the server-rendered SEO markup (`api/share-preview.js`). This is the weaker half of the policy but style
  injection is far less dangerous than script injection, and scripts stay locked down. Removing it needs a
  refactor of every inline style to classes (and a nonce/hash story for the SEO markup); not done here.
* Fonts: `frontend/src/index.css` starts with `@import url('https://fonts.googleapis.com/css2?family=Vazirmatn...')`.
  That file is outside this change's ownership and the build environment has no route to fetch the font files,
  so the Google hosts are allowed (exact hosts only: `fonts.googleapis.com` for the stylesheet,
  `fonts.gstatic.com` for the font files). Better follow-up: download Vazirmatn woff2 into
  `frontend/public/fonts/`, replace the `@import` with local `@font-face`, then drop both Google hosts from
  `style-src`/`font-src` (this also removes a render-blocking third-party request and a privacy leak, FE-5).
* `img-src`: Cloudinary (managed product/category/campaign images, see section 2) and the eNAMAD seal
  (`StoreFooter.jsx` default image). `data:` is kept for small inline images. Because product image URLs are now
  restricted to Cloudinary (or already stored legacy values), `https:` is deliberately NOT allowed.
  Legacy products that still point at another HTTPS host will show a broken image until re-uploaded.
* `connect-src 'self'`: the SPA calls `/api/*` on its own origin (`axios` base `/api`, rewritten by Vercel).
  If a deployment sets `VITE_API_URL` to a different origin, add that origin to `connect-src` in
  `seo/security-headers.js` and `vercel.json`.
* `form-action`: Zarinpal redirects happen via `window.location.assign` (not restricted by CSP), but the
  gateway hosts are listed in case a form post is ever used. The newsletter confirmation forms post to `'self'`.
* `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.

### Browser verification

`npm run build --prefix frontend`, then the built `dist` was served by a small static server applying the
`vercel.json` headers (SPA fallback to `index.html`, `/api/*` answered with stub JSON) and loaded in the
pre-installed Playwright Chromium, light and dark theme, with `securitypolicyviolation` listeners and console
capture on `/`, `/product/<id>` (Cloudinary image), `/login`, `/shop` and `/cart`:

* 0 CSP violations on all 10 page loads (5 routes x 2 themes); the saved dark theme was applied by the external
  `theme-init.js`.
* Allowed third-party requests were attempted as expected (Google Fonts CSS, eNAMAD seal, Cloudinary image).
* Negative control: injecting an inline script and an image from `evil.example` produced the expected
  `script-src` and `img-src` violations, so the policy is being enforced.
* The home route logged `k is not iterable` from the page code. It is caused by the stub API payload shape used
  in the harness, not by CSP.

Not verified (needs a real deployment): the Zarinpal redirect and Vercel's handling of the `headers` rule against
the `/api/page-shell` rewrites. After deploying run
`curl -sI https://<site>/ https://<site>/login https://<site>/product/<id> | grep -i -E 'content-security|x-frame|strict-transport|referrer|permissions'`.

### vercel.json API host (FE-14)

The hard-coded backend host in the first `/api/:path*` rewrite was left in place. `vercel.json` cannot read
environment variables, so removing it would require either an env-driven build step or moving the proxy into a
function; both change deployment topology and cannot be validated here. Operational follow-up: generate
`vercel.json` from a template at build time (or serve the API on `api.<domain>` with `VITE_API_URL`, adding
that origin to `connect-src`). The `/api/robots|sitemap*|page-shell|share-preview` functions still rely on
Vercel resolving filesystem functions before rewrites (documented, covered by no test).

## 2. Product images (SEC-3, SEC-9, S-2)

`createProduct`/`updateProduct` now use `resolveManagedImageList` (`backend/lib/image-upload.js`):

* data URLs: strict `data:image/(jpeg|png|webp|gif);base64` validation (signature, size <= 5 MB decoded,
  dimensions <= 8192 px / 40 MP), uploaded to the `products` folder. SVG is rejected.
* HTTPS URLs: accepted only if they are managed Cloudinary assets of this cloud in `products/` (extension, if
  any, must be jpg/jpeg/png/webp/gif) or exactly equal to an image already stored on that product (so legacy
  values survive an edit).
* local paths, `http:`, `ftp:`, `s3:`, `gs:`, `file:` and protocol-relative strings are rejected with 400;
  non-string entries and more than 8 images are rejected.
* uploads made by a request are deleted if a later image is rejected or the DB write fails; on update the
  images dropped from the gallery are deleted, and on product delete every image is deleted, all through
  `deleteManagedCloudinaryImage` (host, cloud name, folder and traversal checks; ids containing dots are
  handled; foreign URLs are never passed to Cloudinary).
* An update that sends neither `image` nor `images` keeps the existing gallery (it used to wipe it).
* Create returns 400 (not 500) for schema validation errors.

Behavioural note for admins: image formats other than JPG/PNG/WebP/GIF (AVIF, HEIC, SVG) and images above
8192 px are now rejected where Cloudinary previously accepted some of them.

## 3. Body parsing order (SEC-4)

`backend/middleware/body-parsers.middleware.js`: the global parser stays at 1 MB and skips exactly the six
content-management routes; those mount `largeJsonBody` (10 MB) after `protectRoute, adminRoute`
(`product|category|campaign` routes). `backend/tests/body-limits.test.js` sends anonymous 9 MB bodies to all
six routes, expects 401 and asserts via a `JSON.parse` spy that nothing larger than 1 MB was parsed.
Vercel's own request body cap (about 4.5 MB for functions) still applies in front of this.

## 4. `/api/ready` (SEC-11)

* `READINESS_TOKEN` set: callers must send `X-Readiness-Token: <token>` or `Authorization: Bearer <token>`,
  otherwise 401 before any DB/Redis work. Authorised callers get the full `{status, database, redis}`.
* `READINESS_TOKEN` unset: anonymous callers get only `{status}` (200/503).
* `/api/health` stays public and trivial. Update uptime monitors to send the token.

## 5. Newsletter double opt-in (SEC-6, X-1)

* `POST /api/newsletter/subscribe {email, consent:true}` creates a `pending` subscriber and mails a
  single-use confirmation link (random 256-bit token, only its SHA-256 is stored, 3-day expiry, one mail per
  address per 5 minutes). The response is the same whether or not the address exists/was mailed.
* The link is `GET /api/newsletter/confirm?token=...`: it renders a page with a button; the state change happens
  on `POST /api/newsletter/confirm` (JSON `{token}` or `?token=`), so link scanners cannot confirm.
* An opted-out address stays `unsubscribed` until a new confirmation completes. A subscribed address is never
  modified by the public form.
* Unsubscribe: `POST /api/newsletter/unsubscribe {token}` (HMAC-signed, `NEWSLETTER_TOKEN_SECRET`, >= 32
  chars; usable as one-click `List-Unsubscribe-Post` target). `GET /api/newsletter/unsubscribe?token=` renders a
  confirm button. `POST {email}` only mails the signed link to that address (uniform response), so nobody can
  unsubscribe a third party. Future newsletter mail must embed `createUnsubscribeToken(subscriberId)`
  (`backend/lib/newsletter-tokens.js`).
* Fail safe: without `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL`/`FRONTEND_URL` nothing is sent, the record stays
  `pending` (no token stored), an email-only unsubscribe request changes nothing. Pending rows are not mailed
  retroactively when the transport is later enabled; the visitor has to submit the form again.
* Legacy rows (no `status`) are reported as `pending`/`unsubscribed`, never as active consent; the admin list
  returns `status` and a derived `isSubscribed`, and `summary` now has `total/subscribed/pending/unsubscribed`.

Frontend changes needed (not done, `frontend/src/**` is out of scope):
1. `StoreFooter.jsx` / `StoreInfoPage.jsx`: copy says delivery is "not connected"; show the server `message`
   (already done for the footer) and mention the confirmation email.
2. `NewsletterUnsubscribePage.jsx`: keep the email form (it now means "send me an unsubscribe link"); optionally
   read `?token=` and `POST /newsletter/unsubscribe {token}` for a SPA-styled page instead of the API-rendered one.
3. `NewsletterManager.jsx`: show `subscriber.status` (pending/subscribed/unsubscribed) instead of mapping every
   non-subscribed row to "unsubscribed", and `summary.pending`.
Because the email links point at `/api/newsletter/...` (served through the existing `/api` rewrite) no new SPA
route is required.

## 6. Campaign links, projections, queries (SEC-7, 8, 10, 13, 16)

* `isSafeInternalHref` (`backend/lib/internal-href.js`, copy in `seo/internal-href.js`, kept in sync by test):
  must start with a single `/`, no backslash/whitespace/control characters, resolves to the same origin when
  parsed against a dummy origin. Used by the campaign controller, the Mongoose validator and `share-preview`.
  Existing campaigns with an invalid href fail validation on the next edit and must be fixed by an admin.
* Category products: unknown slugs return 404 before the facet aggregation; legacy slugs must have active
  products; only existing slugs ever create a Redis key. Page numbers on public search/category lists are
  capped at 200 (admin list unchanged).
* Public projections: `__v` removed, best-sellers no longer return `soldQuantity`/`orderCount`
  (cache key `bestselling_products_v2`), campaign detail no longer returns `views`/`clicks`.
  Exact `stock` (product and per-variant) is KEPT: `useCartStore`, `ProductCard`, `CartItem` and
  `ProductDetailsPage` compare against exact numbers. Moving to in-stock/low/out buckets needs a coordinated
  frontend change.
* `GET /campaigns/:id` still increments `views` (the storefront has no beacon yet) except for prefetch/HEAD,
  bots, `node`/`undici`/`curl` user agents and requests sending `X-Skip-View-Count: 1` (the SEO renderer does).
  `POST /campaigns/:id/view` now exists. Migration: storefront calls it once per campaign page view, then set
  `CAMPAIGN_VIEWS_ON_GET=false` to make GET read-only. Click/view POSTs remain unauthenticated and bounded by
  the API rate limit only.
* SEC-16: `sort` lookup uses `Object.hasOwn`; campaign `productIds` must be 24-hex strings/ObjectIds;
  free-form product attributes (products without a category) are limited to 50 keys with safe key names and
  primitive / short string-array values.

## 7. SEO functions (SEC-12, FE-13, FE-15, X-2)

* `/[\r\n]/` fix in both filter loops; shell promise cannot reject unhandled.
* `getInternalOrigin()` (`seo/server-utils.js`): `VERCEL_URL` (this deployment), else `PUBLIC_SITE_URL`, else the
  request origin only when neither `VERCEL` nor `NODE_ENV=production` is set. Used for the shell fetch and for
  relative `API_BASE_URL` values. A deployed instance with no configured origin returns 503 instead of trusting
  `Host`. Preview deployments behind Vercel Deployment Protection still cannot fetch their own shell (unchanged).
* The last good shell per origin is kept in memory and served (up to 6 h) when a fresh fetch fails; with nothing
  cached `page-shell` answers a noindex HTML 503 with `Retry-After`.
* Not done: serving non-SEO private routes straight from static `index.html` or inlining the shell at build
  time (FE-13 full fix); `robots.txt` Disallow rules (FE-34: `noindex` headers remain the indexing control).

## Environment variables introduced or relevant

| Name | Purpose |
| --- | --- |
| `READINESS_TOKEN` | shared secret for `/api/ready` |
| `NEWSLETTER_TOKEN_SECRET` | >= 32 random chars, signs unsubscribe links |
| `CAMPAIGN_VIEWS_ON_GET` | `false` makes `GET /campaigns/:id` read-only |
| `PUBLIC_SITE_URL` | must be set on the SEO functions (canonical + shell origin fallback) |
| `APP_URL` / `FRONTEND_URL`, `RESEND_API_KEY`, `EMAIL_FROM` | already used for password reset; now also newsletter mail |

## Deployment checklist

1. Set `PUBLIC_SITE_URL` (SEO functions), `READINESS_TOKEN` and `NEWSLETTER_TOKEN_SECRET` (backend); update any
   uptime monitor of `/api/ready` to send the token (or use `/api/health`).
2. Deploy, then run the `curl -sI` check above and click through `/`, a product, `/login`, cart, checkout.
3. Watch the browser console for CSP reports for one release; adjust `seo/security-headers.js` AND `vercel.json`
   together (test enforces equality).
4. Re-upload any legacy products whose images are not on Cloudinary.
