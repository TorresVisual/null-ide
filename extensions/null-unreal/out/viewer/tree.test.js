"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const tree_1 = require("./tree");
(0, node_test_1.test)('boneTree nests children under their parent', () => {
    const t = (0, tree_1.boneTree)([
        { name: 'root', parent: null },
        { name: 'pelvis', parent: 'root' },
        { name: 'spine', parent: 'pelvis' },
    ]);
    node_assert_1.strict.deepEqual(t, [{ name: 'root', children: [{ name: 'pelvis', children: [{ name: 'spine', children: [] }] }] }]);
});
(0, node_test_1.test)('boneTree makes a bone with a parent missing from the list a root', () => {
    const t = (0, tree_1.boneTree)([
        { name: 'root', parent: null },
        { name: 'orphan', parent: 'missing' },
    ]);
    node_assert_1.strict.deepEqual(t.map((n) => n.name), ['root', 'orphan']);
});
(0, node_test_1.test)('boneTree with every parent unreadable is a flat list', () => {
    const t = (0, tree_1.boneTree)([
        { name: 'a', parent: { unreadable: 'x' } },
        { name: 'b', parent: { unreadable: 'y' } },
    ]);
    node_assert_1.strict.deepEqual(t.map((n) => [n.name, n.children.length]), [
        ['a', 0],
        ['b', 0],
    ]);
});
(0, node_test_1.test)('boneTree terminates on a cycle and shows every bone once', () => {
    const t = (0, tree_1.boneTree)([
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
    ]);
    node_assert_1.strict.deepEqual(t, [{ name: 'a', children: [{ name: 'b', children: [] }] }]);
});
//# sourceMappingURL=tree.test.js.map