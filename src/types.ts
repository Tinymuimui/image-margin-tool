export type MarginMode = 'blur' | 'photo' | 'edge' | 'solid' | 'custom';
export type OutputFormat = 'same' | 'png' | 'jpeg';
export type BackgroundFit = 'cover' | 'contain' | 'stretch';
export type PhotoBackgroundSource = 'source' | 'custom';

export interface Settings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  mode: MarginMode;
  blurMm: number;
  featherMm: number;
  backgroundColor: string;
  backgroundFit: BackgroundFit;
  backgroundOpacity: number;
  backgroundBrightness: number;
  backgroundSaturation: number;
  backgroundContrast: number;
  photoBackgroundSource: PhotoBackgroundSource;
  colorMatchStrength: number;
  grainStrength: number;
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
  featherPx: number;
  backgroundColor: string;
  backgroundImage?: RenderBackgroundImage | undefined;
  backgroundFit: BackgroundFit;
  backgroundOpacity: number;
  backgroundBrightness: number;
  backgroundSaturation: number;
  backgroundContrast: number;
  photoBackgroundSource: PhotoBackgroundSource;
  colorMatchStrength: number;
  grainStrength: number;
}

export type EncodedFormat = 'png' | 'jpeg';
