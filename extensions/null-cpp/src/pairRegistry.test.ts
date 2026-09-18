import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PairRegistry } from './pairRegistry';

test('record makes the pair discoverable from either uri', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  assert.equal(registry.getCounterpart('a.hpp'), 'a.cpp');
  assert.equal(registry.getCounterpart('a.cpp'), 'a.hpp');
});

test('has returns false for an untracked uri', () => {
  const registry = new PairRegistry();
  assert.equal(registry.has('a.hpp'), false);
});

test('has returns true once a uri is recorded', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  assert.equal(registry.has('a.hpp'), true);
  assert.equal(registry.has('a.cpp'), true);
});

test('getCounterpart returns undefined for an untracked uri', () => {
  const registry = new PairRegistry();
  assert.equal(registry.getCounterpart('a.hpp'), undefined);
});

test('remove drops the pair in both directions', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  registry.remove('a.hpp');
  assert.equal(registry.has('a.hpp'), false);
  assert.equal(registry.has('a.cpp'), false);
});
