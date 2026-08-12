export type MarginMode = 'blur' | 'edge' | 'solid' | 'custom';
export type OutputFormat = 'same' | 'png' | 'jpeg';
export type BackgroundFit = 'cover' | 'contain' | 'stretch';

export interface Settings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  mode: MarginMode;
  blurMm: number;
  backgroundColor: string;
  backgroundFit: BackgroundFit;
  backgroundOpacity: number;
  backgroundBrightness: number;
  outputFormat: OutputFormat;
  jpegQuality: number;
}

export interface ImageItem {
  id: string;
  file: File;
  widthPx: number;
  heightPx: number;
}

export interface TargetSize {
  widthPx: number;
  heightPx: number;
}

export interface RenderBackgroundImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface RenderOptions {
  targetWidth: number;
  targetHeight: number;
  mode: MarginMode;
  blurPx: number;
  backgroundColor: string;
  backgroundImage?: RenderBackgroundImage | undefined;
  backgroundFit: BackgroundFit;
  backgroundOpacity: number;
  backgroundBrightness: number;
}

export type EncodedFormat = 'png' | 'jpeg';
