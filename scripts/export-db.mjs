/**
 * Export the SQLite database back to the static dataset files so the search
 * page (and the deployable static bundle) can be rebuilt from live data.
 *
 *   npm run db:export
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, datasetSnapshot } from '../server/db.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'public', 'data', 'maps.json');

const snapshot = datasetSnapshot();
const dataset = {
  version: 1,
  updatedAt: new Date().toISOString(),
  maps: snapshot.maps,
};

writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`);

const withNotes = dataset.maps.filter((map) => typeof map.notes === 'string' && map.notes.length > 0).length;
console.log(`Exported ${dataset.maps.length} maps to public/data/maps.json (${withNotes} with notes).`);
console.log('Run `npm run pack` (or `npm run package`) to rebuild maps.zip and the static bundle.');

closeDb();
