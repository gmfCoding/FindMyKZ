/**
 * FindMyKZ server.
 *
 * Serves the static site from `public/` and the map/audit API from `/api/`.
 *
 *   PORT                       default 8787
 *   HOST                       default 127.0.0.1 (use 0.0.0.0 in containers)
 *   FINDMYKZ_DB                default server/data/findmykz.db
 *   FINDMYKZ_EDIT_TOKEN        optional; when set, writes need this token
 *   FINDMYKZ_AUDIT_TOKEN       required to read the private audit trail
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiConfig, handleApi } from './api.mjs';
import { DB_PATH, catalogueMigrated, closeDb, mapCount, seededCount } from './db.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  const relative = pathname === '/' ? '/index.html' : pathname;
  const target = resolve(PUBLIC_DIR, `.${normalize(relative)}`);

  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found: ${pathname}`);
    return;
  }

  const stats = statSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    // Data and code change often during data entry; always revalidate.
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(target).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      console.error('[findmykz] Unhandled API failure:', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', message: 'Unexpected server error.' }));
    });
    return;
  }

  try {
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[findmykz] Static file error:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  const origin = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log('FindMyKZ server');
  console.log(`  site      ${origin}/`);
  console.log(`  data entry ${origin}/entry.html`);
  console.log(`  suggestions ${origin}/suggestions.html`);
  console.log(`  api       ${origin}/api/maps`);
  console.log(`  database  ${DB_PATH} (${mapCount()} maps)`);
  if (seededCount > 0) console.log(`  seeded    ${seededCount} maps from public/data/maps.json`);
  if (catalogueMigrated > 0) console.log(`  migrated  ${catalogueMigrated} records defaulted to Uncatalogued`);
  console.log(`  writes    ${apiConfig.writesLocked ? 'token required (FINDMYKZ_EDIT_TOKEN)' : 'open'}`);
  console.log(
    `  audit     ${apiConfig.auditEnabled ? 'token required (FINDMYKZ_AUDIT_TOKEN)' : 'disabled — set FINDMYKZ_AUDIT_TOKEN to read it'}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[findmykz] ${signal} — shutting down`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
