'use strict';

export function trimVersionTag(tag: string | undefined | null): string {
  return String(tag || '').replace(/^v/i, '');
}

interface ParsedVersion {
  numeric: number[];
  suffix: string;
}

function parseVersion(tag: string): ParsedVersion {
  const trimmed = trimVersionTag(tag);
  const [numericPart, ...suffixParts] = trimmed.split('-');
  const numeric = numericPart.split('.').map(p => Number.parseInt(p, 10));
  return { numeric, suffix: suffixParts.join('-') };
}

export function compareVersionTags(left: string, right: string): number {
  if (left === right) return 0;
  if (right === 'local') return 1;
  if (left === 'local') return -1;

  const l = parseVersion(left);
  const r = parseVersion(right);

  if (l.numeric.some(Number.isNaN) || r.numeric.some(Number.isNaN)) {
    return String(left) === String(right) ? 0 : -1;
  }

  const count = Math.max(l.numeric.length, r.numeric.length);
  for (let i = 0; i < count; i++) {
    const diff = (l.numeric[i] || 0) - (r.numeric[i] || 0);
    if (diff !== 0) return diff;
  }

  // Same numeric version: a bare release outranks any prerelease suffix
  // (semver precedence: 1.2.0 > 1.2.0-beta). Two different prerelease
  // suffixes on the same numeric version compare lexicographically rather
  // than silently reporting "no update", which is what the old fallback did.
  if (!l.suffix && r.suffix) return 1;
  if (l.suffix && !r.suffix) return -1;
  if (l.suffix === r.suffix) return 0;
  return l.suffix < r.suffix ? -1 : 1;
}
