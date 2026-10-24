# Licensing and provenance status

**Status: UNRESOLVED release blocker for redistribution and for any claim of legal clearance.**
Nothing in this repository has been changed to make the licence situation look resolved.

## What can be established from this repository

| Evidence | Finding |
|---|---|
| `LICENSE` | Unmodified GNU GPL v2 text. The only copyright lines are the FSF boilerplate; **no copyright holder or year is named for this project.** |
| `README.md` badge | Claims **MIT** and links to `LICENSE` (which is GPL-2.0). Contradiction. |
| `package.json` | `"license": "ISC"`. A third statement. `backend/package.json` and `frontend/package.json` declare none. |
| Git history in this checkout | Two commits only (`init`, `add docs`), authored by a single account. The earlier audit (docs/07) recorded a 729-commit history for `ItsWanheda/mern-ecommerce` including four commits by "Burak"/"Burak Orkmez", which suggests a derivative of an earlier public project. **That history is not present here and was not re-verified**; the upstream repository was out of this session's access scope. |
| `frontend/public/*.jpg|png` | No attribution, licence or provenance file. Embedded metadata contains only a colour-profile string ("Copyright (c) 1998 Hewlett-Packard Company"), which concerns the ICC profile, not image rights. |
| Fonts | No font files are bundled; Vazirmatn is loaded from Google Fonts (SIL OFL 1.1). |
| Dependencies | No GPL/AGPL/SSPL dependency was found in the installed trees (docs/07 §3, re-run not repeated after upgrades; Dependabot/CI audit keep the dependency set under review). |

## What requires confirmation from rights holders

1. Who holds the copyright in the original project and in the derived code, and which licence applies to each component (GPL-2.0 file vs. MIT badge vs. ISC manifest).
2. Whether the upstream project this was derived from is under a licence with attribution or notice duties that must be preserved.
3. Whether the category photos (`bags`, `glasses`, `jackets`, `jeans`, `shoes`, `suits`, `tshirts`) and `screenshot-for-readme.png` may be used commercially and redistributed. Treat them as **unlicensed until the owner confirms in writing**, or replace them.
4. Whether the project may be relicensed. That is possible only with agreement of **all** copyright holders.

## Practical consequences (not legal advice)

- Running the store privately is not "distribution" under GPL-2.0, but the JavaScript bundle shipped to browsers is code delivered to users; get legal advice before keeping customisations closed.
- Do **not** publish or sell the code to third parties, and do not rely on the MIT badge, until items 1 to 4 are answered.

## Recommended actions (owner decision required)

1. Identify the copyright holder(s) and upstream project; record them here.
2. Choose one licence; align `LICENSE`, the README badge and the `license` fields.
3. Add a `NOTICE`/attribution file for any upstream code that requires it.
4. Replace or obtain written licences for every bundled image; add an `ASSETS.md` listing source and licence for each.
