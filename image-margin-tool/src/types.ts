export type MarginMode = 'blur' | 'edge' | 'solid';
export type OutputFormat = 'same' | 'png' | 'jpeg';

export interface Settings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  mode: MarginMode;
  blurMm: number;
  backgroundColor: string;
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

export interface RenderOptions {
  targetWidth: number;
  targetHeight: number;
  mode: MarginMode;
  blurPx: number;
  backgroundColor: string;
}

export type EncodedFormat = 'png' | 'jpeg';
