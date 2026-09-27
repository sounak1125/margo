/* Minimal Apple .icns writer. Every entry is a PNG, which macOS has read
   natively since 10.7 - no iconutil needed, so macOS icons can be produced on
   any build machine (Windows, Linux CI) from the same masters as the .ico.

   Layout: 'icns' + total length (u32 BE), then per entry a four-character
   type, the entry length including its 8-byte header (u32 BE), and the PNG. */

// OSType -> pixel size of the PNG it holds.
const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32], // 16@2x
  ['icp6', 64],
  ['ic12', 64], // 32@2x
  ['ic07', 128],
  ['ic13', 256], // 128@2x
  ['ic08', 256],
  ['ic14', 512], // 256@2x
  ['ic09', 512],
  ['ic10', 1024] // 512@2x
];

/* pngForSize(size) -> Buffer | null (async ok). Sizes it returns null for are
   left out, so a 512 px master simply produces no 1024 entry. */
async function buildIcns(pngForSize) {
  const entries = [];
  for (const [type, size] of ICNS_TYPES) {
    const png = await pngForSize(size);
    if (!png) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    entries.push(head, png);
  }
  const body = Buffer.concat(entries);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

/* Returns the entry types found, for checks. */
function readIcnsTypes(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') return null;
  const total = buf.readUInt32BE(4);
  const types = [];
  let off = 8;
  while (off + 8 <= Math.min(total, buf.length)) {
    const len = buf.readUInt32BE(off + 4);
    if (len < 8) break;
    types.push(buf.toString('ascii', off, off + 4));
    off += len;
  }
  return types;
}

module.exports = { buildIcns, readIcnsTypes, ICNS_TYPES };
