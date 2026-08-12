import type { EncodedFormat, RenderOptions } from '../types';

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
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

export function renderImage(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, options: RenderOptions): HTMLCanvasElement {
  const { targetWidth, targetHeight, mode, blurPx, backgroundColor } = options;
  assertCanvasSize(targetWidth, targetHeight);
  if (sourceWidth > targetWidth || sourceHeight > targetHeight) {
    throw new RangeError('元画像が指定した仕上がりサイズを超えています。元画像は縮小しない仕様のため処理できません。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D コンテキストを取得できません。');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const offsetX = Math.floor((targetWidth - sourceWidth) / 2);
  const offsetY = Math.floor((targetHeight - sourceHeight) / 2);

  if (mode === 'edge' || mode === 'blur') {
    const background = createEdgeExtendedBackground(
      source,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      offsetX,
      offsetY,
      backgroundColor,
    );

    if (mode === 'blur' && blurPx > 0) {
      const pad = Math.max(2, Math.ceil(blurPx * 2));
      ctx.save();
      ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      // Overscan prevents transparent/white fade at the outer canvas boundary during blur.
      ctx.drawImage(background, -pad, -pad, targetWidth + pad * 2, targetHeight + pad * 2);
      ctx.restore();
    } else {
      ctx.drawImage(background, 0, 0);
    }
  }

  // The original image is always drawn last at 1:1. Its pixels are not scaled or blurred.
  ctx.filter = 'none';
  ctx.drawImage(source, offsetX, offsetY, sourceWidth, sourceHeight);
  return canvas;
}

export function renderPreview(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: RenderOptions,
  maxPreviewDimension = 720,
): HTMLCanvasElement {
  const scale = Math.min(1, maxPreviewDimension / Math.max(options.targetWidth, options.targetHeight));
  const targetWidth = Math.max(1, Math.round(options.targetWidth * scale));
  const targetHeight = Math.max(1, Math.round(options.targetHeight * scale));
  const scaledSourceWidth = Math.max(1, Math.round(sourceWidth * scale));
  const scaledSourceHeight = Math.max(1, Math.round(sourceHeight * scale));

  const scaledSource = document.createElement('canvas');
  scaledSource.width = scaledSourceWidth;
  scaledSource.height = scaledSourceHeight;
  const scaledCtx = scaledSource.getContext('2d', { alpha: false });
  if (!scaledCtx) throw new Error('プレビュー用 Canvas 2D コンテキストを取得できません。');
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = 'high';
  scaledCtx.drawImage(source, 0, 0, scaledSourceWidth, scaledSourceHeight);

  return renderImage(scaledSource, scaledSourceWidth, scaledSourceHeight, {
    ...options,
    targetWidth,
    targetHeight,
    blurPx: options.blurPx * scale,
  });
}

function createEdgeExtendedBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  offsetX: number,
  offsetY: number,
  backgroundColor: string,
): HTMLCanvasElement {
  const bg = document.createElement('canvas');
  bg.width = targetWidth;
  bg.height = targetHeight;
  const ctx = bg.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('背景用 Canvas 2D コンテキストを取得できません。');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const rightWidth = targetWidth - offsetX - sourceWidth;
  const bottomHeight = targetHeight - offsetY - sourceHeight;

  if (offsetX > 0) {
    ctx.drawImage(source, 0, 0, 1, sourceHeight, 0, offsetY, offsetX, sourceHeight);
  }
  if (rightWidth > 0) {
    ctx.drawImage(source, sourceWidth - 1, 0, 1, sourceHeight, offsetX + sourceWidth, offsetY, rightWidth, sourceHeight);
  }
  if (offsetY > 0) {
    ctx.drawImage(source, 0, 0, sourceWidth, 1, offsetX, 0, sourceWidth, offsetY);
  }
  if (bottomHeight > 0) {
    ctx.drawImage(source, 0, sourceHeight - 1, sourceWidth, 1, offsetX, offsetY + sourceHeight, sourceWidth, bottomHeight);
  }

  // Corners use the corner pixel so all target pixels are initialized before blur.
  if (offsetX > 0 && offsetY > 0) {
    ctx.drawImage(source, 0, 0, 1, 1, 0, 0, offsetX, offsetY);
  }
  if (rightWidth > 0 && offsetY > 0) {
    ctx.drawImage(source, sourceWidth - 1, 0, 1, 1, offsetX + sourceWidth, 0, rightWidth, offsetY);
  }
  if (offsetX > 0 && bottomHeight > 0) {
    ctx.drawImage(source, 0, sourceHeight - 1, 1, 1, 0, offsetY + sourceHeight, offsetX, bottomHeight);
  }
  if (rightWidth > 0 && bottomHeight > 0) {
    ctx.drawImage(
      source,
      sourceWidth - 1,
      sourceHeight - 1,
      1,
      1,
      offsetX + sourceWidth,
      offsetY + sourceHeight,
      rightWidth,
      bottomHeight,
    );
  }

  ctx.drawImage(source, offsetX, offsetY, sourceWidth, sourceHeight);
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
