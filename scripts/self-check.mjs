import assert from 'node:assert/strict';
import { calculateBackgroundRect, calculatePlacement, calculatePreviewGeometry } from '../src/lib/image.ts';
import { mmToPx, pxToMm } from '../src/lib/math.ts';
import { setJpegDpi, setPngDpi } from '../src/lib/dpiMetadata.ts';

assert.equal(mmToPx(100, 300), 1181);
assert.equal(mmToPx(150, 300), 1772);
assert.ok(Math.abs(pxToMm(1181, 300) - 99.991) < 0.01);

// Oversized portrait: fit inside the target without cropping or negative margins.
const portrait = calculatePlacement(2000, 3000, 1181, 1772);
assert.ok(portrait.scaledDown);
assert.ok(portrait.scale > 0 && portrait.scale < 1);
assert.ok(portrait.drawWidth <= 1181);
assert.ok(portrait.drawHeight <= 1772);
assert.ok(portrait.offsetX >= 0);
assert.ok(portrait.offsetY >= 0);

// Oversized landscape: width becomes the limiting axis and vertical margin remains.
const landscape = calculatePlacement(3000, 2000, 1181, 1772);
assert.ok(landscape.scaledDown);
assert.equal(landscape.drawWidth, 1181);
assert.ok(landscape.drawHeight < 1772);
assert.ok(landscape.offsetY > 0);

// Smaller input must remain 1:1.
const smaller = calculatePlacement(900, 1200, 1181, 1772);
assert.equal(smaller.scale, 1);
assert.equal(smaller.drawWidth, 900);
assert.equal(smaller.drawHeight, 1200);
assert.equal(smaller.offsetX, 140);
assert.equal(smaller.offsetY, 286);

// A very large source must still produce a small preview foreground after auto-fit.
const preview = calculatePreviewGeometry(12000, 8000, 1181, 1772, 720);
assert.equal(preview.targetHeight, 720);
assert.ok(preview.targetWidth <= 720);
assert.ok(preview.sourceWidth <= preview.targetWidth);
assert.ok(preview.sourceHeight <= preview.targetHeight);
assert.ok(preview.sourceWidth * preview.sourceHeight < 1_000_000);

// Custom background geometry: cover fills the target, contain stays inside it, stretch matches exactly.
const cover = calculateBackgroundRect(1000, 500, 600, 800, 'cover');
assert.ok(cover.width >= 600);
assert.ok(cover.height >= 800);
assert.ok(cover.x <= 0 || cover.y <= 0);

const contain = calculateBackgroundRect(1000, 500, 600, 800, 'contain');
assert.ok(contain.width <= 600 + Number.EPSILON);
assert.ok(contain.height <= 800 + Number.EPSILON);
assert.ok(contain.x >= 0);
assert.ok(contain.y >= 0);

const stretch = calculateBackgroundRect(1000, 500, 600, 800, 'stretch');
assert.deepEqual(stretch, { x: 0, y: 0, width: 600, height: 800 });

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

console.log('Self-check passed: mm/px, auto-fit, custom background geometry, and PNG/JPEG DPI metadata.');
