import assert from 'node:assert';
import test from 'node:test';
import { collectFeatures, FeatureCategory, ManifestInput } from './featureRegistry';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'a', label: 'A', command: 'x.a', category: 'develop', ...over,
});
const manifest = (extensionId: string, features: unknown): ManifestInput => ({
  extensionId,
  packageJSON: { nullWorkspace: { features } },
});
const shape = (cats: FeatureCategory[]) =>
  cats.map(c => [c.id, c.features.map(f => f.label)]);

test('groups in the fixed category order whatever the input order', () => {
  const result = collectFeatures([
    manifest('null.one', [
      entry({ id: 'e', label: 'Env', category: 'setup' }),
      entry({ id: 'a', label: 'Acc', category: 'account' }),
      entry({ id: 'd', label: 'Dash', category: 'develop' }),
      entry({ id: 'i', label: 'Act', category: 'insights' }),
    ]),
  ]);
  assert.deepStrictEqual(shape(result), [
    ['develop', ['Dash']], ['insights', ['Act']], ['account', ['Acc']], ['setup', ['Env']],
  ]);
  assert.strictEqual(result[2].title, 'Account & Sync');
});

test('sorts by order, then label, and applies defaults', () => {
  const [cat] = collectFeatures([
    manifest('null.one', [
      entry({ id: 'z', label: 'Zed', order: 5 }),
      entry({ id: 'b', label: 'Bee' }),
      entry({ id: 'a', label: 'Ant' }),
    ]),
  ]);
  assert.deepStrictEqual(cat.features.map(f => f.label), ['Zed', 'Ant', 'Bee']);
  assert.strictEqual(cat.features[1].order, 100);
  assert.strictEqual(cat.features[1].icon, 'symbol-misc');
});

test('appends unknown categories alphabetically with a capitalized title', () => {
  const result = collectFeatures([
    manifest('null.one', [
      entry({ id: 'p', category: 'zeta' }),
      entry({ id: 'q', category: 'alpha' }),
      entry({ id: 'r', category: 'setup' }),
    ]),
  ]);
  assert.deepStrictEqual(result.map(c => c.id), ['setup', 'alpha', 'zeta']);
  assert.strictEqual(result[1].title, 'Alpha');
});

test('ignores extensions that are not publisher null, accepts Null. in any case', () => {
  const result = collectFeatures([
    manifest('evil.ext', [entry({ id: 'x', label: 'Evil' })]),
    manifest('Null.Mixed', [entry({ id: 'm', label: 'Mixed' })]),
  ]);
  assert.deepStrictEqual(shape(result), [['develop', ['Mixed']]]);
});

test('malformed blocks never throw and do not hide other extensions', () => {
  const warnings: string[] = [];
  const result = collectFeatures(
    [
      { extensionId: 'null.a', packageJSON: null },
      { extensionId: 'null.b', packageJSON: 'text' },
      { extensionId: 'null.c', packageJSON: {} },
      { extensionId: 'null.d', packageJSON: { nullWorkspace: null } },
      { extensionId: 'null.e', packageJSON: { nullWorkspace: { features: 'nope' } } },
      manifest('null.good', [entry({ label: 'Good' })]),
    ],
    m => warnings.push(m),
  );
  assert.deepStrictEqual(shape(result), [['develop', ['Good']]]);
  assert.strictEqual(warnings.length, 2); // null.d and null.e; missing blocks are silent
});

test('drops malformed entries and keeps the valid ones around them', () => {
  const warnings: string[] = [];
  const result = collectFeatures(
    [manifest('null.one', [
      entry({ id: 'ok1', label: 'One' }),
      entry({ id: 'bad1', label: 42 }),
      entry({ id: 'bad2', command: '' }),
      entry({ id: undefined }),
      'not an object',
      entry({ id: 'ok2', label: 'Two', order: 'x' }),
    ])],
    m => warnings.push(m),
  );
  assert.deepStrictEqual(shape(result), [['develop', ['One', 'Two']]]);
  assert.strictEqual(warnings.length, 4);
});

test('same id in two extensions both show; same id twice in one keeps the first', () => {
  const result = collectFeatures([
    manifest('null.one', [entry({ label: 'First' }), entry({ label: 'Second' })]),
    manifest('null.two', [entry({ label: 'Other' })]),
  ]);
  assert.deepStrictEqual(shape(result), [['develop', ['First', 'Other']]]);
  assert.deepStrictEqual(result[0].features.map(f => f.key), ['null.one/a', 'null.two/a']);
});
