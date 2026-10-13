import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { installedIds, mergeExtensions, parseIds } from './extensionSet';

describe('mergeExtensions', () => {
  it('first sync with no remote list uploads everything this device has', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], null, undefined), { install: [], notifyRemoved: [], push: ['a', 'b'], nextBase: ['a', 'b'] });
  });

  it('first sync joins two different sets in both directions', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], ['b', 'c'], undefined), {
      install: ['c'],
      notifyRemoved: [],
      push: ['a', 'b', 'c'],
      nextBase: ['a', 'b'],
    });
  });

  it('is stable once everything is installed', () => {
    assert.deepEqual(mergeExtensions(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b']), {
      install: [],
      notifyRemoved: [],
      push: undefined,
      nextBase: ['a', 'b', 'c'],
    });
  });

  it('an extension added elsewhere is to install, one removed elsewhere is only reported', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], ['a', 'c'], ['a', 'b']), {
      install: ['c'],
      notifyRemoved: ['b'],
      push: undefined,
      nextBase: ['a', 'b'],
    });
  });

  it('an extension uninstalled here is removed from the cloud list', () => {
    assert.deepEqual(mergeExtensions(['a'], ['a', 'b'], ['a', 'b']), { install: [], notifyRemoved: [], push: ['a'], nextBase: ['a'] });
  });

  it('both sides adding the same extension is not a change', () => {
    assert.deepEqual(mergeExtensions(['a', 'x'], ['a', 'x'], ['a']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a', 'x'] });
  });

  it('a removal on both sides is a no-op', () => {
    assert.deepEqual(mergeExtensions(['a'], ['a'], ['a', 'b']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a'] });
  });

  it('a device with nothing installed and no remote list creates an empty list', () => {
    assert.equal(mergeExtensions([], null, undefined).push?.length, 0);
    assert.equal(mergeExtensions([], [], undefined).push, undefined);
  });
});

describe('two devices converge', () => {
  interface Dev { installed: Set<string>; base?: string[] }
  const cloud: { ids: string[] | null } = { ids: null };
  function sync(dev: Dev, interactive: boolean) {
    let merge = mergeExtensions([...dev.installed], cloud.ids, dev.base);
    if (interactive) {
      for (const id of merge.install) dev.installed.add(id);
      merge = mergeExtensions([...dev.installed], cloud.ids, dev.base);
    }
    if (merge.push) cloud.ids = merge.push;
    dev.base = merge.nextBase;
    return merge;
  }

  it('adds propagate, removals are reported and never re-uploaded', () => {
    const a: Dev = { installed: new Set(['x', 'y']) };
    const b: Dev = { installed: new Set(['y', 'z']) };
    sync(a, true);
    sync(b, true);
    sync(a, true);
    assert.deepEqual([...a.installed].sort(), ['x', 'y', 'z']);
    assert.deepEqual([...b.installed].sort(), ['x', 'y', 'z']);
    assert.equal(sync(a, true).push, undefined);
    assert.equal(sync(b, true).push, undefined);

    a.installed.delete('y');
    sync(a, true);
    assert.deepEqual(cloud.ids, ['x', 'z']);
    assert.deepEqual(sync(b, false).notifyRemoved, ['y']);
    assert.equal(b.installed.has('y'), true, 'a removal elsewhere never uninstalls here');
    const again = sync(b, false);
    assert.deepEqual(again.notifyRemoved, ['y']);
    assert.equal(again.push, undefined);
    assert.deepEqual(cloud.ids, ['x', 'z']);

    b.installed.delete('y');
    b.base = b.base!.filter((id) => id !== 'y');
    const settled = sync(b, true);
    assert.deepEqual(settled.notifyRemoved, []);
    assert.equal(settled.push, undefined);
  });
});

describe('parseIds', () => {
  it('lowercases, sorts and de-duplicates a list of strings', () => {
    assert.deepEqual(parseIds('["B.two","a.one","A.ONE"]'), ['a.one', 'b.two']);
  });
  it('rejects anything else', () => {
    for (const t of ['', 'nope', '{}', '[1]', '["a",2]']) assert.equal(parseIds(t), undefined, t);
  });
});

describe('installedIds', () => {
  const manifest = JSON.stringify([
    { identifier: { id: 'Ms-Python.Python', uuid: '1' }, version: '1.0.0', metadata: { isBuiltin: false } },
    { identifier: { id: 'null.something' }, metadata: { isBuiltin: true } },
    { identifier: { id: 'machine.only' }, metadata: { isMachineScoped: true } },
    { identifier: { id: 'rust-lang.rust-analyzer' } },
    { nothing: true },
  ]);

  it('lists user extensions (enabled or not), lowercased, without built-ins or machine-scoped ones', () => {
    assert.deepEqual(installedIds(manifest), ['ms-python.python', 'rust-lang.rust-analyzer']);
  });

  it('returns undefined rather than an empty list when the file cannot be read, so nothing is mistaken for "all uninstalled"', () => {
    for (const t of ['', '{ half a fi', '{}', 'null']) assert.equal(installedIds(t), undefined, t);
  });

  it('an empty list is a real answer', () => {
    assert.deepEqual(installedIds('[]'), []);
  });
});
