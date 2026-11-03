"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const geometry_1 = require("./geometry");
(0, node_test_1.test)('fitView scales content to the viewport and centres it', () => {
    node_assert_1.strict.deepEqual((0, geometry_1.fitView)({ w: 100, h: 50 }, { w: 200, h: 200 }, 0), { scale: 2, x: 0, y: 50 });
});
(0, node_test_1.test)('zoomAbout keeps the point under the cursor fixed', () => {
    const v = { scale: 1, x: 5, y: 7 };
    const p = { x: 10, y: 10 };
    const before = { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
    const z = (0, geometry_1.zoomAbout)(v, p, 2);
    node_assert_1.strict.equal(z.scale, 2);
    node_assert_1.strict.equal((p.x - z.x) / z.scale, before.x);
    node_assert_1.strict.equal((p.y - z.y) / z.scale, before.y);
});
(0, node_test_1.test)('zoomAbout clamps at the limits', () => {
    node_assert_1.strict.equal((0, geometry_1.zoomAbout)({ scale: 30, x: 0, y: 0 }, { x: 0, y: 0 }, 4, { min: 0.05, max: 32 }).scale, 32);
    node_assert_1.strict.equal((0, geometry_1.zoomAbout)({ scale: 0.06, x: 0, y: 0 }, { x: 0, y: 0 }, 0.1, { min: 0.05, max: 32 }).scale, 0.05);
});
//# sourceMappingURL=geometry.test.js.map