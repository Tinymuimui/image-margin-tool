import assert from 'node:assert/strict';
import { mmToPx, pxToMm } from '../src/lib/math.ts';
import { setJpegDpi, setPngDpi } from '../src/lib/dpiMetadata.ts';

assert.equal(mmToPx(100, 300), 1181);
assert.equal(mmToPx(150, 300), 1772);
assert.ok(Math.abs(pxToMm(1181, 300) - 99.991) < 0.01);

// Minimal parseable PNG structure for metadata insertion check.
const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Uint8Array.from([
  0,0,0,13, 73,72,68,82,
  0,0,0,1, 0,0,0,1, 8,2,0,0,0,
  0,0,0,0,
]);
const iend = Uint8Array.from([0,0,0,0, 73,69,78,68, 0,0,0,0]);
const png = new Uint8Array(signature.length + ihdr.length + iend.length);
png.set(signature, 0); png.set(ihdr, signature.length); png.set(iend, signature.length + ihdr.length);
const png300 = setPngDpi(png, 300);
const physText = new TextDecoder('latin1').decode(png300);
assert.ok(physText.includes('pHYs'));
const physIndex = physText.indexOf('pHYs');
const physDataOffset = physIndex + 4;
const physView = new DataView(png300.buffer, png300.byteOffset + physDataOffset, 9);
assert.equal(physView.getUint32(0, false), Math.round(300 / 0.0254));
assert.equal(physView.getUint32(4, false), Math.round(300 / 0.0254));
assert.equal(physView.getUint8(8), 1);

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const jpeg300 = setJpegDpi(jpeg, 300);
assert.equal(jpeg300[0], 0xff);
assert.equal(jpeg300[1], 0xd8);
const jpegText = new TextDecoder('latin1').decode(jpeg300);
assert.ok(jpegText.includes('JFIF\0'));
assert.ok(jpegText.includes('Exif\0\0'));
const jfif = jpegText.indexOf('JFIF\0') - 4;
assert.equal(jpeg300[jfif + 11], 1);
assert.equal(((jpeg300[jfif + 12] ?? 0) << 8) | (jpeg300[jfif + 13] ?? 0), 300);
assert.equal(((jpeg300[jfif + 14] ?? 0) << 8) | (jpeg300[jfif + 15] ?? 0), 300);

console.log('Self-check passed: mm/px conversion and PNG/JPEG DPI metadata.');
