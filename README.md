# FindMyKZ

A static, frontend-only KZ map property database. Filter CS2 KZ maps by material, tiers, top time,
scenery, tech, movement quirks and more — then narrow down to the exact map you want.

Built with **vanilla HTML, CSS and TypeScript** (compiled to plain JavaScript). No backend, no framework.
The UI is styled after [cs2kz.org](https://cs2kz.org/) (dark zinc + gold, Akshar / Exo 2).

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` compiles TypeScript, packs the data, and serves `public/` at **http://localhost:5173**.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | `tsc` → `public/js`, then packs `public/data/maps.json` → `maps.zip` |
| `npm run package` | Build, then create `dist/` + `findmykz-static.zip` for deployment |
| `npm run watch` | Recompile TypeScript on change (run `npm run serve` in another terminal) |
| `npm run pack` | Rebuild only `public/data/maps.zip` |
| `npm run serve` | Serve `public/` at port 5173 |
| `npm run refresh:data` | Rebuild `public/data/maps.json` from the live cs2kz.org API (real maps only) |

> The shipped dataset is generated from cs2kz.org's public API. It contains only approved maps and
> only values cs2kz actually provides; every other property is intentionally `Unknown` / empty until
> you verify it in the data editor.

## Pages

- **`index.html`** — map search, filter sidebar, quick menu, detail modal.
- **`entry.html`** — data entry editor with a working copy in IndexedDB, cs2kz.org autofill, and
  JSON / ZIP export.

## Quick menu (Ctrl+P / Cmd+P)

The search page and the data entry page both have a VS Code-style command palette. Use `>` to walk
through property → value chains, with fuzzy matching on every level.

| You type | Result |
| --- | --- |
| `Glo > Y` | Globalness = Yes |
| `Sur > Ye` | Has surfs (amount is Some / Lots / All) |
| `Bh > Yes` | Bhop = Yes |
| `Mat > Con` | Add Concrete to materials (search defaults to **All of**) |
| `Mat > Grass` | Also add Grass |
| `Top > 1 > 2` | Top time between 1 and 2 minutes |
| `TP > 3 > 6` | TP tier range 3–6 |
| `Lad > Type > Rope` | Ladder construction = Rope |
| `Scen > Water` | Scenery includes Water |
| `Spec > Boosters` | Special section includes Boosters |
| `Port > GO` | Port = GO |
| `Bon > Yes` | Bonus map |
| `Sort > Top time` | Change result ordering |

Example: use `Glo > Y` and `TP > 3 > 6` to narrow the real cs2kz map list by tier. Material, scenery
and movement filters become useful as those properties are filled in through data entry.

Keyboard: `↑`/`↓` navigate, `↵` select, `Esc` close, `Ctrl+P` / `Ctrl+K` open.

> The site must be served over HTTP(S) — opening `index.html` via `file://` cannot fetch the dataset.

## Data entry workflow

1. Open **Data entry**.
2. Pick an existing record or press **New** (`Ctrl+Shift+N`).
3. Use `Ctrl+P` to add properties fast. In the entry palette:
   - multi-value fields **add** values, they never remove them (`Mat > Con`, `Wea > Snowing`);
   - tri-state fields set a value (`Glo > Y`, `Bh > Yes`);
   - `Lad > Type > Rope`, `Path > Spiral`, etc. walk nested menus.
4. For **global** maps, set Globalness = Yes. The **Global map lookup** panel appears:
   - type a `kz_` map name and press **Lookup + autofill**;
   - results come from the public `api.cs2kz.org/maps?name=…` endpoint;
   - choosing a course fills name, mappers, description, Steam Workshop ID, cs2kz ID, TP tier and Pro tier;
   - leaving the name field while Globalness = Yes also auto-fills when there is exactly one match.
5. Add a thumbnail URL manually if you want a specific image. **Fetch thumbnail from Steam** attempts
   the public Steam Web API; Steam does not send CORS headers, so this can fail in the browser — paste
   the `images.steamusercontent.com` URL into the field instead.
6. Edits autosave to the browser (IndexedDB, with localStorage fallback). Press `Ctrl+S` to force a save.
7. Click **Export ZIP** to download `maps.zip`, replace `public/data/maps.zip`, and deploy.

Use **Export JSON** for a readable backup, **Import…** to load a `.json`/`.zip` backup, and
**Reload served** to discard the browser copy and re-read `public/data/maps.zip`.

## Data format

The site fetches `data/maps.zip` first and falls back to `data/maps.json`. The ZIP must contain one
JSON file (`maps.json` is what the export creates). Load is client-side via `DecompressionStream`.

```json
{
  "version": 2,
  "updatedAt": "2026-10-17T00:00:00.000Z",
  "source": "https://cs2kz.org",
  "maps": [
    {
      "id": "kz_grotto",
      "name": "kz_grotto",
      "global": "Yes",
      "materials": [],
      "props": [],
      "topTime": null,
      "tpTier": 2,
      "proTier": 3,
      "headbangers": "Unknown",
      "ladderAmount": [],
      "ladderTypes": [],
      "bhop": "Unknown",
      "bhopColour": null,
      "multi": "Unknown",
      "multiColour": null,
      "prekeep": "Unknown",
      "prekeepColour": null,
      "surfAmounts": [],
      "surfMaterials": [],
      "port": "Unknown",
      "basedOn": "",
      "weather": [],
      "scenery": [],
      "timeOfDay": [],
      "tech": [],
      "ljRoom": "Unknown",
      "ljBlock": "Unknown",
      "ladderRoom": "Unknown",
      "path": [],
      "special": [],
      "bonus": "Unknown",
      "mappers": "ReDMooN",
      "description": "KZ but in a GROTTO! Make your way through an obstacle course based in a cave.",
      "thumbnail": "https://images.steamusercontent.com/…",
      "workshopId": "3121168339",
      "cs2kzId": 2,
      "updatedAt": "2026-10-17T00:00:00.000Z",
      "notes": "Tiers from course “Main” (classic mode)."
    }
  ]
}
```

Notes:

- `topTime` is stored in **seconds**; the UI displays `m:ss.xx` and filters in minutes.
- Multi-value fields are arrays. `ladderAmount`, `props`, and `surfAmounts` may contain several amounts.
- `global`, `headbangers`, `bhop`, `multi`, `prekeep`, `ljRoom`, `ladderRoom`, `bonus` are
  `"Yes" | "No" | "Unknown"`.
- `ljBlock` is `"Yes" | "No" | "Specific" | "Unknown"`.
- `port` is `"GO" | "Source" | "1.6" | "Unknown"`.
- Missing or invalid fields are normalised to safe defaults when loaded.
- Searchable string fields (`mappers`, `basedOn`) are capped at 255 characters.

## Data provenance

`npm run refresh:data` rebuilds the dataset from `https://api.cs2kz.org/maps?limit=10000`:

- Only maps with `state: "approved"` are written. Invalid/superseded records are skipped.
- The following values come directly from cs2kz.org: map name, mappers, description, Workshop ID,
  cs2kz ID and approval status.
- `global` is `"Yes"` for approved cs2kz global maps.
- `tpTier` / `proTier` come from the **classic** mode filter of the primary course (the course named
  `Main`, otherwise the first course listed by cs2kz). Classic tiers are the numbers shown on the
  cs2kz.org map list. The course used is recorded in `notes`.
- Thumbnails are resolved from Steam's public `GetPublishedFileDetails` API using the real Workshop ID.
- **Every other property is left `Unknown` or empty.** Nothing is inferred from descriptions,
  screenshots, map names or personal knowledge. Fill those in through the data entry page.

The 94-map dataset shipped in this repository was generated this way. The previous demo/fake dataset
is preserved as `public/data/maps_fake.json` and is excluded from the packaged site.

## How search matching works

Every selected category is ANDed together.

- **Materials** default to **All of** (the map must include every selected material); switch to
  **Any of** in the sidebar.
- Other multi-select categories (weather, scenery, time, path, special, ladder types, surf materials)
  match **any** selected value.
- Amount filters match a map whose amount list contains any selected amount.
- Tier and top-time filters are inclusive ranges; records with unknown values are excluded when a
  range is active.
- Text search matches name, mappers, description, `basedOn` and tech tags.
- Filters are stored in the URL (`?f=…`), so filtered result pages are shareable.

## Project layout

```
Property.txt              Original property specification
src/
  types.ts                MapRecord / SearchFilters / option lists
  util.ts                 DOM, fuzzy matching, time formatting, URL state
  zip.ts                  ZIP reader (DecompressionStream) + ZIP writer
  data.ts                 Dataset loading, normalisation, IndexedDB storage
  filters.ts              Filter predicates, sorting, active-filter chips
  palette.ts              Reusable VS Code-style command palette
  search.ts               Search page
  entry.ts                Data entry page
public/
  index.html  entry.html  favicon.svg
  css/styles.css
  js/                     Compiled TypeScript (do not edit by hand)
  data/maps.json          Real cs2kz dataset (editable master)
  data/maps.zip           Generated compressed dataset
  data/maps_fake.json     Preserved backup of the original fake demo data
scripts/
  refresh-cs2kz-data.mjs  Fetch approved maps + thumbnails from cs2kz.org/Steam
  pack-data.mjs           maps.json → maps.zip
  package-site.mjs        public/ → dist/ + findmykz-static.zip
```

## Deploying

The project is already a plain static site — the TypeScript is compiled ahead of time and the browser
only receives HTML, CSS, JavaScript and data. There is no Node.js runtime, server process, database or
build step on the host.

```bash
npm run package
```

That command builds the project and produces:

- **`dist/`** — upload its contents to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3,
  nginx, a Synology share…).
- **`findmykz-static.zip`** — the same `dist/` contents as a single archive, handy for uploads.

You only need to re-run `npm run package` after changing TypeScript, CSS, HTML or the dataset. If you
only edited `public/data/maps.json`, run `npm run build` (or `npm run pack`) and replace
`public/data/maps.zip` in the deployed folder.

The only external requests at runtime are:

- Google Fonts (optional cosmetic);
- `api.cs2kz.org` when you explicitly use the global map lookup;
- Steam's image CDN for thumbnails, and optionally its Web API for thumbnail resolution.

The site must be served over HTTP(S) (static hosting always is). `file://` cannot fetch `data/maps.zip`
because of browser security rules.

## Attribution

The property taxonomy comes from `Property.txt`. cs2kz.org is used as a public reference for global
map metadata and visual inspiration; this project is not affiliated with cs2kz.org.
