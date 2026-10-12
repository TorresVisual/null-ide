'use strict';

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}

function formatDelta(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  if (ms === 0) return '0 ms';
  return (ms > 0 ? '+' : '−') + formatMs(Math.abs(ms));
}

/** Position of `ms` on a `spanMs` wide axis, clamped to 0..100. */
function pct(ms: number, spanMs: number): number {
  return spanMs > 0 ? Math.min(100, Math.max(0, (ms / spanMs) * 100)) : 0;
}

/** Stable copy sorted by `key`; rows without a value go last in either direction. */
function sortBy<T>(rows: T[], key: (row: T) => number | string | undefined, dir: 1 | -1): T[] {
  return rows.slice().sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x < y ? -dir : x > y ? dir : 0;
  });
}
