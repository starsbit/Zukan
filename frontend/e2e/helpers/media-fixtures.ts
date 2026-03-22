import { deflateSync } from 'node:zlib';

type Variant = 'primary' | 'secondary';

interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const CRC_TABLE = buildCrcTable();

export function bluePngFile(name = 'blue-upload.png', variant: Variant = 'primary'): FixtureFile {
  return createPngFile(name, [0, 0, 255], variant);
}

export function redPngFile(name = 'red-upload.png', variant: Variant = 'primary'): FixtureFile {
  return createPngFile(name, [255, 0, 0], variant);
}

export function greenPngFile(name = 'green-upload.png', variant: Variant = 'primary'): FixtureFile {
  return createPngFile(name, [0, 255, 0], variant);
}

export function blackPngFile(name = 'black-upload.png', variant: Variant = 'primary'): FixtureFile {
  return createPngFile(name, [0, 0, 0], variant);
}

function createPngFile(name: string, rgb: [number, number, number], variant: Variant): FixtureFile {
  return {
    name,
    mimeType: 'image/png',
    buffer: createPngBuffer(name, rgb, variant)
  };
}

function createPngBuffer(seedText: string, rgb: [number, number, number], variant: Variant): Buffer {
  const seed = hashSeed(`${seedText}:${variant}`);
  const width = 4 + (seed % 3);
  const height = 4 + ((seed >> 3) % 3);
  const rows: number[] = [];

  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      if (x === 0 && y === 0) {
        rows.push(rgb[0], rgb[1], rgb[2]);
        continue;
      }

      const bias = variant === 'secondary' ? 9 : 5;
      const noise = (seed + (x * 17) + (y * 31)) % 24;
      rows.push(applyChannelNoise(rgb[0], noise, bias));
      rows.push(applyChannelNoise(rgb[1], noise, bias));
      rows.push(applyChannelNoise(rgb[2], noise, bias));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(Buffer.from(rows))),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const chunkType = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([chunkType, data])), 0);

  return Buffer.concat([length, chunkType, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function applyChannelNoise(channel: number, noise: number, bias: number): number {
  if (channel >= 200) {
    return clamp(channel - ((noise + bias) % 22));
  }

  if (channel <= 20) {
    return clamp((noise + bias) % 18);
  }

  return clamp(channel);
}
