import type { EncodedFormat } from '../types';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

export async function embedDpiMetadata(
  blob: Blob,
  format: EncodedFormat,
  dpi: number,
): Promise<Blob> {
  const roundedDpi = Math.round(dpi);
  if (!Number.isFinite(roundedDpi) || roundedDpi < 1 || roundedDpi > 65535) {
    throw new RangeError('DPI は 1〜65535 の範囲で指定してください。');
  }

  const input = new Uint8Array(await blob.arrayBuffer());
  const output = format === 'png' ? setPngDpi(input, roundedDpi) : setJpegDpi(input, roundedDpi);
  const buffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(buffer).set(output);
  return new Blob([buffer], { type: format === 'png' ? 'image/png' : 'image/jpeg' });
}

export function setPngDpi(input: Uint8Array, dpi: number): Uint8Array {
  assertPng(input);
  const ppm = Math.round(dpi / 0.0254);
  const physData = new Uint8Array(9);
  const physView = new DataView(physData.buffer);
  physView.setUint32(0, ppm, false);
  physView.setUint32(4, ppm, false);
  physData[8] = 1; // unit = meter
  const physChunk = createPngChunk('pHYs', physData);

  const chunks: Uint8Array[] = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let inserted = false;

  while (offset + 12 <= input.length) {
    const length = readUint32BE(input, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > input.length) {
      throw new Error('PNG チャンク長が不正です。');
    }

    const type = ascii(input.subarray(offset + 4, offset + 8));
    const chunk = input.slice(offset, chunkEnd);

    // Replace any encoder-provided pHYs chunk instead of leaving conflicting DPI metadata.
    if (type !== 'pHYs') {
      chunks.push(chunk);
      if (type === 'IHDR' && !inserted) {
        chunks.push(physChunk);
        inserted = true;
      }
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  if (!inserted) {
    throw new Error('PNG に IHDR チャンクが見つかりません。');
  }
  return concatBytes(chunks);
}

export function setJpegDpi(input: Uint8Array, dpi: number): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new Error('JPEG SOI マーカーが見つかりません。');
  }

  const output = input.slice();
  const jfifStart = findJfifSegment(output);
  if (jfifStart !== -1) {
    writeJfifDensity(output, jfifStart, dpi);
  }

  const withJfif = jfifStart === -1 ? insertAfterSoi(output, createJfifSegment(dpi)) : output;
  const exifStart = findExifSegment(withJfif);

  if (exifStart !== -1) {
    patchExifResolutionIfPresent(withJfif, exifStart, dpi);
    return withJfif;
  }

  return insertAfterFirstApp0OrSoi(withJfif, createExifResolutionSegment(dpi));
}

function assertPng(input: Uint8Array): void {
  if (input.length < PNG_SIGNATURE.length) throw new Error('PNG データが短すぎます。');
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (input[i] !== PNG_SIGNATURE[i]) throw new Error('PNG シグネチャが不正です。');
  }
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  if (typeBytes.length !== 4) throw new Error('PNG chunk type は4文字である必要があります。');

  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

function findJfifSegment(bytes: Uint8Array): number {
  for (const segment of iterateJpegSegments(bytes)) {
    if (
      segment.marker === 0xe0 &&
      segment.payloadLength >= 14 &&
      ascii(bytes.subarray(segment.payloadStart, segment.payloadStart + 5)) === 'JFIF\0'
    ) {
      return segment.start;
    }
  }
  return -1;
}

function findExifSegment(bytes: Uint8Array): number {
  for (const segment of iterateJpegSegments(bytes)) {
    if (
      segment.marker === 0xe1 &&
      segment.payloadLength >= 6 &&
      ascii(bytes.subarray(segment.payloadStart, segment.payloadStart + 6)) === 'Exif\0\0'
    ) {
      return segment.start;
    }
  }
  return -1;
}

interface JpegSegment {
  start: number;
  marker: number;
  payloadStart: number;
  payloadLength: number;
  end: number;
}

function* iterateJpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return;
    const marker = bytes[offset];
    if (marker === undefined) return;
    const markerStart = offset - 1;

    if (marker === 0xd9 || marker === 0xda) return; // EOI / SOS
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 1;
      continue;
    }
    if (marker === 0x01) {
      offset += 1;
      continue;
    }

    if (offset + 2 >= bytes.length) return;
    const length = ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
    if (length < 2) return;
    const payloadStart = offset + 3;
    const payloadLength = length - 2;
    const end = payloadStart + payloadLength;
    if (end > bytes.length) return;

    yield { start: markerStart, marker, payloadStart, payloadLength, end };
    offset = end;
  }
}

function writeJfifDensity(bytes: Uint8Array, segmentStart: number, dpi: number): void {
  const unitsOffset = segmentStart + 11;
  bytes[unitsOffset] = 1; // dots per inch
  bytes[unitsOffset + 1] = (dpi >>> 8) & 0xff;
  bytes[unitsOffset + 2] = dpi & 0xff;
  bytes[unitsOffset + 3] = (dpi >>> 8) & 0xff;
  bytes[unitsOffset + 4] = dpi & 0xff;
}

function createJfifSegment(dpi: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01,
    0x01,
    (dpi >>> 8) & 0xff, dpi & 0xff,
    (dpi >>> 8) & 0xff, dpi & 0xff,
    0x00, 0x00,
  ]);
}

function createExifResolutionSegment(dpi: number): Uint8Array {
  // Minimal little-endian TIFF with XResolution, YResolution and ResolutionUnit=inch.
  const tiff = new Uint8Array(66);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49; // II
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true); // IFD0 offset
  view.setUint16(8, 3, true); // 3 entries

  const xEntry = 10;
  view.setUint16(xEntry, 0x011a, true);
  view.setUint16(xEntry + 2, 5, true); // RATIONAL
  view.setUint32(xEntry + 4, 1, true);
  view.setUint32(xEntry + 8, 50, true);

  const yEntry = 22;
  view.setUint16(yEntry, 0x011b, true);
  view.setUint16(yEntry + 2, 5, true);
  view.setUint32(yEntry + 4, 1, true);
  view.setUint32(yEntry + 8, 58, true);

  const unitEntry = 34;
  view.setUint16(unitEntry, 0x0128, true);
  view.setUint16(unitEntry + 2, 3, true); // SHORT
  view.setUint32(unitEntry + 4, 1, true);
  view.setUint16(unitEntry + 8, 2, true); // inch

  view.setUint32(46, 0, true); // next IFD
  view.setUint32(50, dpi, true); view.setUint32(54, 1, true);
  view.setUint32(58, dpi, true); view.setUint32(62, 1, true);

  const exifHeader = textEncoder.encode('Exif\0\0');
  const payload = concatBytes([exifHeader, tiff]);
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  const length = payload.length + 2;
  segment[2] = (length >>> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function patchExifResolutionIfPresent(bytes: Uint8Array, segmentStart: number, dpi: number): void {
  const payloadStart = segmentStart + 4;
  const tiffStart = payloadStart + 6;
  if (tiffStart + 8 > bytes.length) return;

  const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const bigEndian = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get16 = (offset: number) => view.getUint16(offset, littleEndian);
  const get32 = (offset: number) => view.getUint32(offset, littleEndian);
  const set16 = (offset: number, value: number) => view.setUint16(offset, value, littleEndian);
  const set32 = (offset: number, value: number) => view.setUint32(offset, value, littleEndian);

  const ifdOffset = get32(tiffStart + 4);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > bytes.length) return;
  const count = get16(ifdStart);

  for (let i = 0; i < count; i += 1) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > bytes.length) return;
    const tag = get16(entry);
    const type = get16(entry + 2);
    const itemCount = get32(entry + 4);

    if ((tag === 0x011a || tag === 0x011b) && type === 5 && itemCount === 1) {
      const valueOffset = get32(entry + 8);
      const rational = tiffStart + valueOffset;
      if (rational + 8 <= bytes.length) {
        set32(rational, dpi);
        set32(rational + 4, 1);
      }
    } else if (tag === 0x0128 && type === 3 && itemCount === 1) {
      set16(entry + 8, 2);
    }
  }
}

function insertAfterSoi(input: Uint8Array, segment: Uint8Array): Uint8Array {
  return concatBytes([input.subarray(0, 2), segment, input.subarray(2)]);
}

function insertAfterFirstApp0OrSoi(input: Uint8Array, segment: Uint8Array): Uint8Array {
  const first = iterateJpegSegments(input).next();
  if (!first.done && first.value.marker === 0xe0) {
    return concatBytes([input.subarray(0, first.value.end), segment, input.subarray(first.value.end)]);
  }
  return insertAfterSoi(input, segment);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function ascii(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

