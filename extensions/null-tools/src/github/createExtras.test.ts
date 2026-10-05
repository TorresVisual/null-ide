'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { runCreateExtras } from './createExtras';

test('runCreateExtras reports a failing step by name and still runs the rest', async () => {
  const ran: string[] = [];
  const problems = await runCreateExtras([
    { what: 'set the type', run: async () => { throw new Error('forbidden'); } },
    { what: 'link it to #3', run: async () => { ran.push('parent'); } },
  ]);
  assert.deepStrictEqual(problems, ["couldn't set the type (forbidden)"]);
  assert.deepStrictEqual(ran, ['parent']);
});

test('runCreateExtras reports every failure, in order', async () => {
  const problems = await runCreateExtras([
    { what: 'set the type', run: async () => { throw new Error('a'); } },
    { what: 'link it to #3', run: async () => { throw new Error('b'); } },
  ]);
  assert.deepStrictEqual(problems, ["couldn't set the type (a)", "couldn't link it to #3 (b)"]);
});

test('runCreateExtras returns nothing when every step works, and for no steps', async () => {
  assert.deepStrictEqual(await runCreateExtras([{ what: 'x', run: async () => undefined }]), []);
  assert.deepStrictEqual(await runCreateExtras([]), []);
});
