# FindMyKZ

A static, frontend-only KZ map property database. Filter CS2 KZ maps by material, tiers, top time,
scenery, tech, movement quirks and more — then narrow down to the exact map you want.

Built with **vanilla HTML, CSS and TypeScript** (compiled to plain JavaScript) plus an optional
**Node + SQLite** backend for writing map properties. The UI is styled after
[cs2kz.org](https://cs2kz.org/) (dark zinc + gold, Akshar / Exo 2).

## Quick start

```bash
npm install
npm run server      # builds, then serves the site + API at http://localhost:8787
```

Open **http://localhost:8787/entry.html**. Edits are submitted with `POST` / `PUT` and stored in
`server/data/findmykz.db` (SQLite, created and seeded on first boot).

Static-only mode still works: `npm run dev` compiles TypeScript, packs the data, and serves
`public/` at **http://localhost:5173** with browser-storage deltas and file export.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm start` | Run the Node server (serves `public/` + `/api`) |
| `npm run server` | `npm run build`, then `npm start` |
| `npm run build` | `tsc` → `public/js`, then packs `public/data/maps.json` → `maps.zip` |
| `npm run package` | Build, then create `dist/` + `findmykz-static.zip` for deployment |
| `npm run db:export` | Export the SQLite database back to `public/data/maps.json` and rebuild `maps.zip` |
| `npm run watch` | Recompile TypeScript on change |
| `npm run pack` | Rebuild only `public/data/maps.zip` |
| `npm run serve` | Serve `public/` at port 5173 (static, no API) |
| `npm run refresh:data` | Rebuild `public/data/maps.json` from the live cs2kz.org API (real maps only) |
| `npm run top-times` | Fill CKZ and VNL top times in `maps.json` from cs2kz.org records |
| `npm run steam:data` | Pull `kz_*` / `bkz_*` maps from the Steam Workshop into `public/data/maps_steam.json` |
| `npm run apply:changes` | Apply an exported `maps_changes.json` delta to `public/data/maps.json` |

> Node **22.5+** is required for the built-in `node:sqlite` driver. There are no native modules or
database services to install.

> The shipped dataset is generated from cs2kz.org's public API. It contains only approved maps and
> only values cs2kz actually provides; every other property is intentionally `Unknown` / empty until
> you verify it in the data editor.

## Pages

- **`index.html`** — map search, filter sidebar, quick menu, detail modal.
- **`entry.html`** — data entry editor. With the Node server running it reads and writes the SQLite
  database; without it, it falls back to browser storage with JSON / ZIP export.

## Backend API & audit trail

The server (`server/index.mjs`) serves `public/` and mounts a small JSON API:

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | DB status, map count, whether writes/audit need a token |
| `GET` | `/api/maps` | Full dataset + per-map `revisions` |
| `GET` | `/api/maps/:id` | One map + current revision |
| `POST` | `/api/maps` | Create a record (`201`, `409` if the id exists) |
| `PUT` | `/api/maps/:id` | Replace a record (`200`, `409` on stale `If-Match`) |
| `DELETE` | `/api/maps/:id` | Delete a record |
| `POST` | `/api/maps/:id/open` | Records that a browser opened the map for editing |
| `GET` | `/api/maps/:id/audit` | **Private** audit trail — requires the audit token |

Writes carry the editor name (`X-Editor`), a stable browser id (`X-Client`), and optionally an
`If-Match` revision for optimistic locking. The record body is the full map object; the server
normalizes it with the same code the browser uses.

### Audit trail

Every create, update and delete appends a row to `map_audit`, keyed by map id. An entry stores the
revision, action, actor, client id, IP, user agent, timestamp, and **only the fields whose value
changed**, as `{ field, from, to }`:

```json
{
  "action": "update",
  "revision": 12,
  "changes": [
    { "field": "tpTier", "from": 3, "to": 4 },
    { "field": "scenery", "from": ["Laboratory"], "to": ["Laboratory", "Office"] }
  ]
}
```

Opening a map in the editor logs an `open` event with no value changes (deduplicated per client for
30 minutes). The History dialog hides those by default.

Audit rows are never served publicly. Reading them requires `FINDMYKZ_AUDIT_TOKEN`:

```bash
FINDMYKZ_AUDIT_TOKEN=some-long-secret npm start
# then in the editor: History → paste the token → Load
curl -H 'X-Audit-Token: some-long-secret' http://localhost:8787/api/maps/kz_angina/audit
```

Writes can also be locked with `FINDMYKZ_EDIT_TOKEN`. Enter it once under **History → Edit token**;
the editor then sends it as `X-Editor-Token` on every `POST` / `PUT` / `DELETE`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in containers) |
| `FINDMYKZ_DB` | `server/data/findmykz.db` | SQLite file location |
| `FINDMYKZ_EDIT_TOKEN` | unset | Require a token for `POST` / `PUT` / `DELETE` |
| `FINDMYKZ_AUDIT_TOKEN` | unset | Required to read the audit trail |

The database is seeded from `public/data/maps.json` the first time it starts, so existing data and
the data-entry workflow carry over. Run `npm run db:export` when you want to publish the database
contents back into the static site.

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
| `Top > 1 > 2` | CKZ / classic top time between 1 and 2 minutes |
| `VNL > 1 > 2` | VNL / vanilla top time between 1 and 2 minutes |
| `TP > 3 > 6` | TP tier range 3–6 |
| `Lad > Type > Rope` | Ladder construction = Rope |
| `Scen > Water` | Scenery includes Water |
| `Scen > Indoor > Lab` | Scenery includes Laboratory (grouped path) |
| `Scen > Outdoor > Volc` | Scenery includes Volcano (grouped path) |
| `Spec > Boosters` | Special section includes Boosters |
| `Port > GO` | Port = GO |
| `Bon > Yes` | Bonus map |
| `Cat > Catalogued` | Catalogue status = Catalogued |
| `Sort > Top time` | Change result ordering |

Example: use `Glo > Y` and `TP > 3 > 6` to narrow the real cs2kz map list by tier. Material, scenery
and movement filters become useful as those properties are filled in through data entry.

Keyboard: `↑`/`↓` navigate, `↵` select, `Esc` close, `Ctrl+P` / `Ctrl+K` open.

> The site must be served over HTTP(S) — opening `index.html` via `file://` cannot fetch the dataset.

## Data entry workflow

1. Open **Data entry**.
2. Pick an existing record or press **New** (`Ctrl+Shift+N`). Every row shows whether the map is
   **Catalogued** or **Uncatalogued**; new records start Uncatalogued.
3. Use `Ctrl+P` to add properties fast. In the entry palette:
   - multi-value fields **add** values, they never remove them (`Mat > Con`, `Wea > Snowing`);
   - tri-state fields set a value (`Glo > Y`, `Bh > Yes`), or clear the selection;
   - `Lad > Type > Rope`, `Path > Spiral`, etc. walk nested menus.
   - Leaving a property unselected means **Unknown**. It is not an extra value to pick. Clicking an
     already-active Yes/No/Specific chip clears it. Port keeps an explicit `Unknown` option because
     it is a single-choice enum.
4. For **global** maps, set Globalness = Yes. The **Global map lookup** panel appears:
   - type a `kz_` map name and press **Lookup + autofill**;
   - results come from the public `api.cs2kz.org/maps?name=…` endpoint;
   - choosing a course fills name, mappers, description, Steam Workshop ID, cs2kz ID, TP tier and Pro tier;
   - leaving the name field while Globalness = Yes also auto-fills when there is exactly one match.
5. Add a thumbnail URL manually if you want a specific image. **Fetch thumbnail from Steam** attempts
   the public Steam Web API; Steam does not send CORS headers, so this can fail in the browser — paste
   the `images.steamusercontent.com` URL into the field instead. The **Meta & media** panel shows a
   large preview of the current thumbnail; click it (or the thumbnail in the toolbar) to open the
   full-size image, with its pixel dimensions and an **Open original** link.
6. With the Node server running, edits autosave through the API: changed maps are `POST`ed (new) or
   `PUT` (existing) and stored in SQLite. Only fields that differ from the stored record are sent.
   If the API is unreachable, the change set is kept in browser storage as an outbox and retried on
   the next save.
7. **History** opens the private audit trail for the selected map: every create / update / delete
   with the old and new value of each changed field (requires `FINDMYKZ_AUDIT_TOKEN`).
8. Static fallback only (`npm run dev`): use the export buttons:
   - **Export Changes** downloads `maps_changes.json` — only the changed fields, additions and deletions.
   - **Export All** downloads the full merged `maps.json`.
   - **Export All ZIP** downloads the full dataset as `maps.zip`.
9. Apply an exported change file in the dev workspace:

```bash
npm run apply:changes -- maps_changes.json
```

The apply script patches `public/data/maps.json` by map ID, preserves untouched maps and properties,
warns if the base dataset version changed, and rebuilds `public/data/maps.zip`. Use `--dry-run` to
preview and `--no-pack` to skip the ZIP rebuild.

## Data format

The site fetches the live API (`api/maps`) first, then `data/maps.zip`, then `data/maps.json`. The ZIP
must contain one JSON file (`maps.json` is what the export creates). Load is client-side via
`DecompressionStream`.

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
      "topTime": 71.71875,
      "vnlTopTime": 100.3125,
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
      "catalogued": "Uncatalogued",
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

- `topTime` is stored in **seconds** for classic / **CKZ** mode; `vnlTopTime` is stored in seconds
  for vanilla / **VNL** mode. The UI displays `m:ss.xx` (or `h:mm:ss.xx` for long runs) and filters
  in minutes.
- Multi-value fields are arrays. `ladderAmount`, `props`, and `surfAmounts` may contain several amounts.
- `global`, `headbangers`, `bhop`, `multi`, `prekeep`, `ljRoom`, `ladderRoom`, `bonus` are stored as
  `"Yes" | "No" | "Unknown"`, but the UI only offers Yes/No. No selection means Unknown.
- `ljBlock` is stored as `"Yes" | "No" | "Specific" | "Unknown"`; no selection means Unknown.
- `catalogued` is `"Catalogued" | "Uncatalogued"`. It records whether every property of the map
  has been completely verified. Every record starts as `Uncatalogued`, including maps in datasets
  created before the field existed (they are migrated once on startup).
- `port` is `"GO" | "Source" | "1.6" | "Unknown"` and keeps its explicit Unknown option because it is
  a single-choice enum in `Property.txt`.
- Unknown never appears as a material, amount, ladder type or colour choice. Empty arrays/null mean
  unknown. Legacy `Unknown` array entries are dropped when a dataset is loaded.
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
- `topTime` and `vnlTopTime` are the #1 records for that same primary course in **classic / CKZ** and
  **vanilla / VNL** mode, fetched from `/records?top=true&mode=…&map=…&course=…`. They are stored in
  seconds. `npm run top-times` refreshes them without touching any other field.
- When rebuilding from scratch, run `npm run refresh:data` first and then `npm run top-times`; the
  former resets the time fields to `null`.
- Thumbnails are resolved from Steam's public `GetPublishedFileDetails` API using the real Workshop ID.
- **Every other property is left `Unknown` or empty.** Nothing is inferred from descriptions,
  screenshots, map names or personal knowledge. Fill those in through the data entry page.

The 94-map dataset shipped in this repository was generated this way. The previous demo/fake dataset
is preserved as `public/data/maps_fake.json` and is excluded from the packaged site.

## Delta changes format

`Export Changes` writes a small, self-describing file:

```json
{
  "format": "findmykz-changes",
  "version": 1,
  "baseUpdatedAt": "2026-10-17T08:42:45.921Z",
  "exportedAt": "2026-10-17T10:00:00.000Z",
  "changes": {
    "kz_grotto": {
      "materials": ["Concrete", "Grass"],
      "bhop": "Yes",
      "updatedAt": "2026-10-17T09:58:12.000Z"
    }
  },
  "added": {},
  "deleted": []
}
```

- `changes` contains only fields whose values differ from the served `maps.json`.
- `added` contains complete records for new maps.
- `deleted` contains IDs of removed base maps.
- The browser saves the same structure in local storage and discards a map's patch when its values are
  reverted to the base values.

## Steam Workshop data

`npm run steam:data` crawls the public Counter-Strike 2 Workshop search
(`appid=730`, text search for `kz_` and `bkz_`) and writes **`public/data/maps_steam.json`**.

- Only items whose trimmed title starts with `kz_` or `bkz_` (case-insensitive) are kept.
- Only items tagged **Map** by Steam are included, so menus/configs that happen to use a `kz_` prefix
  are excluded.
- The full Workshop search is paginated using Steam’s reported `total_pages` — currently the `kz_`
  search returns 820 raw results across 28 pages.
- Each entry stores the real Workshop data: ID, title, URL, preview URL, description, creator Steam
  ID, created/updated timestamps, file size, tags, subscriptions, favourites, views, rating/votes and
  whether the item is Workshop-accepted.
- Duplicate map titles are kept when they are separate Workshop items (for example reuploads or
  versions), because they have distinct Workshop IDs and metadata.
- Nothing is inferred or generated. This file is a raw Workshop index and is not yet merged into the
  search dataset (`maps.json`).

## How search matching works

Every selected category is ANDed together.

> **No selection means unknown.** Unknown is inferred from an empty property group, so it is never a
> searchable value. Leaving a category empty does not search for maps with missing data — it simply
> applies no constraint. The one exception is **Port**, where `Unknown` is a real single-choice enum
> value from `Property.txt`.

- **Materials** default to **All of** (the map must include every selected material); switch to
  **Any of** in the sidebar.
- Other multi-select categories (weather, scenery, time, path, special, ladder types, surf materials)
  match **any** selected value.
- Amount filters match a map whose amount list contains any selected amount.
- Tier and top-time filters are inclusive ranges; records with unknown values are excluded when a
  range is active. CKZ and VNL top-time ranges are independent filters.
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
  delta.ts                Delta change model + localStorage outbox
  api.ts                  Browser client for the Node API (POST/PUT/DELETE + audit)
  audit.ts                Private per-map audit trail dialog
  palette.ts              Reusable VS Code-style command palette
  search.ts               Search page
  entry.ts                Data entry page
server/
  index.mjs               Node HTTP server: static site + /api
  api.mjs                 Routes, auth headers, CORS, optimistic locking
  db.mjs                  SQLite schema, seeding, reads/writes, audit rows
  audit.mjs               Field-level diff ({ field, from, to })
  data/                   SQLite database (git-ignored, seeded on first boot)
public/
  index.html  entry.html  favicon.svg
  css/styles.css
  js/                     Compiled TypeScript (do not edit by hand)
  data/maps.json          Real cs2kz dataset (editable master)
  data/maps.zip           Generated compressed dataset
  data/maps_steam.json    Raw Steam Workshop kz_/bkz_ map metadata
  data/maps_fake.json     Preserved backup of the original fake demo data
scripts/
  refresh-cs2kz-data.mjs  Fetch approved maps + thumbnails from cs2kz.org/Steam
  update-top-times.mjs    Fill CKZ/VNL top times from cs2kz.org records
  fetch-steam-maps.mjs    Crawl Steam Workshop for kz_/bkz_ maps
  apply-changes.mjs       Apply maps_changes.json deltas to maps.json
  export-db.mjs           SQLite → public/data/maps.json
  pack-data.mjs           maps.json → maps.zip
  package-site.mjs        public/ → dist/ + findmykz-static.zip
```

## Deploying

The site has two deployment modes.

**Static (read-only).** The TypeScript is compiled ahead of time and the browser only receives HTML,
CSS, JavaScript and data. There is no Node.js runtime, server process or database on the host, and
the data-entry page falls back to browser-storage deltas plus file export.

```bash
npm run package
```

That command builds the project and produces:

- **`dist/`** — upload its contents to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3,
  nginx, a Synology share…).
- **`findmykz-static.zip`** — the same `dist/` contents as a single archive, handy for uploads.

**Node + SQLite (read/write).** Run `npm start` on a host with Node 22.5+. It serves the same
`public/` folder plus `/api`, stores submissions in `server/data/findmykz.db` and keeps the private
audit trail. Set `HOST=0.0.0.0`, `PORT`, `FINDMYKZ_EDIT_TOKEN` and `FINDMYKZ_AUDIT_TOKEN` as needed.
Back up the `.db` file (plus its `-wal` / `-shm` siblings) to back up the data and audit log.

You only need to re-run `npm run package` after changing TypeScript, CSS, HTML or the dataset. If you
only edited `public/data/maps.json`, run `npm run build` (or `npm run pack`) and replace
`public/data/maps.zip` in the deployed folder. With the database running, publish its contents with
`npm run db:export` first.

The only external requests at runtime are:

- Google Fonts (optional cosmetic);
- `api.cs2kz.org` when you explicitly use the global map lookup;
- Steam's image CDN for thumbnails, and optionally its Web API for thumbnail resolution.

The site must be served over HTTP(S) (static hosting always is). `file://` cannot fetch `data/maps.zip`
because of browser security rules.

## Attribution

The property taxonomy comes from `Property.txt`. cs2kz.org is used as a public reference for global
map metadata and visual inspiration; this project is not affiliated with cs2kz.org.
