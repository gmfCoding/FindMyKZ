#!/usr/bin/env node
/**
 * Creates a self-contained static deployment:
 *   dist/                     -> copy this folder to any static host
 *   findmykz-static.zip       -> same files, zipped
 *
 * Sourcemaps are stripped from the packaged JavaScript and excluded from the ZIP.
 * Run `npm run package` (which builds first).
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
const zipPath = join(root, 'findmykz-static.zip');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
    date: (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

async function collectFiles(dir, base = dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute, base)));
      continue;
    }
    const rel = relative(base, absolute).split(sep).join('/');

    // Keep the deployment lean: sourcemaps are dev-only.
    if (rel.endsWith('.map')) continue;

    let data = await readFile(absolute);
    if (rel.endsWith('.js')) {
      const text = data.toString('utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
      data = Buffer.from(text, 'utf8');
    }
    files.push({ rel, data });
  }
  return files;
}

function buildZip(entries) {
  const { time, date } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.rel, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const files = await collectFiles(publicDir);

for (const file of files) {
  const destination = join(distDir, ...file.rel.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.data);
}

const zip = buildZip(files);
await writeFile(zipPath, zip);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const rawSize = files.reduce((sum, file) => sum + file.data.length, 0);
console.log(`Packaged ${files.length} files`);
console.log(`  dist/                  ${kb(rawSize)}`);
console.log(`  findmykz-static.zip    ${kb(zip.length)}`);
console.log('');
console.log('Upload the contents of dist/ to any static host (GitHub Pages, Netlify,');
console.log('Cloudflare Pages, S3, nginx…). No Node.js or server process is required.');
