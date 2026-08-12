import type { EncodedFormat, OutputFormat } from '../types';

export function isSupportedImage(file: File): boolean {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true;
  return /\.(jpe?g|png)$/i.test(file.name);
}

export function resolveOutputFormat(file: File, selected: OutputFormat): EncodedFormat {
  if (selected === 'png' || selected === 'jpeg') return selected;
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) return 'png';
  return 'jpeg';
}

export function outputFileName(
  originalName: string,
  index: number,
  widthMm: number,
  heightMm: number,
  dpi: number,
  format: EncodedFormat,
): string {
  const base = originalName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').trim() || `image_${index + 1}`;
  const w = compactNumber(widthMm);
  const h = compactNumber(heightMm);
  const ext = format === 'png' ? 'png' : 'jpg';
  return `${String(index + 1).padStart(3, '0')}_${base}_margin_${w}x${h}mm_${dpi}dpi.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function compactNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}
