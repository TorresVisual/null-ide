"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const featureRegistry_1 = require("./featureRegistry");
const entry = (over = {}) => ({
    id: 'a', label: 'A', command: 'x.a', category: 'develop', ...over,
});
const manifest = (extensionId, features) => ({
    extensionId,
    packageJSON: { nullWorkspace: { features } },
});
const shape = (cats) => cats.map(c => [c.id, c.features.map(f => f.label)]);
(0, node_test_1.default)('groups in the fixed category order whatever the input order', () => {
    const result = (0, featureRegistry_1.collectFeatures)([
        manifest('null.one', [
            entry({ id: 'e', label: 'Env', category: 'setup' }),
            entry({ id: 'a', label: 'Acc', category: 'account' }),
            entry({ id: 'd', label: 'Dash', category: 'develop' }),
            entry({ id: 'i', label: 'Act', category: 'insights' }),
        ]),
    ]);
    node_assert_1.default.deepStrictEqual(shape(result), [
        ['develop', ['Dash']], ['insights', ['Act']], ['account', ['Acc']], ['setup', ['Env']],
    ]);
    node_assert_1.default.strictEqual(result[2].title, 'Account & Sync');
});
(0, node_test_1.default)('sorts by order, then label, and applies defaults', () => {
    const [cat] = (0, featureRegistry_1.collectFeatures)([
        manifest('null.one', [
            entry({ id: 'z', label: 'Zed', order: 5 }),
            entry({ id: 'b', label: 'Bee' }),
            entry({ id: 'a', label: 'Ant' }),
        ]),
    ]);
    node_assert_1.default.deepStrictEqual(cat.features.map(f => f.label), ['Zed', 'Ant', 'Bee']);
    node_assert_1.default.strictEqual(cat.features[1].order, 100);
    node_assert_1.default.strictEqual(cat.features[1].icon, 'symbol-misc');
});
(0, node_test_1.default)('appends unknown categories alphabetically with a capitalized title', () => {
    const result = (0, featureRegistry_1.collectFeatures)([
        manifest('null.one', [
            entry({ id: 'p', category: 'zeta' }),
            entry({ id: 'q', category: 'alpha' }),
            entry({ id: 'r', category: 'setup' }),
        ]),
    ]);
    node_assert_1.default.deepStrictEqual(result.map(c => c.id), ['setup', 'alpha', 'zeta']);
    node_assert_1.default.strictEqual(result[1].title, 'Alpha');
});
(0, node_test_1.default)('ignores extensions that are not publisher null, accepts Null. in any case', () => {
    const result = (0, featureRegistry_1.collectFeatures)([
        manifest('evil.ext', [entry({ id: 'x', label: 'Evil' })]),
        manifest('Null.Mixed', [entry({ id: 'm', label: 'Mixed' })]),
    ]);
    node_assert_1.default.deepStrictEqual(shape(result), [['develop', ['Mixed']]]);
});
(0, node_test_1.default)('malformed blocks never throw and do not hide other extensions', () => {
    const warnings = [];
    const result = (0, featureRegistry_1.collectFeatures)([
        { extensionId: 'null.a', packageJSON: null },
        { extensionId: 'null.b', packageJSON: 'text' },
        { extensionId: 'null.c', packageJSON: {} },
        { extensionId: 'null.d', packageJSON: { nullWorkspace: null } },
        { extensionId: 'null.e', packageJSON: { nullWorkspace: { features: 'nope' } } },
        manifest('null.good', [entry({ label: 'Good' })]),
    ], m => warnings.push(m));
    node_assert_1.default.deepStrictEqual(shape(result), [['develop', ['Good']]]);
    node_assert_1.default.strictEqual(warnings.length, 2); // null.d and null.e; missing blocks are silent
});
(0, node_test_1.default)('drops malformed entries and keeps the valid ones around them', () => {
    const warnings = [];
    const result = (0, featureRegistry_1.collectFeatures)([manifest('null.one', [
            entry({ id: 'ok1', label: 'One' }),
            entry({ id: 'bad1', label: 42 }),
            entry({ id: 'bad2', command: '' }),
            entry({ id: undefined }),
            'not an object',
            entry({ id: 'ok2', label: 'Two', order: 'x' }),
        ])], m => warnings.push(m));
    node_assert_1.default.deepStrictEqual(shape(result), [['develop', ['One', 'Two']]]);
    node_assert_1.default.strictEqual(warnings.length, 4);
});
(0, node_test_1.default)('same id in two extensions both show; same id twice in one keeps the first', () => {
    const result = (0, featureRegistry_1.collectFeatures)([
        manifest('null.one', [entry({ label: 'First' }), entry({ label: 'Second' })]),
        manifest('null.two', [entry({ label: 'Other' })]),
    ]);
    node_assert_1.default.deepStrictEqual(shape(result), [['develop', ['First', 'Other']]]);
    node_assert_1.default.deepStrictEqual(result[0].features.map(f => f.key), ['null.one/a', 'null.two/a']);
});
//# sourceMappingURL=featureRegistry.test.js.map