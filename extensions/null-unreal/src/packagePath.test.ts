import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { findMounts, toPackagePath, TreeFs, uassetsIn } from './packagePath';
import { ResolveError } from './uproject';

const P = 'C:\\Games\\MyGame';

// A tree given as { folder: [entries] }; an entry ending in "/" is a folder.
function tree(t: Record<string, string[]>): TreeFs {
  return {
    list: (dir) => (t[dir] ?? []).map((e) => ({ name: e.replace(/\/$/, ''), isDirectory: e.endsWith('/') })),
    exists: (p) => p in t,
  };
}

const fs = tree({
  [`${P}\\Plugins`]: ['Fx/', 'Tools/'],
  [`${P}\\Plugins\\Fx`]: ['Fx.uplugin', 'Content/'],
  [`${P}\\Plugins\\Fx\\Content`]: [],
  [`${P}\\Plugins\\Tools`]: ['Tools.uplugin'],   // a code-only plugin has no Content
});

test('the project and each plugin with a Content folder are mounted', () => {
  assert.deepEqual(findMounts(P, fs), [
    { name: '/Game', root: `${P}\\Content` },
    { name: '/Fx', root: `${P}\\Plugins\\Fx\\Content` },
  ]);
});

test('a file maps to its package path under the project and under a plugin', () => {
  const m = findMounts(P, fs);
  assert.equal(toPackagePath(`${P}\\Content\\Materials\\M_Example.uasset`, m), '/Game/Materials/M_Example');
  assert.equal(toPackagePath(`${P}\\Plugins\\Fx\\Content\\NS_Spark.uasset`, m), '/Fx/NS_Spark');
});

test('matching ignores drive-letter and folder case, as Windows does', () => {
  assert.equal(toPackagePath('c:\\games\\mygame\\content\\A.uasset', findMounts(P, fs)), '/Game/A');
});

test('a .uasset outside every mounted root, or another file type, is an explicit error', () => {
  const m = findMounts(P, fs);
  assert.throws(() => toPackagePath('C:\\Other\\Content\\A.uasset', m), ResolveError);
  assert.throws(() => toPackagePath(`${P}\\Content\\Level.umap`, m), ResolveError);
  assert.throws(() => toPackagePath(`${P}\\ContentExtra\\A.uasset`, m), ResolveError);
});

test('a folder expands to its .uasset files, sorted, skipping other files', () => {
  const t = tree({
    [`${P}\\Content`]: ['B.uasset', 'Sub/', 'Level.umap', 'A.UASSET'],
    [`${P}\\Content\\Sub`]: ['C.uasset'],
  });
  assert.deepEqual(uassetsIn(`${P}\\Content`, t), [`${P}\\Content\\A.UASSET`, `${P}\\Content\\B.uasset`, `${P}\\Content\\Sub\\C.uasset`]);
});
