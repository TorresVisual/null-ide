import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { boneTree } from './tree';

test('boneTree nests children under their parent', () => {
  const t = boneTree([
    { name: 'root', parent: null },
    { name: 'pelvis', parent: 'root' },
    { name: 'spine', parent: 'pelvis' },
  ]);
  assert.deepEqual(t, [{ name: 'root', children: [{ name: 'pelvis', children: [{ name: 'spine', children: [] }] }] }]);
});

test('boneTree makes a bone with a parent missing from the list a root', () => {
  const t = boneTree([
    { name: 'root', parent: null },
    { name: 'orphan', parent: 'missing' },
  ]);
  assert.deepEqual(
    t.map((n) => n.name),
    ['root', 'orphan'],
  );
});

test('boneTree with every parent unreadable is a flat list', () => {
  const t = boneTree([
    { name: 'a', parent: { unreadable: 'x' } },
    { name: 'b', parent: { unreadable: 'y' } },
  ]);
  assert.deepEqual(
    t.map((n) => [n.name, n.children.length]),
    [
      ['a', 0],
      ['b', 0],
    ],
  );
});

test('boneTree terminates on a cycle and shows every bone once', () => {
  const t = boneTree([
    { name: 'a', parent: 'b' },
    { name: 'b', parent: 'a' },
  ]);
  assert.deepEqual(t, [{ name: 'a', children: [{ name: 'b', children: [] }] }]);
});
