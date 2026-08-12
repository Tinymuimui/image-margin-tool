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

const MAX_CANVAS_PIXELS = 80_000_000;
const MAX_CANVAS_DIMENSION = 32_767;

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
      // Fall through to HTMLImageElement for browsers/files createImageBitmap cannot decode.
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
    backgroundColor,
    backgroundImage,
    backgroundFit,
    backgroundOpacity,
    backgroundBrightness,
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
    background.width = 1;
    background.height = 1;
  } else if (mode === 'custom') {
    if (!backgroundImage) {
      throw new Error('カスタム背景画像が選択されていません。');
    }

    const background = createCustomBackground(
      backgroundImage.source,
      backgroundImage.width,
      backgroundImage.height,
      targetWidth,
      targetHeight,
      backgroundFit,
      backgroundColor,
      backgroundOpacity,
      backgroundBrightness,
    );

    drawBackgroundLayer(ctx, background, targetWidth, targetHeight, blurPx);
    background.width = 1;
    background.height = 1;
  }

  // Draw the foreground last. It is only scaled when it would exceed the target canvas.
  ctx.globalAlpha = 1;
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

  // Pre-scale the foreground to its fitted preview size. This avoids huge preview canvases
  // when a very large source image is dropped into the app.
  const scaledSource = document.createElement('canvas');
  scaledSource.width = geometry.sourceWidth;
  scaledSource.height = geometry.sourceHeight;
  const scaledCtx = scaledSource.getContext('2d', { alpha: false });
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
    });
  } finally {
    scaledSource.width = 1;
    scaledSource.height = 1;
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

function createCustomBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: BackgroundFit,
  backgroundColor: string,
  opacity: number,
  brightness: number,
): HTMLCanvasElement {
  const bg = document.createElement('canvas');
  bg.width = targetWidth;
  bg.height = targetHeight;
  const ctx = bg.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Custom background Canvas 2D context is unavailable.');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const rect = calculateBackgroundRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fit);
  const safeOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const safeBrightness = Number.isFinite(brightness) ? Math.min(3, Math.max(0, brightness)) : 1;

  ctx.save();
  ctx.globalAlpha = safeOpacity;
  ctx.filter = `brightness(${safeBrightness.toFixed(3)})`;
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
