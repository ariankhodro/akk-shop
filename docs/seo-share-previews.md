# SEO metadata and social share previews

The React storefront updates page titles, descriptions, canonical URLs, Open Graph/Twitter tags, and Product/CollectionPage/Event structured data after the page loads. Because many messaging and social preview crawlers do not execute JavaScript, Vercel also serves a compact server-rendered HTML response for known preview user agents on:

- `/product/:productId`
- `/category/:slug`
- `/campaign/:campaignId`

The rewrites target only recognized preview bots; regular visitors continue to receive the React application. Preview requests use the public product/category/campaign APIs and do not increment the campaign's view counter.

Product offer structured data uses ISO currency `IRR`; product prices are stored/displayed as whole Toman, so the JSON-LD price is multiplied by 10 (one Toman equals ten Rials).

## Vercel configuration

The deployment should use the repository root so that `vercel.json` and `api/share-preview.js` are detected. If the API is not served by the existing `/api/*` proxy, set `API_BASE_URL` on the Vercel project to the absolute API base ending in `/api` (for example, `https://api.example.com/api`). Otherwise, the preview handler falls back to the same-origin `/api` route already configured in `vercel.json`.

The preview HTML is cached for five minutes and stale content can be served while it revalidates. After deployment, test product/category/campaign links with at least one supported crawler user-agent and confirm that a regular browser still receives the React app.
