import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { planAll, planFile } from './syncPlan';
import { Base, Value } from './types';

const base = (local: Value, remote: Value): Base => ({ local, remote });

describe('planFile', () => {
  it('is none when both sides are equal, whatever the base', () => {
    assert.equal(planFile('a', 'a', undefined, false), 'none');
    assert.equal(planFile('a', 'a', base('b', 'c'), false), 'none');
    assert.equal(planFile(null, null, undefined, true), 'none');
  });

  it('first sync: a missing side has nothing to lose', () => {
    assert.equal(planFile(null, 'r', undefined, true), 'pull');
    assert.equal(planFile(null, 'r', undefined, false), 'pull');
    assert.equal(planFile('l', null, undefined, true), 'push');
    assert.equal(planFile('l', null, undefined, false), 'push');
  });

  it('first sync: both present and different is a conflict', () => {
    assert.equal(planFile('l', 'r', undefined, false), 'conflict');
    assert.equal(planFile('l', 'r', undefined, true), 'conflict');
  });

  it('only one side changed: that side wins', () => {
    assert.equal(planFile('l', 'y', base('x', 'y'), false), 'push');
    assert.equal(planFile('x', 'r', base('x', 'y'), false), 'pull');
  });

  it('neither side changed is none even if the two texts differ (settings.json after a pull)', () => {
    assert.equal(planFile('x', 'y', base('x', 'y'), false), 'none');
  });

  it('both changed to different content is a conflict', () => {
    assert.equal(planFile('l', 'r', base('x', 'y'), false), 'conflict');
  });

  it('a deleted snippet propagates in both directions', () => {
    assert.equal(planFile(null, 'y', base('x', 'y'), true), 'push');
    assert.equal(planFile('x', null, base('x', 'y'), true), 'pull');
  });

  it('a snippet deleted on one side and edited on the other is a conflict', () => {
    assert.equal(planFile('l', null, base('x', 'y'), true), 'conflict');
    assert.equal(planFile(null, 'r', base('x', 'y'), true), 'conflict');
  });

  it('a missing settings/keybindings file is never a deletion', () => {
    assert.equal(planFile(null, 'y', base('x', 'y'), false), 'pull');
    assert.equal(planFile(null, 'r', base('x', 'y'), false), 'pull');
    assert.equal(planFile('x', null, base('x', 'y'), false), 'push');
  });
});

describe('planAll', () => {
  it('plans every file independently', () => {
    const plan = planAll({
      'settings.json': { local: 'l', remote: 'y', base: base('x', 'y'), deletable: false },
      'keybindings.json': { local: 'a', remote: 'a', base: undefined, deletable: false },
      'snippets/a.json': { local: 'l', remote: 'r', base: base('x', 'y'), deletable: true },
    });
    assert.deepEqual(plan, { 'settings.json': 'push', 'keybindings.json': 'none', 'snippets/a.json': 'conflict' });
  });
});
