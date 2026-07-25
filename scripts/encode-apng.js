/**
 * Minimal APNG encoder from discrete PNG frame buffers (pngjs).
 * delayMs per frame; numPlays 0 = infinite loop.
 */
const zlib = require('zlib');
const { PNG } = require('pngjs');

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = u32(data.length);
  const body = Buffer.concat([typeBuf, data]);
  const crc = u32(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function parsePng(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function encodeRgbaToIdat(width, height, rgba) {
  // filter 0 (None) per scanline
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return zlib.deflateSync(raw, { level: 9 });
}

/**
 * @param {Buffer[]} pngFrames - PNG file buffers (same dimensions)
 * @param {{ delayMs?: number, delays?: number[], numPlays?: number }} opts
 * @returns {Buffer}
 */
function encodeApng(pngFrames, opts = {}) {
  if (!pngFrames.length) throw new Error('no frames');
  const frames = pngFrames.map(parsePng);
  const { width, height } = frames[0];
  for (const f of frames) {
    if (f.width !== width || f.height !== height) {
      throw new Error('all frames must share dimensions');
    }
  }

  const delays = opts.delays || frames.map(() => opts.delayMs || 100);
  const numPlays = opts.numPlays == null ? 0 : opts.numPlays;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [sig, chunk('IHDR', ihdr), chunk('acTL', Buffer.concat([u32(frames.length), u32(numPlays)]))];

  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const delayMs = Math.max(1, delays[i] || 100);
    // delay as fraction of seconds: num/den with den=1000
    const fctl = Buffer.concat([
      u32(seq++),
      u32(width),
      u32(height),
      u32(0), // x
      u32(0), // y
      u16(delayMs),
      u16(1000),
      Buffer.from([0]), // dispose: APNG_DISPOSE_OP_NONE — keep (we redraw full frames)
      Buffer.from([0]), // blend: SOURCE
    ]);
    // Actually dispose NONE with full-frame SOURCE is fine if each frame is complete.
    // Use BACKGROUND dispose (1) so previous frame clears — safer for bobbing on transparency.
    fctl[fctl.length - 2] = 1; // APNG_DISPOSE_OP_BACKGROUND
    fctl[fctl.length - 1] = 0; // SOURCE

    parts.push(chunk('fcTL', fctl));
    const idat = encodeRgbaToIdat(width, height, Buffer.from(frames[i].data));
    if (i === 0) {
      parts.push(chunk('IDAT', idat));
    } else {
      parts.push(chunk('fdAT', Buffer.concat([u32(seq++), idat])));
    }
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

module.exports = { encodeApng };
