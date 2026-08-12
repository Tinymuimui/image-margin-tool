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

/**
 * 縦長写真向けエッジ延長BGへ自動切替する閾値。
 * 出力幅の15%以上が左右余白になった場合を候補とする。
 */
const VERTICAL_PHOTO_EDGE_THRESHOLD = 0.15;

/**
 * 縦長とみなすアスペクト比。
 * 高さ / 幅 >= 1.08
 */
const VERTICAL_PHOTO_ASPECT_THRESHOLD = 1.08;

/**
 * エッジ延長時に使用する元画像の帯幅。
 * 描画後画像幅の12%。
 */
const EDGE_BAND_RATIO = 0.12;

export async function decodeImage(file: File): Promise<DecodedImage> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });

      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // createImageBitmapで読めない場合はHTMLImageElementへフォールバック。
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

export function assertCanvasSize(
  width: number,
  height: number,
): void {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError('出力ピクセル寸法が不正です。');
  }

  if (
    width > MAX_CANVAS_DIMENSION
    || height > MAX_CANVAS_DIMENSION
  ) {
    throw new RangeError(
      `ブラウザ処理の安全上、1辺は ${MAX_CANVAS_DIMENSION.toLocaleString()} px 以下にしてください。`,
    );
  }

  if (width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError(
      `ブラウザ処理の安全上、出力は ${(MAX_CANVAS_PIXELS / 1_000_000).toFixed(0)} MP 以下にしてください。`,
    );
  }
}

export function calculatePlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Placement {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
  ) {
    throw new RangeError('元画像のピクセル寸法が不正です。');
  }

  assertCanvasSize(targetWidth, targetHeight);

  /*
   * 元画像が出力サイズを超える場合だけ縮小する。
   * 小さい画像は拡大しない。
   */
  const scale = Math.min(
    1,
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
  );

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('画像の縮小率を計算できません。');
  }

  const drawWidth = Math.min(
    targetWidth,
    Math.max(1, Math.round(sourceWidth * scale)),
  );

  const drawHeight = Math.min(
    targetHeight,
    Math.max(1, Math.round(sourceHeight * scale)),
  );

  const offsetX = Math.max(
    0,
    Math.floor((targetWidth - drawWidth) / 2),
  );

  const offsetY = Math.max(
    0,
    Math.floor((targetHeight - drawHeight) / 2),
  );

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
    throw new RangeError(
      '背景画像または出力サイズが不正です。',
    );
  }

  if (fit === 'stretch') {
    return {
      x: 0,
      y: 0,
      width: targetWidth,
      height: targetHeight,
    };
  }

  const scale = fit === 'cover'
    ? Math.max(
      targetWidth / sourceWidth,
      targetHeight / sourceHeight,
    )
    : Math.min(
      targetWidth / sourceWidth,
      targetHeight / sourceHeight,
    );

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
  const safeRequested = Number.isFinite(requestedFeatherPx)
    ? Math.max(0, requestedFeatherPx)
    : 0;

  /*
   * フェザーが画像の大半を消してしまわないよう、
   * 最大45%までに制限。
   */
  const maxHorizontal = Math.max(
    0,
    Math.floor(placement.drawWidth * 0.45),
  );

  const maxVertical = Math.max(
    0,
    Math.floor(placement.drawHeight * 0.45),
  );

  const horizontal = Math.min(
    safeRequested,
    maxHorizontal,
  );

  const vertical = Math.min(
    safeRequested,
    maxVertical,
  );

  const rightMargin = Math.max(
    0,
    targetWidth
      - placement.offsetX
      - placement.drawWidth,
  );

  const bottomMargin = Math.max(
    0,
    targetHeight
      - placement.offsetY
      - placement.drawHeight,
  );

  return {
    left:
      placement.offsetX > 0
        ? horizontal
        : 0,

    right:
      rightMargin > 0
        ? horizontal
        : 0,

    top:
      placement.offsetY > 0
        ? vertical
        : 0,

    bottom:
      bottomMargin > 0
        ? vertical
        : 0,
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

  assertCanvasSize(
    targetWidth,
    targetHeight,
  );

  const placement = calculatePlacement(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext(
    '2d',
    { alpha: false },
  );

  if (!ctx) {
    throw new Error(
      'Canvas 2D context is unavailable.',
    );
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(
    0,
    0,
    targetWidth,
    targetHeight,
  );

  /*
   * 通常エッジ延長 / ぼかし。
   */
  if (
    mode === 'edge'
    || mode === 'blur'
  ) {
    const background =
      createEdgeExtendedBackground(
        source,
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        placement,
        backgroundColor,
      );

    drawBackgroundLayer(
      ctx,
      background,
      targetWidth,
      targetHeight,
      mode === 'blur'
        ? blurPx
        : 0,
    );

    releaseCanvas(background);
  }

  /*
   * カスタム背景。
   */
  else if (mode === 'custom') {
    if (!backgroundImage) {
      throw new Error(
        'カスタム背景画像が選択されていません。',
      );
    }

    const background =
      createImageBackground(
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

    drawBackgroundLayer(
      ctx,
      background,
      targetWidth,
      targetHeight,
      blurPx,
    );

    releaseCanvas(background);
  }

  /*
   * 写真なじませ。
   *
   * ・通常写真:
   *      従来のぼかし背景
   *
   * ・縦長＋左右余白が大きい:
   *      左右エッジ帯を延長する背景へ自動切替
   */
  else if (mode === 'photo') {
    const useCustomBackground =
      photoBackgroundSource === 'custom';

    if (
      useCustomBackground
      && !backgroundImage
    ) {
      throw new Error(
        '写真なじませでカスタム背景を使う場合は、背景画像を選択してください。',
      );
    }

    const useVerticalEdgeBackground =
      shouldUseVerticalPhotoEdgeBackground(
        placement,
        targetWidth,
        targetHeight,
        sourceWidth,
        sourceHeight,
        useCustomBackground,
      );

    /*
     * 縦長写真専用:
     * 左右エッジ延長BG。
     */
    if (useVerticalEdgeBackground) {
      const background =
        createVerticalPhotoEdgeBackground(
          source,
          sourceWidth,
          sourceHeight,
          targetWidth,
          targetHeight,
          placement,
          {
            backgroundColor,
            opacity: backgroundOpacity,
            brightness:
              backgroundBrightness,
            saturation:
              backgroundSaturation,
            contrast:
              backgroundContrast,
            blurPx,
            grainStrength,
          },
        );

      ctx.drawImage(
        background,
        0,
        0,
      );

      releaseCanvas(background);
    }

    /*
     * 通常の写真BG。
     */
    else {
      const photoBackground =
        useCustomBackground
        && backgroundImage
          ? backgroundImage
          : {
            source,
            width: sourceWidth,
            height: sourceHeight,
          };

      const background =
        createImageBackground(
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

      drawBackgroundLayer(
        ctx,
        background,
        targetWidth,
        targetHeight,
        blurPx,
      );

      releaseCanvas(background);
    }

    /*
     * 色調を少し背景へ寄せる。
     */
    const edgeColor =
      sampleEdgeColor(
        source,
        sourceWidth,
        sourceHeight,
      );

    applyColorHarmony(
      ctx,
      targetWidth,
      targetHeight,
      edgeColor,
      colorMatchStrength,
    );

    /*
     * 写真の粒状感を背景にも追加。
     */
    applyGrain(
      ctx,
      targetWidth,
      targetHeight,
      grainStrength,
    );

    /*
     * 前景写真は最後に配置。
     * 余白がある辺だけフェザー。
     */
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

  /*
   * 写真モード以外は、
   * 前景を完全不透明で配置。
   */
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation =
    'source-over';
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
  assertCanvasSize(
    targetWidth,
    targetHeight,
  );

  if (
    !Number.isFinite(maxPreviewDimension)
    || maxPreviewDimension <= 0
  ) {
    throw new RangeError(
      'maxPreviewDimension must be greater than zero.',
    );
  }

  const fullPlacement =
    calculatePlacement(
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );

  const previewScale =
    Math.min(
      1,
      maxPreviewDimension
        / Math.max(
          targetWidth,
          targetHeight,
        ),
    );

  return {
    targetWidth:
      Math.max(
        1,
        Math.round(
          targetWidth * previewScale,
        ),
      ),

    targetHeight:
      Math.max(
        1,
        Math.round(
          targetHeight * previewScale,
        ),
      ),

    sourceWidth:
      Math.max(
        1,
        Math.round(
          fullPlacement.drawWidth
            * previewScale,
        ),
      ),

    sourceHeight:
      Math.max(
        1,
        Math.round(
          fullPlacement.drawHeight
            * previewScale,
        ),
      ),

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
  const geometry =
    calculatePreviewGeometry(
      sourceWidth,
      sourceHeight,
      options.targetWidth,
      options.targetHeight,
      maxPreviewDimension,
    );

  /*
   * 巨大画像をそのままプレビューCanvasへ渡さず、
   * 必要サイズまで先に縮小。
   */
  const scaledSource =
    document.createElement('canvas');

  scaledSource.width =
    geometry.sourceWidth;

  scaledSource.height =
    geometry.sourceHeight;

  const scaledCtx =
    scaledSource.getContext(
      '2d',
      { alpha: true },
    );

  if (!scaledCtx) {
    throw new Error(
      'Preview Canvas 2D context is unavailable.',
    );
  }

  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = 'high';

  scaledCtx.drawImage(
    source,
    0,
    0,
    geometry.sourceWidth,
    geometry.sourceHeight,
  );

  try {
    return renderImage(
      scaledSource,
      geometry.sourceWidth,
      geometry.sourceHeight,
      {
        ...options,

        targetWidth:
          geometry.targetWidth,

        targetHeight:
          geometry.targetHeight,

        blurPx:
          options.blurPx
          * geometry.previewScale,

        featherPx:
          options.featherPx
          * geometry.previewScale,
      },
    );
  } finally {
    releaseCanvas(scaledSource);
  }
}

/**
 * Canvas背景レイヤーを描画する。
 *
 * blur使用時は外周が透明っぽくならないよう
 * overscanして描画する。
 */
function drawBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  background: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  blurPx: number,
): void {
  if (blurPx > 0) {
    const safeBlur = Math.min(
      Math.max(0, blurPx),
      Math.max(
        targetWidth,
        targetHeight,
      ),
    );

    const pad = Math.max(
      2,
      Math.ceil(safeBlur * 2),
    );

    ctx.save();

    ctx.filter =
      `blur(${safeBlur.toFixed(2)}px)`;

    ctx.drawImage(
      background,
      -pad,
      -pad,
      targetWidth + pad * 2,
      targetHeight + pad * 2,
    );

    ctx.restore();
  } else {
    ctx.drawImage(
      background,
      0,
      0,
    );
  }
}

/**
 * 通常の画像BG生成。
 */
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
  const bg =
    document.createElement('canvas');

  bg.width = targetWidth;
  bg.height = targetHeight;

  const ctx =
    bg.getContext(
      '2d',
      { alpha: false },
    );

  if (!ctx) {
    throw new Error(
      'Background Canvas 2D context is unavailable.',
    );
  }

  ctx.fillStyle = backgroundColor;

  ctx.fillRect(
    0,
    0,
    targetWidth,
    targetHeight,
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const rect =
    calculateBackgroundRect(
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      fit,
    );

  const safeOpacity =
    clamp(
      opacity,
      0,
      1,
      1,
    );

  const safeBrightness =
    clamp(
      brightness,
      0,
      3,
      1,
    );

  const safeSaturation =
    clamp(
      saturation,
      0,
      3,
      1,
    );

  const safeContrast =
    clamp(
      contrast,
      0,
      3,
      1,
    );

  ctx.save();

  ctx.globalAlpha =
    safeOpacity;

  ctx.filter = [
    `brightness(${safeBrightness.toFixed(3)})`,
    `saturate(${safeSaturation.toFixed(3)})`,
    `contrast(${safeContrast.toFixed(3)})`,
  ].join(' ');

  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );

  ctx.restore();

  return bg;
}

/**
 * 従来の単純エッジ延長。
 */
function createEdgeExtendedBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  placement: Placement,
  backgroundColor: string,
): HTMLCanvasElement {
  const bg =
    document.createElement('canvas');

  bg.width = targetWidth;
  bg.height = targetHeight;

  const ctx =
    bg.getContext(
      '2d',
      { alpha: false },
    );

  if (!ctx) {
    throw new Error(
      'Background Canvas 2D context is unavailable.',
    );
  }

  ctx.fillStyle = backgroundColor;

  ctx.fillRect(
    0,
    0,
    targetWidth,
    targetHeight,
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const {
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
  } = placement;

  const rightWidth =
    Math.max(
      0,
      targetWidth
        - offsetX
        - drawWidth,
    );

  const bottomHeight =
    Math.max(
      0,
      targetHeight
        - offsetY
        - drawHeight,
    );

  /*
   * 左。
   */
  if (offsetX > 0) {
    ctx.drawImage(
      source,
      0,
      0,
      1,
      sourceHeight,

      0,
      offsetY,
      offsetX,
      drawHeight,
    );
  }

  /*
   * 右。
   */
  if (rightWidth > 0) {
    ctx.drawImage(
      source,
      sourceWidth - 1,
      0,
      1,
      sourceHeight,

      offsetX + drawWidth,
      offsetY,
      rightWidth,
      drawHeight,
    );
  }

  /*
   * 上。
   */
  if (offsetY > 0) {
    ctx.drawImage(
      source,
      0,
      0,
      sourceWidth,
      1,

      offsetX,
      0,
      drawWidth,
      offsetY,
    );
  }

  /*
   * 下。
   */
  if (bottomHeight > 0) {
    ctx.drawImage(
      source,
      0,
      sourceHeight - 1,
      sourceWidth,
      1,

      offsetX,
      offsetY + drawHeight,
      drawWidth,
      bottomHeight,
    );
  }

  /*
   * 左上。
   */
  if (
    offsetX > 0
    && offsetY > 0
  ) {
    ctx.drawImage(
      source,
      0,
      0,
      1,
      1,

      0,
      0,
      offsetX,
      offsetY,
    );
  }

  /*
   * 右上。
   */
  if (
    rightWidth > 0
    && offsetY > 0
  ) {
    ctx.drawImage(
      source,
      sourceWidth - 1,
      0,
      1,
      1,

      offsetX + drawWidth,
      0,
      rightWidth,
      offsetY,
    );
  }

  /*
   * 左下。
   */
  if (
    offsetX > 0
    && bottomHeight > 0
  ) {
    ctx.drawImage(
      source,
      0,
      sourceHeight - 1,
      1,
      1,

      0,
      offsetY + drawHeight,
      offsetX,
      bottomHeight,
    );
  }

  /*
   * 右下。
   */
  if (
    rightWidth > 0
    && bottomHeight > 0
  ) {
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

  /*
   * 中央元画像。
   */
  ctx.drawImage(
    source,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight,
  );

  return bg;
}

/**
 * 写真モードで縦長写真用の
 * エッジ延長背景を使うか判定。
 */
function shouldUseVerticalPhotoEdgeBackground(
  placement: Placement,
  targetWidth: number,
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  useCustomBackground: boolean,
): boolean {
  /*
   * ユーザーがカスタム背景を選択している場合は
   * 勝手にエッジ延長へ切り替えない。
   */
  if (useCustomBackground) {
    return false;
  }

  const horizontalMarginRatio =
    Math.max(
      0,
      targetWidth
        - placement.drawWidth,
    ) / targetWidth;

  const verticalMarginRatio =
    Math.max(
      0,
      targetHeight
        - placement.drawHeight,
    ) / targetHeight;

  const aspectRatio =
    sourceHeight / sourceWidth;

  return (
    horizontalMarginRatio
      >= VERTICAL_PHOTO_EDGE_THRESHOLD

    && horizontalMarginRatio
      > verticalMarginRatio

    && aspectRatio
      >= VERTICAL_PHOTO_ASPECT_THRESHOLD
  );
}

/**
 * 縦長写真向け背景。
 *
 * 元画像全体を巨大化するのではなく、
 * 左右端の帯を利用して余白を生成する。
 */
function createVerticalPhotoEdgeBackground(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  placement: Placement,
  options: {
    backgroundColor: string;
    opacity: number;
    brightness: number;
    saturation: number;
    contrast: number;
    blurPx: number;
    grainStrength: number;
  },
): HTMLCanvasElement {
  const bg =
    document.createElement('canvas');

  bg.width = targetWidth;
  bg.height = targetHeight;

  const ctx =
    bg.getContext(
      '2d',
      { alpha: false },
    );

  if (!ctx) {
    throw new Error(
      'Background Canvas 2D context is unavailable.',
    );
  }

  ctx.fillStyle =
    options.backgroundColor;

  ctx.fillRect(
    0,
    0,
    targetWidth,
    targetHeight,
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /*
   * まず実際に出力される前景サイズへ縮小した
   * 作業用Canvasを作る。
   */
  const fitted =
    document.createElement('canvas');

  fitted.width =
    placement.drawWidth;

  fitted.height =
    placement.drawHeight;

  const fittedCtx =
    fitted.getContext(
      '2d',
      { alpha: true },
    );

  if (!fittedCtx) {
    releaseCanvas(bg);

    throw new Error(
      'Photo background working Canvas 2D context is unavailable.',
    );
  }

  fittedCtx.imageSmoothingEnabled = true;
  fittedCtx.imageSmoothingQuality = 'high';

  fittedCtx.drawImage(
    source,
    0,
    0,
    placement.drawWidth,
    placement.drawHeight,
  );

  const leftMargin =
    placement.offsetX;

  const rightMargin =
    Math.max(
      0,
      targetWidth
        - placement.offsetX
        - placement.drawWidth,
    );

  const topMargin =
    placement.offsetY;

  const bottomMargin =
    Math.max(
      0,
      targetHeight
        - placement.offsetY
        - placement.drawHeight,
    );

  const safeOpacity =
    clamp(
      options.opacity,
      0,
      1,
      1,
    );

  const safeBrightness =
    clamp(
      options.brightness,
      0,
      3,
      1,
    );

  const safeSaturation =
    clamp(
      options.saturation,
      0,
      3,
      1,
    );

  const safeContrast =
    clamp(
      options.contrast,
      0,
      3,
      1,
    );

  /*
   * 内側は弱くぼかす。
   * 外側は強くぼかす。
   */
  const innerBlur =
    Math.max(
      0.75,
      options.blurPx * 0.35,
    );

  const outerBlur =
    Math.max(
      innerBlur + 0.75,
      options.blurPx * 1.15,
      2,
    );

  /*
   * 上下にも余白が存在する特殊ケースでは、
   * 元画像cover背景を弱く補助的に敷く。
   */
  if (
    topMargin > 0
    || bottomMargin > 0
  ) {
    const base =
      createImageBackground(
        source,
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        'cover',
        options.backgroundColor,
        Math.min(
          1,
          safeOpacity * 0.42,
        ),
        safeBrightness,
        safeSaturation,
        safeContrast,
      );

    drawBackgroundLayer(
      ctx,
      base,
      targetWidth,
      targetHeight,
      outerBlur,
    );

    releaseCanvas(base);
  }

  /*
   * 元画像端から約12%を使用。
   * 最低24px。
   * 最大で画像幅の1/3。
   */
  const bandWidth =
    Math.min(
      Math.max(
        24,
        Math.round(
          placement.drawWidth
            * EDGE_BAND_RATIO,
        ),
      ),
      Math.max(
        1,
        Math.floor(
          placement.drawWidth / 3,
        ),
      ),
    );

  /*
   * 左背景。
   */
  if (leftMargin > 0) {
    /*
     * 内側:
     * 比較的弱いぼかし。
     */
    drawEdgeBandBackground(
      ctx,
      fitted,
      {
        sourceX: 0,
        sourceY: 0,
        sourceWidth: bandWidth,
        sourceHeight:
          placement.drawHeight,

        destX: 0,
        destY:
          placement.offsetY,

        destWidth:
          leftMargin
          + bandWidth,

        destHeight:
          placement.drawHeight,

        opacity:
          safeOpacity,

        brightness:
          safeBrightness,

        saturation:
          safeSaturation,

        contrast:
          safeContrast,

        blurPx:
          innerBlur,
      },
    );

    /*
     * 外側:
     * 強めのぼかしを薄く重ねる。
     */
    drawEdgeBandBackground(
      ctx,
      fitted,
      {
        sourceX: 0,
        sourceY: 0,
        sourceWidth: bandWidth,
        sourceHeight:
          placement.drawHeight,

        destX: 0,

        destY:
          placement.offsetY,

        destWidth:
          leftMargin
          + Math.round(
            bandWidth * 1.5,
          ),

        destHeight:
          placement.drawHeight,

        opacity:
          safeOpacity * 0.42,

        brightness:
          safeBrightness,

        saturation:
          safeSaturation,

        contrast:
          safeContrast,

        blurPx:
          outerBlur,
      },
    );
  }

  /*
   * 右背景。
   */
  if (rightMargin > 0) {
    /*
     * 内側。
     */
    drawEdgeBandBackground(
      ctx,
      fitted,
      {
        sourceX:
          placement.drawWidth
          - bandWidth,

        sourceY: 0,

        sourceWidth:
          bandWidth,

        sourceHeight:
          placement.drawHeight,

        destX:
          placement.offsetX
          + placement.drawWidth
          - bandWidth,

        destY:
          placement.offsetY,

        destWidth:
          rightMargin
          + bandWidth,

        destHeight:
          placement.drawHeight,

        opacity:
          safeOpacity,

        brightness:
          safeBrightness,

        saturation:
          safeSaturation,

        contrast:
          safeContrast,

        blurPx:
          innerBlur,
      },
    );

    /*
     * 外側。
     */
    drawEdgeBandBackground(
      ctx,
      fitted,
      {
        sourceX:
          placement.drawWidth
          - bandWidth,

        sourceY: 0,

        sourceWidth:
          bandWidth,

        sourceHeight:
          placement.drawHeight,

        destX:
          placement.offsetX
          + placement.drawWidth
          - Math.round(
            bandWidth * 0.5,
          ),

        destY:
          placement.offsetY,

        destWidth:
          rightMargin
          + Math.round(
            bandWidth * 1.5,
          ),

        destHeight:
          placement.drawHeight,

        opacity:
          safeOpacity * 0.42,

        brightness:
          safeBrightness,

        saturation:
          safeSaturation,

        contrast:
          safeContrast,

        blurPx:
          outerBlur,
      },
    );
  }

  /*
   * 延長背景側にも軽く色を馴染ませる。
   */
  applyColorHarmony(
    ctx,
    targetWidth,
    targetHeight,
    sampleEdgeColor(
      fitted,
      placement.drawWidth,
      placement.drawHeight,
    ),
    0.16,
  );

  /*
   * エッジ背景内部にも若干粒状感を付与。
   * 後段でも全体へgrainが入るため、
   * ここでは弱め。
   */
  applyGrain(
    ctx,
    targetWidth,
    targetHeight,
    Math.min(
      0.035,
      options.grainStrength * 0.6,
    ),
  );

  releaseCanvas(fitted);

  return bg;
}

/**
 * エッジ帯を指定領域へ引き伸ばして描画。
 */
function drawEdgeBandBackground(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: {
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;

    destX: number;
    destY: number;
    destWidth: number;
    destHeight: number;

    opacity: number;
    brightness: number;
    saturation: number;
    contrast: number;
    blurPx: number;
  },
): void {
  if (
    rect.destWidth <= 0
    || rect.destHeight <= 0
    || rect.sourceWidth <= 0
    || rect.sourceHeight <= 0
  ) {
    return;
  }

  ctx.save();

  ctx.globalAlpha =
    rect.opacity;

  ctx.filter = [
    `blur(${Math.max(0, rect.blurPx).toFixed(2)}px)`,
    `brightness(${rect.brightness.toFixed(3)})`,
    `saturate(${rect.saturation.toFixed(3)})`,
    `contrast(${rect.contrast.toFixed(3)})`,
  ].join(' ');

  ctx.drawImage(
    source,

    rect.sourceX,
    rect.sourceY,
    rect.sourceWidth,
    rect.sourceHeight,

    rect.destX,
    rect.destY,
    rect.destWidth,
    rect.destHeight,
  );

  ctx.restore();
}

/**
 * 前景写真をフェザー付きで合成。
 *
 * v1.3.0で発生していた、
 * destination-inを辺ごと直接適用して
 * 前景全体が消える問題を防ぐため、
 *
 * 1. 全面不透明マスク作成
 * 2. 辺ごとのグラデーションをマスクへ乗算
 * 3. 完成マスクを前景へ一度だけ適用
 *
 * の順で処理する。
 */
function drawFeatheredForeground(
  targetCtx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: Placement,
  targetWidth: number,
  targetHeight: number,
  featherPx: number,
): void {
  const insets =
    calculateFeatherInsets(
      placement,
      targetWidth,
      targetHeight,
      featherPx,
    );

  const hasFeather =
    insets.left > 0
    || insets.right > 0
    || insets.top > 0
    || insets.bottom > 0;

  /*
   * フェザー不要。
   */
  if (!hasFeather) {
    targetCtx.save();

    targetCtx.globalAlpha = 1;

    targetCtx.globalCompositeOperation =
      'source-over';

    targetCtx.filter = 'none';

    targetCtx.drawImage(
      source,
      placement.offsetX,
      placement.offsetY,
      placement.drawWidth,
      placement.drawHeight,
    );

    targetCtx.restore();

    return;
  }

  /*
   * 前景Canvas。
   */
  const foreground =
    document.createElement('canvas');

  foreground.width =
    placement.drawWidth;

  foreground.height =
    placement.drawHeight;

  const foregroundCtx =
    foreground.getContext(
      '2d',
      { alpha: true },
    );

  if (!foregroundCtx) {
    throw new Error(
      'Foreground feather Canvas 2D context is unavailable.',
    );
  }

  foregroundCtx.imageSmoothingEnabled = true;
  foregroundCtx.imageSmoothingQuality = 'high';

  foregroundCtx.drawImage(
    source,
    0,
    0,
    placement.drawWidth,
    placement.drawHeight,
  );

  /*
   * フェザーマスク。
   */
  const mask =
    document.createElement('canvas');

  mask.width =
    placement.drawWidth;

  mask.height =
    placement.drawHeight;

  const maskCtx =
    mask.getContext(
      '2d',
      { alpha: true },
    );

  if (!maskCtx) {
    releaseCanvas(foreground);

    throw new Error(
      'Foreground feather mask Canvas 2D context is unavailable.',
    );
  }

  /*
   * 初期状態は全面不透明。
   */
  maskCtx.fillStyle =
    'rgba(255,255,255,1)';

  maskCtx.fillRect(
    0,
    0,
    placement.drawWidth,
    placement.drawHeight,
  );

  /*
   * 各グラデーションを乗算。
   */
  maskCtx.globalCompositeOperation =
    'destination-in';

  /*
   * 左フェザー。
   */
  if (insets.left > 0) {
    const gradient =
      maskCtx.createLinearGradient(
        0,
        0,
        placement.drawWidth,
        0,
      );

    gradient.addColorStop(
      0,
      'rgba(255,255,255,0)',
    );

    gradient.addColorStop(
      insets.left
        / placement.drawWidth,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      1,
      'rgba(255,255,255,1)',
    );

    maskCtx.fillStyle = gradient;

    maskCtx.fillRect(
      0,
      0,
      placement.drawWidth,
      placement.drawHeight,
    );
  }

  /*
   * 右フェザー。
   */
  if (insets.right > 0) {
    const start =
      placement.drawWidth
      - insets.right;

    const gradient =
      maskCtx.createLinearGradient(
        0,
        0,
        placement.drawWidth,
        0,
      );

    gradient.addColorStop(
      0,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      start
        / placement.drawWidth,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      1,
      'rgba(255,255,255,0)',
    );

    maskCtx.fillStyle = gradient;

    maskCtx.fillRect(
      0,
      0,
      placement.drawWidth,
      placement.drawHeight,
    );
  }

  /*
   * 上フェザー。
   */
  if (insets.top > 0) {
    const gradient =
      maskCtx.createLinearGradient(
        0,
        0,
        0,
        placement.drawHeight,
      );

    gradient.addColorStop(
      0,
      'rgba(255,255,255,0)',
    );

    gradient.addColorStop(
      insets.top
        / placement.drawHeight,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      1,
      'rgba(255,255,255,1)',
    );

    maskCtx.fillStyle = gradient;

    maskCtx.fillRect(
      0,
      0,
      placement.drawWidth,
      placement.drawHeight,
    );
  }

  /*
   * 下フェザー。
   */
  if (insets.bottom > 0) {
    const start =
      placement.drawHeight
      - insets.bottom;

    const gradient =
      maskCtx.createLinearGradient(
        0,
        0,
        0,
        placement.drawHeight,
      );

    gradient.addColorStop(
      0,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      start
        / placement.drawHeight,
      'rgba(255,255,255,1)',
    );

    gradient.addColorStop(
      1,
      'rgba(255,255,255,0)',
    );

    maskCtx.fillStyle = gradient;

    maskCtx.fillRect(
      0,
      0,
      placement.drawWidth,
      placement.drawHeight,
    );
  }

  /*
   * 完成したマスクを前景へ適用。
   */
  foregroundCtx.save();

  foregroundCtx.globalCompositeOperation =
    'destination-in';

  foregroundCtx.drawImage(
    mask,
    0,
    0,
  );

  foregroundCtx.restore();

  /*
   * 背景へ合成。
   */
  targetCtx.save();

  targetCtx.globalCompositeOperation =
    'source-over';

  targetCtx.globalAlpha = 1;
  targetCtx.filter = 'none';

  targetCtx.drawImage(
    foreground,
    placement.offsetX,
    placement.offsetY,
  );

  targetCtx.restore();

  releaseCanvas(mask);
  releaseCanvas(foreground);
}

/**
 * 元画像外周の平均色を取得。
 */
function sampleEdgeColor(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): RgbColor {
  const sample =
    document.createElement('canvas');

  sample.width =
    SAMPLE_SIZE;

  sample.height =
    SAMPLE_SIZE;

  const ctx =
    sample.getContext(
      '2d',
      {
        alpha: true,
        willReadFrequently: true,
      },
    );

  if (!ctx) {
    return {
      r: 128,
      g: 128,
      b: 128,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    source,

    0,
    0,
    sourceWidth,
    sourceHeight,

    0,
    0,
    SAMPLE_SIZE,
    SAMPLE_SIZE,
  );

  try {
    const pixels =
      ctx.getImageData(
        0,
        0,
        SAMPLE_SIZE,
        SAMPLE_SIZE,
      ).data;

    const border =
      Math.max(
        2,
        Math.floor(
          SAMPLE_SIZE * 0.12,
        ),
      );

    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;

    for (
      let y = 0;
      y < SAMPLE_SIZE;
      y += 1
    ) {
      for (
        let x = 0;
        x < SAMPLE_SIZE;
        x += 1
      ) {
        const isInner =
          x >= border
          && x < SAMPLE_SIZE - border
          && y >= border
          && y < SAMPLE_SIZE - border;

        if (isInner) {
          continue;
        }

        const index =
          (y * SAMPLE_SIZE + x) * 4;

        const alpha =
          (pixels[index + 3] ?? 0)
          / 255;

        if (alpha < 0.05) {
          continue;
        }

        red +=
          (pixels[index] ?? 0)
          * alpha;

        green +=
          (pixels[index + 1] ?? 0)
          * alpha;

        blue +=
          (pixels[index + 2] ?? 0)
          * alpha;

        weight += alpha;
      }
    }

    if (weight <= 0) {
      return {
        r: 128,
        g: 128,
        b: 128,
      };
    }

    return {
      r:
        Math.round(
          red / weight,
        ),

      g:
        Math.round(
          green / weight,
        ),

      b:
        Math.round(
          blue / weight,
        ),
    };
  } catch {
    return {
      r: 128,
      g: 128,
      b: 128,
    };
  } finally {
    releaseCanvas(sample);
  }
}

/**
 * BGへ元画像の外周色を弱く混ぜる。
 */
function applyColorHarmony(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: RgbColor,
  strength: number,
): void {
  const safeStrength =
    clamp(
      strength,
      0,
      1,
      0,
    );

  if (safeStrength <= 0) {
    return;
  }

  ctx.save();

  ctx.globalCompositeOperation =
    'soft-light';

  ctx.globalAlpha =
    Math.min(
      0.3,
      safeStrength * 0.24,
    );

  ctx.fillStyle =
    `rgb(${color.r}, ${color.g}, ${color.b})`;

  ctx.fillRect(
    0,
    0,
    width,
    height,
  );

  ctx.restore();
}

/**
 * 背景に微量の粒状感を追加。
 */
function applyGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
): void {
  const safeStrength =
    clamp(
      strength,
      0,
      0.15,
      0,
    );

  if (safeStrength <= 0) {
    return;
  }

  const tile =
    document.createElement('canvas');

  tile.width =
    NOISE_TILE_SIZE;

  tile.height =
    NOISE_TILE_SIZE;

  const tileCtx =
    tile.getContext(
      '2d',
      { alpha: true },
    );

  if (!tileCtx) {
    return;
  }

  const imageData =
    tileCtx.createImageData(
      NOISE_TILE_SIZE,
      NOISE_TILE_SIZE,
    );

  const data =
    imageData.data;

  /*
   * 毎回見た目が変わり過ぎないよう
   * deterministicな疑似乱数。
   */
  let seed =
    (
      (width * 73856093)
      ^ (height * 19349663)
    ) >>> 0;

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {
    seed =
      (
        Math.imul(
          seed,
          1664525,
        )
        + 1013904223
      ) >>> 0;

    const value =
      80
      + (
        (seed >>> 24)
        % 96
      );

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  tileCtx.putImageData(
    imageData,
    0,
    0,
  );

  const pattern =
    ctx.createPattern(
      tile,
      'repeat',
    );

  if (pattern) {
    ctx.save();

    ctx.globalCompositeOperation =
      'soft-light';

    ctx.globalAlpha =
      safeStrength;

    ctx.fillStyle =
      pattern;

    ctx.fillRect(
      0,
      0,
      width,
      height,
    );

    ctx.restore();
  }

  releaseCanvas(tile);
}

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  );
}

function releaseCanvas(
  canvas: HTMLCanvasElement,
): void {
  canvas.width = 1;
  canvas.height = 1;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: EncodedFormat,
  jpegQuality: number,
): Promise<Blob> {
  const mime =
    format === 'png'
      ? 'image/png'
      : 'image/jpeg';

  return new Promise(
    (resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(
                new Error(
                  '画像のエンコードに失敗しました。',
                ),
              );
            }
          },
          mime,
          format === 'jpeg'
            ? jpegQuality
            : undefined,
        );
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(
              String(error),
            ),
        );
      }
    },
  );
}
