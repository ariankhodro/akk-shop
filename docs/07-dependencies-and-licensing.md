# 07 — Dependencies and licensing

Evidence: `npm ci`, `npm audit --json`, `npm outdated`, and a script reading licence fields from installed packages (all run in a copy of the repo; see report 09). No upgrades were applied or tested.

## 1. Repository licence — **needs a decision before commercial use** (High, VERIFIED)
- `LICENSE` is the **unmodified GNU GPL v2 text** (339 lines). Its only "Copyright" lines are the FSF boilerplate (lines 4, 294, 315): **no copyright holder or year is named for this project**.
- `README.md:11` shows an **MIT** badge linking to that same `LICENSE`. The badge and the file contradict each other. `package.json` has `"license": "ISC"` (a third statement) and the `backend`/`frontend` manifests have none.
- The git history (729 commits) contains 4 commits by "Burak"/"Burak Orkmez" dated from 2024-08-28; the other 725 are by ItsWanheda. This indicates the repo derives from an earlier public project. **I could not verify the upstream repository or its licence** (no network/API access to it). If the upstream is under a licence with attribution/notice requirements, those apply to the derived code regardless of what this repo says.
- What GPL‑2.0 means for you (not legal advice):
  - You **may** use it commercially and run a store with it, and modify it for your own brand.
  - If you **distribute** the software (including to others/clients, or arguably the frontend JavaScript bundle delivered to browsers), you must provide corresponding source under GPL‑2.0, keep notices, and may not add further restrictions. Running the backend privately on your server is generally not "distribution" under GPL‑2.0 (there is no network clause as in AGPL), but the browser bundle is code you send to users — get a lawyer's view if you want to keep your customisations closed.
  - You cannot relicense it as MIT/proprietary unless you hold the copyright (or all copyright holders agree).
- Action: confirm upstream provenance and licence; decide GPL‑2.0 vs. relicense; fix the README badge, `package.json` `license`, and add a proper copyright notice. (Roadmap L-1.)

## 2. Bundled assets — provenance unknown (Medium, NOT VERIFIABLE)
`frontend/public/`: `bags.jpg`, `glasses.png`, `jackets.jpg`, `jeans.jpg`, `shoes.jpg` (1.7 MB), `suits.jpg`, `tshirts.jpg` (category photos), `screenshot-for-readme.png`, `favicon.svg`, `vite.svg`. No attribution or licence file for any image. I cannot determine whether you may use them commercially or redistribute them. Treat them as **unlicensed until the owner confirms**; replace them with your own photography for your brand anyway. `vite.svg` is the Vite logo (unused, can be deleted).
Fonts: Vazirmatn is loaded from Google Fonts (SIL OFL 1.1 — permissive); no font files are bundled.

## 3. Dependency licences (VERIFIED from installed `package.json` fields)
| Scope | Result |
|---|---|
| Root/backend (146 packages incl. dev) | MIT 127, ISC 8, Apache‑2.0 7, BSD‑3 2, BSD‑2 2 |
| Frontend (≈405 packages incl. dev) | MIT 344, ISC 34, Apache‑2.0 10, BSD‑2 6, BSD‑3 5, BlueOak‑1.0.0 3, 0BSD 1, "BSD" 1, "MIT AND ISC" 1, **Python‑2.0 1** (`argparse@2.0.1`, dev-only via eslint), **CC‑BY‑4.0 1** (`caniuse-lite`, data; dev/build-only, not shipped) |
| Direct production deps | react, react-dom, react-confetti, react-hot-toast, react-router-dom, recharts, framer-motion, zustand, axios: MIT; lucide-react: ISC (v0.435 — icon licence is ISC, with part derived from MIT Feather icons) |
No GPL/AGPL/SSPL dependency found in the installed trees. Licence fields are self-declared; I did not read each package's LICENSE file. **Dev tools** (eslint, vite, tailwind, postcss) are not shipped. The CC‑BY‑4.0 (caniuse-lite) and Python‑2.0 entries are build/dev-time only; no attribution obligation arises from the shipped bundle as far as I can tell (unverified).
Conclusion: third-party dependencies permit commercial use, modification and redistribution; the constraint comes from the project's own GPL‑2.0.

## 4. Known vulnerabilities (`npm audit`, VERIFIED output; exploitability assessed only where stated)
Counts — root: 16 (2 critical, 9 high, 1 moderate, 4 low); production-only 13. Frontend: 28 (1 critical, 18 high, 8 moderate, 1 low); production-only 9. `npm audit` reports a fix as available for each; I did not apply or test them. Most direct deps have in-range ("wanted") newer versions (see §5).

### Backend (runtime-relevant)
| Package (installed) | Advisory (as reported) | Relevance to this code |
|---|---|---|
| `jws` 3.2.2 (via `jsonwebtoken` 9.0.2) | high: "Improperly Verifies HMAC Signature" (<3.2.3) | **Directly relevant**: access and refresh tokens are HS256 JWTs verified through `jsonwebtoken`→`jws`. I did not reproduce the flaw or read the advisory's exploit conditions offline — treat as P0 to upgrade (`jsonwebtoken` 9.0.3). |
| `mongoose` 8.5.3 | critical + high "search injection" (<8.9.5), high `$nor` in `sanitizeFilter` (≤8.22.0), moderate prototype pollution in update casting (<8.24.1) | Relevant to a NoSQL‑heavy app; the "search" advisories may concern `$search`/text features this code does not use (not verified). Upgrade to ≥8.24.x. Note the code does **not** enable `sanitizeFilter` (SEC‑1). |
| `proxy-addr` 2.0.7 (via `express`) | critical: IP spoofing via IPv4-mapped IPv6 trust subnet (<2.0.8) | Relevant: `app.set("trust proxy", 1)` and per-IP rate limits use `req.ip`. Conditions depend on the trust-proxy value/subnet config; unverified. |
| `express` 4.19.2 (+ `body-parser` 1.20.2, `path-to-regexp` 0.1.7) | high (body-parser DoS, path-to-regexp ReDoS), low (redirect XSS) | Upgrade to 4.22.x (same major). |
| `cloudinary` 2.4.0 | high: argument injection via `&` in parameters (<2.7.0) | Relevant: used for admin uploads (SEC‑3). |
| `cookie-parser` 1.4.6 (`cookie`) | low | Minor. |
| `lodash`, `minimatch`, `brace-expansion`, `picomatch` (transitive) | high ReDoS/prototype pollution | Mostly dev/transitive (cloudinary pulls lodash); low practical risk. |

### Frontend (mostly build-time)
Direct: `axios` 1.7.5 (high: SSRF/credential leakage via absolute URL, DoS — relevant because `axios` is shipped, though the app uses a fixed baseURL; upgrade to 1.20), `react-router-dom` 6.26.1 (high: open redirect/XSS in redirects — the app does not use user-supplied redirect targets as far as reviewed; upgrade to 6.30.x), `vite` 5.4.2 / `postcss` 8.4.41 / `rollup` / `nanoid` / `form-data` / `js-yaml` / `glob` / `cross-spawn` / `flatted` / `browserslist` (dev/build tooling — risk is to the build machine/dev server, not end users). `form-data` critical is transitive in dev tooling.

## 5. Outdated direct dependencies (`npm outdated`)
Backend: cloudinary 2.4.0→2.11.0, express 4.19.2→4.22.3 (5.x exists), mongoose 8.5.3→8.24.7 (9.x exists), jsonwebtoken 9.0.2→9.0.3, cookie-parser →1.4.7, ioredis 5.4.1→5.11.1, dotenv 16.4.5→16.6.1, bcryptjs 2.4.3 (3.x exists), nodemon (dev) 3.1.4→3.1.14.
Frontend: axios 1.7.5→1.20.0, react-router-dom 6.26.1→6.30.6, vite 5.4.2→5.4.21 (8.x exists), tailwindcss 3.4.10→3.4.19 (4.x exists), framer-motion 11.3.30→11.18.2, recharts 2.12.7→2.15.4, zustand 4.5.5→4.5.7, react-hot-toast, react-confetti, etc. in-range updates exist for essentially all.
Plan: take the **in-range** updates first (no major jumps), re-run tests; defer majors (Express 5, Mongoose 9, React 19, Tailwind 4, Vite 8).

## 6. Dependency hygiene
- Root `package.json` carries the backend deps while `backend/package.json` duplicates the same dependency list (two manifests, two lockfiles' worth of drift risk); the backend has no lockfile of its own. `npm run build` runs `npm ci` inside the build script.
- No `engines` field and no `.nvmrc`; CI uses Node 20 in `ci.yml` and 22 in `feature-validation.yml`. Local audit ran on Node 22.
- No Dependabot/Renovate config, no `npm audit` step in CI.
- Abandoned critical dependencies: none identified among direct deps (all actively released). `q@1.5.1` (deprecated) is transitive via cloudinary.
- Unused dependencies: see FE‑31/FE‑32 in the frontend notes (the reviewer's list is in report 04); not independently confirmed by me.
