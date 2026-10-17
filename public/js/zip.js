const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** Reads the first `.json` entry from a ZIP archive using the browser's DecompressionStream. */
export async function readFirstJsonEntry(buffer) {
    const view = new DataView(buffer);
    const length = buffer.byteLength;
    let eocd = -1;
    const stop = Math.max(0, length - 65557);
    for (let i = length - 22; i >= stop; i--) {
        if (view.getUint32(i, true) === EOCD_SIG) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('Not a valid ZIP file (end-of-central-directory not found).');
    const entries = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    let pointer = centralOffset;
    for (let i = 0; i < entries; i++) {
        if (view.getUint32(pointer, true) !== CENTRAL_SIG) {
            throw new Error('Corrupt ZIP central directory.');
        }
        const method = view.getUint16(pointer + 10, true);
        const compressedSize = view.getUint32(pointer + 20, true);
        const nameLength = view.getUint16(pointer + 28, true);
        const extraLength = view.getUint16(pointer + 30, true);
        const commentLength = view.getUint16(pointer + 32, true);
        const localOffset = view.getUint32(pointer + 42, true);
        const name = new TextDecoder().decode(new Uint8Array(buffer, pointer + 46, nameLength));
        if (name.toLowerCase().endsWith('.json')) {
            if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
                throw new Error('Corrupt ZIP local header.');
            }
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = new Uint8Array(buffer, dataStart, compressedSize);
            if (method === 0)
                return new TextDecoder().decode(compressed);
            if (method === 8) {
                if (typeof DecompressionStream === 'undefined') {
                    throw new Error('This browser cannot decompress ZIP files. Use maps.json instead.');
                }
                const stream = new Blob([compressed])
                    .stream()
                    .pipeThrough(new DecompressionStream('deflate-raw'));
                return await new Response(stream).text();
            }
            throw new Error(`Unsupported ZIP compression method: ${method}`);
        }
        pointer += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('No JSON file found inside the ZIP archive.');
}
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
    return {
        time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
        date: (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
    };
}
/** Creates a single-entry ZIP. Uses deflate-raw when the browser supports CompressionStream. */
export async function createZip(filename, content) {
    const encoder = new TextEncoder();
    const raw = encoder.encode(content);
    const name = encoder.encode(filename);
    const crc = crc32(raw);
    let method = 0;
    let payload = raw;
    if (typeof CompressionStream !== 'undefined') {
        try {
            const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            payload = new Uint8Array(await new Response(stream).arrayBuffer());
            method = 8;
        }
        catch {
            method = 0;
            payload = raw;
        }
    }
    const { time, date } = dosDateTime();
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, 0, true);
    central.set(name, 46);
    const centralOffset = local.length + payload.length;
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, EOCD_SIG, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, centralOffset, true);
    return new Blob([local, payload, central, eocd], { type: 'application/zip' });
}
//# sourceMappingURL=zip.js.map