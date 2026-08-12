export const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi: number): number {
  if (!Number.isFinite(mm) || mm <= 0) {
    throw new RangeError('mm は 0 より大きい有限値で指定してください。');
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('DPI は 0 より大きい有限値で指定してください。');
  }
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export function pxToMm(px: number, dpi: number): number {
  if (!Number.isFinite(px) || px < 0) {
    throw new RangeError('px は 0 以上の有限値で指定してください。');
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('DPI は 0 より大きい有限値で指定してください。');
  }
  return (px / dpi) * MM_PER_INCH;
}

export function formatMm(value: number): string {
  return value.toFixed(value >= 100 ? 1 : 2).replace(/\.0+$/, '');
}
