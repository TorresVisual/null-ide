import assert from 'node:assert';
import test from 'node:test';
import { compareVersionTags } from './versionComparison';

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

test('compareVersionTags handles prerelease suffixes correctly', () => {
  assert.ok(compareVersionTags('v1.2.0', 'v1.2.0-beta') > 0);
  assert.ok(compareVersionTags('v1.2.0-beta', 'v1.2.0') < 0);
  assert.strictEqual(compareVersionTags('v1.2.0-beta', 'v1.2.0-beta'), 0);
  assert.ok(compareVersionTags('v1.2.0-alpha', 'v1.2.0-beta') < 0);
});
