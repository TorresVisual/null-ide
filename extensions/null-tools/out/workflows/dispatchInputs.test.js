'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const dispatchInputs_1 = require("./dispatchInputs");
(0, node_test_1.default)('on: as a string, a list and a map', () => {
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('on: workflow_dispatch\njobs: {}'), { dispatchable: true, inputs: [] });
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('on: [push, workflow_dispatch]'), { dispatchable: true, inputs: [] });
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('on:\n  push:\n  workflow_dispatch:\n'), { dispatchable: true, inputs: [] });
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('on:\n  push:\n    branches: [main]\n'), { dispatchable: false, inputs: [] });
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('on: push'), { dispatchable: false, inputs: [] });
});
(0, node_test_1.default)('the on key may parse as boolean true (YAML 1.1 readers)', () => {
    node_assert_1.default.strictEqual((0, dispatchInputs_1.parseDispatch)('true:\n  workflow_dispatch:\n').dispatchable, true);
});
(0, node_test_1.default)('each input type, with defaults, options and required', () => {
    const out = (0, dispatchInputs_1.parseDispatch)(`
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
    node_assert_1.default.strictEqual(out.dispatchable, true);
    node_assert_1.default.deepStrictEqual(out.inputs, [
        { name: 'who', description: 'Who to greet', required: true, default: 'world', type: 'string', options: [] },
        { name: 'flavor', description: '', required: false, default: 'vanilla', type: 'choice', options: ['vanilla', 'chocolate'] },
        { name: 'loud', description: '', required: false, default: 'true', type: 'boolean', options: [] },
        { name: 'count', description: '', required: false, default: '3', type: 'number', options: [] },
        { name: 'env', description: '', required: false, default: null, type: 'environment', options: [] },
    ]);
});
(0, node_test_1.default)('anchors and aliases resolve', () => {
    const out = (0, dispatchInputs_1.parseDispatch)(`
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
    node_assert_1.default.deepStrictEqual(out.inputs.map(i => [i.name, i.description, i.required]), [['a', 'shared', true], ['b', 'own', true]]);
});
(0, node_test_1.default)('garbage never throws and means not dispatchable', () => {
    for (const text of ['', '   ', ':::', '- a\n- b', '[unclosed', 'on: [', 'null', '42', '\u0000\u0001', 'a: &x [*x]', 'on: {'.repeat(50)]) {
        node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)(text), { dispatchable: false, inputs: [] }, JSON.stringify(text));
    }
    node_assert_1.default.deepStrictEqual((0, dispatchInputs_1.parseDispatch)('x'.repeat(2_000_000)), { dispatchable: false, inputs: [] }, 'oversized files are not parsed');
});
(0, node_test_1.default)('odd input entries are skipped or defaulted, not fatal', () => {
    const out = (0, dispatchInputs_1.parseDispatch)(`
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
    node_assert_1.default.deepStrictEqual(out.inputs.map(i => [i.name, i.type, i.options.length, i.required]), [
        ['ok', 'string', 0, false], ['nul', 'string', 0, false], ['weird', 'string', 0, false], ['choice-no-options', 'choice', 0, false],
    ]);
});
(0, node_test_1.default)('validateInput: required, numbers, choices, booleans', () => {
    const base = { name: 'x', description: '', required: false, default: null, options: [] };
    node_assert_1.default.match((0, dispatchInputs_1.validateInput)({ ...base, required: true, type: 'string' }, '  '), /required/i);
    node_assert_1.default.strictEqual((0, dispatchInputs_1.validateInput)({ ...base, type: 'string' }, ''), undefined);
    node_assert_1.default.match((0, dispatchInputs_1.validateInput)({ ...base, type: 'number' }, 'abc'), /number/i);
    node_assert_1.default.strictEqual((0, dispatchInputs_1.validateInput)({ ...base, type: 'number' }, '4.5'), undefined);
    node_assert_1.default.strictEqual((0, dispatchInputs_1.validateInput)({ ...base, type: 'number' }, ''), undefined);
    node_assert_1.default.match((0, dispatchInputs_1.validateInput)({ ...base, type: 'choice', options: ['a', 'b'] }, 'c'), /one of/i);
    node_assert_1.default.strictEqual((0, dispatchInputs_1.validateInput)({ ...base, type: 'choice', options: ['a', 'b'] }, 'a'), undefined);
});
//# sourceMappingURL=dispatchInputs.test.js.map