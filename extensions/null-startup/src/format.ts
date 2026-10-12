'use strict';

export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD HH:mm`. */
export function stamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
