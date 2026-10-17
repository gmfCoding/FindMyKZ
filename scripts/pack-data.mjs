#!/usr/bin/env node
/**
 * Packs public/data/maps.json into public/data/maps.zip so the site can fetch
 * a small compressed dataset. Uses a minimal single-entry ZIP writer (deflate-raw).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const jsonPath = join(dataDir, 'maps.json');
const zipPath = join(dataDir, 'maps.zip');

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

const json = await readFile(jsonPath);
JSON.parse(json.toString('utf8')); // validate
const name = Buffer.from('maps.json', 'utf8');
const compressed = deflateRawSync(json, { level: 9 });
const crc = crc32(json);
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);           // version needed
local.writeUInt16LE(0x0800, 6);       // UTF-8
local.writeUInt16LE(8, 8);            // deflate
local.writeUInt16LE(dosTime, 10);
local.writeUInt16LE(dosDate, 12);
local.writeUInt32LE(crc, 14);
local.writeUInt32LE(compressed.length, 18);
local.writeUInt32LE(json.length, 22);
local.writeUInt16LE(name.length, 26);
local.writeUInt16LE(0, 28);

const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(20, 4);         // version made by
central.writeUInt16LE(20, 6);         // version needed
central.writeUInt16LE(0x0800, 8);     // UTF-8
central.writeUInt16LE(8, 10);         // deflate
central.writeUInt16LE(dosTime, 12);
central.writeUInt16LE(dosDate, 14);
central.writeUInt32LE(crc, 16);
central.writeUInt32LE(compressed.length, 20);
central.writeUInt32LE(json.length, 24);
central.writeUInt16LE(name.length, 28);
central.writeUInt16LE(0, 30);         // extra
central.writeUInt16LE(0, 32);         // comment
central.writeUInt16LE(0, 34);         // disk
central.writeUInt16LE(0, 36);         // internal attrs
central.writeUInt32LE(0, 38);         // external attrs
central.writeUInt32LE(0, 42);         // local offset

const centralSize = central.length + name.length;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(1, 8);
eocd.writeUInt16LE(1, 10);
eocd.writeUInt32LE(centralSize, 12);
eocd.writeUInt32LE(local.length + name.length + compressed.length, 16);
eocd.writeUInt16LE(0, 20);

// Layout: local header + name + payload, then central directory + name, then EOCD.
const zip = Buffer.concat([local, name, compressed, central, name, eocd]);
await writeFile(zipPath, zip);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Packed ${kb(json.length)} JSON -> ${kb(zip.length)} ZIP (${zip.length} bytes)`);
