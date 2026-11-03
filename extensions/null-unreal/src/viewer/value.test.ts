import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describe } from './value';

test('describe shows unreadable values as not available, with the reason', () => {
  assert.equal(describe({ unreadable: 'no mip count' }), 'not available: no mip count');
});

test('describe shows missing values as a dash and numbers as text', () => {
  assert.equal(describe(undefined), '—');
  assert.equal(describe(null), '—');
  assert.equal(describe(1024), '1024');
});

test('describe counts arrays', () => {
  assert.equal(describe([1, 2, 3]), '3 items');
});
