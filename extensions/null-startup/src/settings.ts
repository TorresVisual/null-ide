'use strict';

export function normalizeRetention(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(200, Math.max(1, Math.round(v))) : 20;
}

export function normalizeSlowMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 100;
}
