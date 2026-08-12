import type { EncodedFormat, RenderOptions } from '../types';

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
    throw new RangeError('\u51fa\u529b\u30d4\u30af\u30bb\u30eb\u5bf8\u6cd5\u304c\u4e0d\u6b63\u3067\u3059\u3002');
  }
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new RangeError(`\u30d6\u30e9\u30a6\u30b6\u51e6\u7406\u306e\u5b89\u5168\u4e0a\u30011\u8fba\u306f ${MAX_CANVAS_DIMENSION.toLocaleString()} px \u4ee5\u4e0b\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002`);
  }
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError(`\u30d6\u30e9\u30a6\u30b6\u51e6\u7406\u306e\u5b89\u5168\u4e0a\u3001\u51fa\u529b\u306f ${(MAX_CANVAS_PIXELS / 1_000_000).toFixed(0)} MP \u4ee5\u4e0b\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002`);
  }
}

export function calculatePlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Placement {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('\u5143\u753b\u50cf\u306e\u30d4\u30af\u30bb\u30eb\u5bf8\u6cd5\u304c\u4e0d\u6b63\u3067\u3059\u3002');
  }
  assertCanvasSize(targetWidth, targetHeight);

  const scale = Math.min(1, targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('\u753b\u50cf\u306e\u7e2e\u5c0f\u7387\u3092\u8a08\u7b97\u3067\u304d\u307e\u305b\u3093\u3002');
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

export function renderImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: RenderOptions,
): HTMLCanvasElement {
  const { targetWidth, targetHeight, mode, blurPx, backgroundColor } = options;
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

    if (mode === 'blur' && blurPx > 0) {
      const pad = Math.max(2, Math.ceil(blurPx * 2));
      ctx.save();
      ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      // Overscan avoids a pale/transparent blur fringe at the outer canvas boundary.
      ctx.drawImage(background, -pad, -pad, targetWidth + pad * 2, targetHeight + pad * 2);
      ctx.restore();
    } else {
      ctx.drawImage(background, 0, 0);
    }

    background.width = 1;
    background.height = 1;
  }

  // Draw the foreground last. It is only scaled when it would exceed the target canvas.
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

  // Important: pre-scale to the fitted foreground size, not merely by previewScale.
  // This keeps oversized source images from creating unnecessarily huge preview canvases.
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
          else reject(new Error('\u753b\u50cf\u306e\u30a8\u30f3\u30b3\u30fc\u30c9\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002'));
        },
        mime,
        format === 'jpeg' ? jpegQuality : undefined,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
