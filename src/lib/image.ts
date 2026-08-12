import type { BackgroundFit, EncodedFormat, RenderOptions } from '../types';

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export interface Placement {
  scale: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
  scaledDown: boolean;
}

export interface PreviewGeometry {
  targetWidth: number;
  targetHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  previewScale: number;
}

export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FeatherInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const MAX_CANVAS_PIXELS = 80_000_000;
const MAX_CANVAS_DIMENSION = 32_767;
const SAMPLE_SIZE = 48;
const NOISE_TILE_SIZE = 96;

export async function decodeImage(file: File): Promise<DecodedImage> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement for files/browsers createImageBitmap cannot decode.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function assertCanvasSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('出力ピクセル寸法が不正です。');
  }
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new RangeError(`ブラウザ処理の安全上、1辺は ${MAX_CANVAS_DIMENSION.toLocaleString()} px 以下にしてください。`);
  }
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError(`ブラウザ処理の安全上、出力は ${(MAX_CANVAS_PIXELS / 1_000_000).toFixed(0)} MP 以下にしてください。`);
  }
}

export function calculatePlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Placement {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('元画像のピクセル寸法が不正です。');
  }
  assertCanvasSize(targetWidth, targetHeight);

  const scale = Math.min(1, targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('画像の縮小率を計算できません。');
  }

  const drawWidth = Math.min(targetWidth, Math.max(1, Math.round(sourceWidth * scale)));
  const drawHeight = Math.min(targetHeight, Math.max(1, Math.round(sourceHeight * scale)));
  const offsetX = Math.max(0, Math.floor((targetWidth - drawWidth) / 2));
  const offsetY = Math.max(0, Math.floor((targetHeight - drawHeight) / 2));

  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
    scaledDown: scale < 1 - Number.EPSILON,
  };
}

export function calculateBackgroundRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: BackgroundFit,
): DrawRect {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
    || targetWidth <= 0
    || targetHeight <= 0
  ) {
    throw new RangeError('背景画像または出力サイズが不正です。');
  }

  if (fit === 'stretch') {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  const scale = fit === 'cover'
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);

  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

export function calculateFeatherInsets(
  placement: Placement,
  targetWidth: number,
  targetHeight: number,
  requestedFeatherPx: number,
): FeatherInsets {
  const safeRequested = Number.isFinite(requestedFeatherPx) ? Math.max(0, requestedFeatherPx) : 0;
  const maxHorizontal = Math.max(0, Math.floor(placement.drawWidth * 0.45));
  const maxVertical = Math.max(0, Math.floor(placement.drawHeight * 0.45));
  const horizontal = Math.min(safeRequested, maxHorizontal);
  const vertical = Math.min(safeRequested, maxVertical);
  const rightMargin = Math.max(0, targetWidth - placement.offsetX - placement.drawWidth);
  const bottomMargin = Math.max(0, targetHeight - placement.offsetY - placement.drawHeight);

  return {
    left: placement.offsetX > 0 ? horizontal : 0,
    right: rightMargin > 0 ? horizontal : 0,
    top: placement.offsetY > 0 ? vertical : 0,
    bottom: bottomMargin > 0 ? vertical : 0,
  };
}

export function renderImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: RenderOptions,
): HTMLCanvasElement {
  const {
    targetWidth,
    targetHeight,
    mode,
    blurPx,
    featherPx,
    backgroundColor,
    backgroundImage,
    backgroundFit,
    backgroundOpacity,
    backgroundBrightness,
    backgroundSaturation,
    backgroundContrast,
    photoBackgroundSource,
    colorMatchStrength,
    grainStrength,
  } = options;

  assertCanvasSize(targetWidth, targetHeight);
  const placement = calculatePlacement(sourceWidth, sourceHeight, targetWidth, targetHeight);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  if (mode === 'edge' || mode === 'blur') {
    const background = createEdgeExtendedBackground(
      source,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      placement,
      backgroundColor,
    );

    drawBackgroundLayer(ctx, background, targetWidth, targetHeight, mode === 'blur' ? blurPx : 0);
    releaseCanvas(background);
  } else if (mode === 'custom') {
    if (!backgroundImage) {
      throw new Error('カスタム背景画像が選択されていません。');
    }

    const background = createImageBackground(
      backgroundImage.source,
      backgroundImage.width,
      backgroundImage.height,
      targetWidth,
      targetHeight,
      backgroundFit,
      backgroundColor,
      backgroundOpacity,
      backgroundBrightness,
      backgroundSaturation,
      backgroundContrast,
    );

    drawBackgroundLayer(ctx, background, targetWidth, targetHeight, blurPx);
    releaseCanvas(background);
  } else if (mode === 'photo') {
    const useCustomBackground = photoBackgroundSource === 'custom';
    if (useCustomBackground && !backgroundImage) {
      throw new Error('写真なじませでカスタム背景を使う場合は、背景画像を選択してください。');
    }

    const photoBackground = useCustomBackground && backgroundImage
      ? backgroundImage
      : { source, width: sourceWidth, height: sourceHeight };

    const background = createImageBackground(
      photoBackground.source,
      photoBackground.width,
      photoBackground.height,
      targetWidth,
      targetHeight,
      backgroundFit,
      backgroundColor,
      backgroundOpacity,
      backgroundBrightness,
      backgroundSaturation,
      backgroundContrast,
    );

    drawBackgroundLayer(ctx, background, targetWidth, targetHeight, blurPx);
    releaseCanvas(background);

    const edgeColor = sampleEdgeColor(source, sourceWidth, sourceHeight);
    applyColorHarmony(ctx, targetWidth, targetHeight, edgeColor, colorMatchStrength);
    applyGrain(ctx, targetWidth, targetHeight, grainStrength);
    drawFeatheredForeground(
      ctx,
      source,
      placement,
      targetWidth,
      targetHeight,
      featherPx,
    );
    return canvas;
  }

  // Standard modes keep a crisp, fully opaque foreground.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.drawImage(
    source,
    placement.offsetX,
    placement.offsetY,
    placement.drawWidth,
    placement.drawHeight,
  );
  return canvas;
}

export function calculatePreviewGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  maxPreviewDimension = 720,
): PreviewGeometry {
  assertCanvasSize(targetWidth, targetHeight);
  if (!Number.isFinite(maxPreviewDimension) || maxPreviewDimension <= 0) {
    throw new RangeError('maxPreviewDimension must be greater than zero.');
  }

  const fullPlacement = calculatePlacement(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const previewScale = Math.min(1, maxPreviewDimension / Math.max(targetWidth, targetHeight));
  return {
    targetWidth: Math.max(1, Math.round(targetWidth * previewScale)),
    targetHeight: Math.max(1, Math.round(targetHeight * previewScale)),
    sourceWidth: Math.max(1, Math.round(fullPlacement.drawWidth * previewScale)),
    sourceHeight: Math.max(1, Math.round(fullPlacement.drawHeight * previewScale)),
    previewScale,
  };
}

export function renderPreview(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: RenderOptions,
  maxPreviewDimension = 720,
): HTMLCanvasElement {
  const geometry = calculatePreviewGeometry(
    sourceWidth,
    sourceHeight,
    options.targetWidth,
    options.targetHeight,
    maxPreviewDimension,
  );

  // Pre-scale the foreground to its fitted preview size. This keeps preview memory bounded
  // when a very large source image is dropped into the app.
  const scaledSource = document.createElement('canvas');
  scaledSource.width = geometry.sourceWidth;
  scaledSource.height = geometry.sourceHeight;
  const scaledCtx = scaledSource.getContext('2d', { alpha: true });
  if (!scaledCtx) throw new Error('Preview Canvas 2D context is unavailable.');
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = 'high';
  scaledCtx.drawImage(source, 0, 0, geometry.sourceWidth, geometry.sourceHeight);

  try {
    return renderImage(scaledSource, geometry.sourceWidth, geometry.sourceHeight, {
      ...options,
      targetWidth: geometry.targetWidth,
      targetHeight: geometry.targetHeight,
      blurPx: options.blurPx * geometry.previewScale,
      featherPx: options.featherPx * geometry.previewScale,
    });
  } finally {
    releaseCanvas(scaledSource);
  }
}

function drawBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  background: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  blurPx: number,
): void {
  if (blurPx > 0) {
    const safeBlur = Math.min(Math.max(0, blurPx), Math.max(targetWidth, targetHeight));
    const pad = Math.max(2, Math.ceil(safeBlur * 2));
    ctx.save();
    ctx.filter = `blur(${safeBlur.toFixed(2)}px)`;
    // Overscan prevents transparent/flat blur fringes at the outside edge.
    ctx.drawImage(background, -pad, -pad, targetWidth + pad * 2, targetHeight + pad * 2);
    ctx.restore();
  } else {
    ctx.drawImage(background, 0, 0);
  }
}

function createImageBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: BackgroundFit,
  backgroundColor: string,
  opacity: number,
  brightness: number,
  saturation: number,
  contrast: number,
): HTMLCanvasElement {
  const bg = document.createElement('canvas');
  bg.width = targetWidth;
  bg.height = targetHeight;
  const ctx = bg.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Background Canvas 2D context is unavailable.');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const rect = calculateBackgroundRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fit);
  const safeOpacity = clamp(opacity, 0, 1, 1);
  const safeBrightness = clamp(brightness, 0, 3, 1);
  const safeSaturation = clamp(saturation, 0, 3, 1);
  const safeContrast = clamp(contrast, 0, 3, 1);

  ctx.save();
  ctx.globalAlpha = safeOpacity;
  ctx.filter = [
    `brightness(${safeBrightness.toFixed(3)})`,
    `saturate(${safeSaturation.toFixed(3)})`,
    `contrast(${safeContrast.toFixed(3)})`,
  ].join(' ');
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();

  return bg;
}

function createEdgeExtendedBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  placement: Placement,
  backgroundColor: string,
): HTMLCanvasElement {
  const bg = document.createElement('canvas');
  bg.width = targetWidth;
  bg.height = targetHeight;
  const ctx = bg.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Background Canvas 2D context is unavailable.');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { drawWidth, drawHeight, offsetX, offsetY } = placement;
  const rightWidth = Math.max(0, targetWidth - offsetX - drawWidth);
  const bottomHeight = Math.max(0, targetHeight - offsetY - drawHeight);

  if (offsetX > 0) {
    ctx.drawImage(source, 0, 0, 1, sourceHeight, 0, offsetY, offsetX, drawHeight);
  }
  if (rightWidth > 0) {
    ctx.drawImage(source, sourceWidth - 1, 0, 1, sourceHeight, offsetX + drawWidth, offsetY, rightWidth, drawHeight);
  }
  if (offsetY > 0) {
    ctx.drawImage(source, 0, 0, sourceWidth, 1, offsetX, 0, drawWidth, offsetY);
  }
  if (bottomHeight > 0) {
    ctx.drawImage(source, 0, sourceHeight - 1, sourceWidth, 1, offsetX, offsetY + drawHeight, drawWidth, bottomHeight);
  }

  if (offsetX > 0 && offsetY > 0) {
    ctx.drawImage(source, 0, 0, 1, 1, 0, 0, offsetX, offsetY);
  }
  if (rightWidth > 0 && offsetY > 0) {
    ctx.drawImage(source, sourceWidth - 1, 0, 1, 1, offsetX + drawWidth, 0, rightWidth, offsetY);
  }
  if (offsetX > 0 && bottomHeight > 0) {
    ctx.drawImage(source, 0, sourceHeight - 1, 1, 1, 0, offsetY + drawHeight, offsetX, bottomHeight);
  }
  if (rightWidth > 0 && bottomHeight > 0) {
    ctx.drawImage(
      source,
      sourceWidth - 1,
      sourceHeight - 1,
      1,
      1,
      offsetX + drawWidth,
      offsetY + drawHeight,
      rightWidth,
      bottomHeight,
    );
  }

  ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
  return bg;
}

function drawFeatheredForeground(
  targetCtx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: Placement,
  targetWidth: number,
  targetHeight: number,
  featherPx: number,
): void {
  const insets = calculateFeatherInsets(placement, targetWidth, targetHeight, featherPx);
  const hasFeather = insets.left > 0 || insets.right > 0 || insets.top > 0 || insets.bottom > 0;

  if (!hasFeather) {
    targetCtx.save();
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.filter = 'none';
    targetCtx.drawImage(source, placement.offsetX, placement.offsetY, placement.drawWidth, placement.drawHeight);
    targetCtx.restore();
    return;
  }

  const foreground = document.createElement('canvas');
  foreground.width = placement.drawWidth;
  foreground.height = placement.drawHeight;
  const ctx = foreground.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Foreground feather Canvas 2D context is unavailable.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, placement.drawWidth, placement.drawHeight);
  ctx.globalCompositeOperation = 'destination-in';

  if (insets.left > 0) {
    const gradient = ctx.createLinearGradient(0, 0, insets.left, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, insets.left, placement.drawHeight);
  }
  if (insets.right > 0) {
    const start = placement.drawWidth - insets.right;
    const gradient = ctx.createLinearGradient(start, 0, placement.drawWidth, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(start, 0, insets.right, placement.drawHeight);
  }
  if (insets.top > 0) {
    const gradient = ctx.createLinearGradient(0, 0, 0, insets.top);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, placement.drawWidth, insets.top);
  }
  if (insets.bottom > 0) {
    const start = placement.drawHeight - insets.bottom;
    const gradient = ctx.createLinearGradient(0, start, 0, placement.drawHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, start, placement.drawWidth, insets.bottom);
  }

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'source-over';
  targetCtx.globalAlpha = 1;
  targetCtx.filter = 'none';
  targetCtx.drawImage(foreground, placement.offsetX, placement.offsetY);
  targetCtx.restore();
  releaseCanvas(foreground);
}

function sampleEdgeColor(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): RgbColor {
  const sample = document.createElement('canvas');
  sample.width = SAMPLE_SIZE;
  sample.height = SAMPLE_SIZE;
  const ctx = sample.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!ctx) return { r: 128, g: 128, b: 128 };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  try {
    const pixels = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    const border = Math.max(2, Math.floor(SAMPLE_SIZE * 0.12));
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;

    for (let y = 0; y < SAMPLE_SIZE; y += 1) {
      for (let x = 0; x < SAMPLE_SIZE; x += 1) {
        if (x >= border && x < SAMPLE_SIZE - border && y >= border && y < SAMPLE_SIZE - border) continue;
        const index = (y * SAMPLE_SIZE + x) * 4;
        const alpha = (pixels[index + 3] ?? 0) / 255;
        if (alpha < 0.05) continue;
        red += (pixels[index] ?? 0) * alpha;
        green += (pixels[index + 1] ?? 0) * alpha;
        blue += (pixels[index + 2] ?? 0) * alpha;
        weight += alpha;
      }
    }

    if (weight <= 0) return { r: 128, g: 128, b: 128 };
    return {
      r: Math.round(red / weight),
      g: Math.round(green / weight),
      b: Math.round(blue / weight),
    };
  } catch {
    return { r: 128, g: 128, b: 128 };
  } finally {
    releaseCanvas(sample);
  }
}

function applyColorHarmony(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: RgbColor,
  strength: number,
): void {
  const safeStrength = clamp(strength, 0, 1, 0);
  if (safeStrength <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = Math.min(0.3, safeStrength * 0.24);
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
): void {
  const safeStrength = clamp(strength, 0, 0.15, 0);
  if (safeStrength <= 0) return;

  const tile = document.createElement('canvas');
  tile.width = NOISE_TILE_SIZE;
  tile.height = NOISE_TILE_SIZE;
  const tileCtx = tile.getContext('2d', { alpha: true });
  if (!tileCtx) return;

  const imageData = tileCtx.createImageData(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  const data = imageData.data;
  let seed = ((width * 73856093) ^ (height * 19349663)) >>> 0;

  for (let i = 0; i < data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 80 + ((seed >>> 24) % 96);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  tileCtx.putImageData(imageData, 0, 0);

  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = safeStrength;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  releaseCanvas(tile);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: EncodedFormat, jpegQuality: number): Promise<Blob> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('画像のエンコードに失敗しました。'));
        },
        mime,
        format === 'jpeg' ? jpegQuality : undefined,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
