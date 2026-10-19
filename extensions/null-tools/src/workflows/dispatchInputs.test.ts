'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseDispatch, validateInput } from './dispatchInputs';

test('on: as a string, a list and a map', () => {
  assert.deepStrictEqual(parseDispatch('on: workflow_dispatch\njobs: {}'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on: [push, workflow_dispatch]'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on:\n  push:\n  workflow_dispatch:\n'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on:\n  push:\n    branches: [main]\n'), { dispatchable: false, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on: push'), { dispatchable: false, inputs: [] });
});

test('the on key may parse as boolean true (YAML 1.1 readers)', () => {
  assert.strictEqual(parseDispatch('true:\n  workflow_dispatch:\n').dispatchable, true);
});

test('each input type, with defaults, options and required', () => {
  const out = parseDispatch(`
on:
  workflow_dispatch:
    inputs:
      who:
        description: Who to greet
        required: true
        default: world
      flavor:
        type: choice
        options: [vanilla, chocolate]
        default: vanilla
      loud:
        type: boolean
        default: true
      count:
        type: number
        default: 3
      env:
        type: environment
`);
  assert.strictEqual(out.dispatchable, true);
  assert.deepStrictEqual(out.inputs, [
    { name: 'who', description: 'Who to greet', required: true, default: 'world', type: 'string', options: [] },
    { name: 'flavor', description: '', required: false, default: 'vanilla', type: 'choice', options: ['vanilla', 'chocolate'] },
    { name: 'loud', description: '', required: false, default: 'true', type: 'boolean', options: [] },
    { name: 'count', description: '', required: false, default: '3', type: 'number', options: [] },
    { name: 'env', description: '', required: false, default: null, type: 'environment', options: [] },
  ]);
});

test('anchors and aliases resolve', () => {
  const out = parseDispatch(`
x-in: &in
  description: shared
  required: true
on:
  workflow_dispatch:
    inputs:
      a: *in
      b:
        <<: *in
        description: own
`);
  assert.deepStrictEqual(out.inputs.map(i => [i.name, i.description, i.required]), [['a', 'shared', true], ['b', 'own', true]]);
});

test('garbage never throws and means not dispatchable', () => {
  for (const text of ['', '   ', ':::', '- a\n- b', '[unclosed', 'on: [', 'null', '42', '\u0000\u0001', 'a: &x [*x]', 'on: {'.repeat(50)]) {
    assert.deepStrictEqual(parseDispatch(text), { dispatchable: false, inputs: [] }, JSON.stringify(text));
  }
  assert.deepStrictEqual(parseDispatch('x'.repeat(2_000_000)), { dispatchable: false, inputs: [] }, 'oversized files are not parsed');
});

test('odd input entries are skipped or defaulted, not fatal', () => {
  const out = parseDispatch(`
on:
  workflow_dispatch:
    inputs:
      ok: {}
      notamap: 5
      nul:
      weird:
        type: banana
        options: not-a-list
        required: maybe
      choice-no-options:
        type: choice
`);
  assert.deepStrictEqual(out.inputs.map(i => [i.name, i.type, i.options.length, i.required]), [
    ['ok', 'string', 0, false], ['nul', 'string', 0, false], ['weird', 'string', 0, false], ['choice-no-options', 'choice', 0, false],
  ]);
});

test('validateInput: required, numbers, choices, booleans', () => {
  const base = { name: 'x', description: '', required: false, default: null, options: [] as string[] };
  assert.match(validateInput({ ...base, required: true, type: 'string' }, '  ')!, /required/i);
  assert.strictEqual(validateInput({ ...base, type: 'string' }, ''), undefined);
  assert.match(validateInput({ ...base, type: 'number' }, 'abc')!, /number/i);
  assert.strictEqual(validateInput({ ...base, type: 'number' }, '4.5'), undefined);
  assert.strictEqual(validateInput({ ...base, type: 'number' }, ''), undefined);
  assert.match(validateInput({ ...base, type: 'choice', options: ['a', 'b'] }, 'c')!, /one of/i);
  assert.strictEqual(validateInput({ ...base, type: 'choice', options: ['a', 'b'] }, 'a'), undefined);
});
