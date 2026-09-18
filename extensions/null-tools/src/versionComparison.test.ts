import assert from 'node:assert';
import test from 'node:test';

function trimVersionTag(tag: string | undefined | null): string {
  return String(tag || '').replace(/^v/i, '');
}

function compareVersionTags(left: string, right: string): number {
  if (left === right) return 0;
  if (right === 'local') return 1;
  if (left === 'local') return -1;

  const leftParts  = trimVersionTag(left).split(/[.-]/).map(p => Number.parseInt(p, 10));
  const rightParts = trimVersionTag(right).split(/[.-]/).map(p => Number.parseInt(p, 10));

  if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) {
    return String(left) === String(right) ? 0 : -1;
  }

  const count = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < count; i++) {
    const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

test('compareVersionTags handles local vs version tags correctly', () => {
  assert.strictEqual(compareVersionTags('v1.2.3', 'local'), 1);
  assert.strictEqual(compareVersionTags('local', 'v1.2.3'), -1);
  assert.strictEqual(compareVersionTags('local', 'local'), 0);
});

test('compareVersionTags compares semantic versions correctly', () => {
  assert.ok(compareVersionTags('v1.2.4', 'v1.2.3') > 0);
  assert.strictEqual(compareVersionTags('1.2.3', 'v1.2.3'), 0);
  assert.ok(compareVersionTags('1.2.0', '1.2.3') < 0);
  assert.ok(compareVersionTags('v2.0.0', 'v1.9.9') > 0);
});
