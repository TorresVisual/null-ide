"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const instance_1 = require("./instance");
const material = {
    kind: 'material',
    data: {
        parameters: [
            { name: 'Roughness', type: 'scalar', default: 0.5 },
            { name: 'Tint', type: 'vector', default: { r: 0, g: 0, b: 1 } },
        ],
    },
};
const instance = (overrides) => ({
    kind: 'material-instance',
    data: { overrides: { scalar: {}, vector: {}, texture: {}, ...overrides } },
});
(0, node_test_1.test)('resolveParams marks own overrides and inherits the rest from the root material', () => {
    const own = instance({ scalar: { Roughness: 0.8 } });
    const r = (0, instance_1.resolveParams)(own, [material]);
    node_assert_1.strict.equal(r.complete, true);
    node_assert_1.strict.deepEqual(r.rows, [
        { name: 'Roughness', type: 'scalar', value: 0.8, source: 'override' },
        { name: 'Tint', type: 'vector', value: { r: 0, g: 0, b: 1 }, source: 'inherited' },
    ]);
});
(0, node_test_1.test)('resolveParams takes an inherited value from the nearest ancestor that overrides it', () => {
    const own = instance({});
    const parent = instance({ vector: { Tint: { r: 1, g: 0, b: 0 } } });
    const r = (0, instance_1.resolveParams)(own, [parent, material]);
    node_assert_1.strict.equal(r.complete, true);
    node_assert_1.strict.deepEqual(r.rows, [
        { name: 'Tint', type: 'vector', value: { r: 1, g: 0, b: 0 }, source: 'inherited' },
        { name: 'Roughness', type: 'scalar', value: 0.5, source: 'inherited' },
    ]);
});
(0, node_test_1.test)('resolveParams with a chain that ends at an uncached parent returns only the overrides', () => {
    const own = instance({ scalar: { Roughness: 0.8 } });
    const parent = instance({ vector: { Tint: { r: 1, g: 0, b: 0 } } });
    const r = (0, instance_1.resolveParams)(own, [parent]);
    node_assert_1.strict.equal(r.complete, false);
    node_assert_1.strict.deepEqual(r.rows, [{ name: 'Roughness', type: 'scalar', value: 0.8, source: 'override' }]);
});
//# sourceMappingURL=instance.test.js.map