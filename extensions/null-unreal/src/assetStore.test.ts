import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AssetState, AssetStore, StoreBackend } from './assetStore';
import { ExportDoc } from './exportFormat';

const doc = (file: string) => ({ package: `/Game/${file}`, kind: 'texture' } as unknown as ExportDoc);

// A backend whose cache fills when a run finishes. `gate` holds a run open until released.
function backend(o: { fail?: Record<string, string>; gate?: Promise<void> } = {}) {
  const cache = new Map<string, ExportDoc>();
  const runs: { files: string[]; force: boolean }[] = [];
  const b: StoreBackend = {
    peek: (f) => cache.get(f),
    run: async (files, force) => {
      runs.push({ files, force });
      await o.gate;
      const errors = new Map<string, string>();
      for (const f of files) {
        if (o.fail?.[f]) errors.set(f, o.fail[f]);
        else cache.set(f, doc(f));
      }
      return errors;
    },
  };
  return { b, cache, runs };
}

test('a cache hit never reaches the engine', async () => {
  const { b, cache, runs } = backend();
  cache.set('a', doc('a'));
  const store = new AssetStore(b);
  assert.equal(store.peek('a')?.package, '/Game/a');
  assert.equal((await store.get('a')).package, '/Game/a');
  assert.equal(runs.length, 0);
});

test('requests made in the same tick go out as one run', async () => {
  const { b, runs } = backend();
  const store = new AssetStore(b);
  const r = await Promise.all([store.get('a'), store.get('b'), store.getMany(['c', 'd'])]);
  assert.equal(r.length, 3);
  assert.deepEqual(runs.map((x) => x.files), [['a', 'b', 'c', 'd']]);
});

test('a request for a file already exporting joins that run; new files queue into one next run', async () => {
  let release!: () => void;
  const { b, runs } = backend({ gate: new Promise((r) => (release = r)) });
  const store = new AssetStore(b);
  const first = store.get('a');
  await new Promise((r) => setTimeout(r, 0));   // the first run is now open
  const joined = store.get('a');
  const second = [store.get('b'), store.get('c')];
  release();
  await Promise.all([first, joined, ...second]);
  assert.deepEqual(runs.map((x) => x.files), [['a'], ['b', 'c']]);
});

test('state events go queued, exporting, ready per file', async () => {
  const { b } = backend();
  const store = new AssetStore(b);
  const seen: string[] = [];
  store.onState((f, s) => seen.push(`${f}:${s.state}`));
  await store.get('a');
  assert.deepEqual(seen, ['a:queued', 'a:exporting', 'a:ready']);
});

test('a failed asset rejects get with the CLI error and emits failed; the others still succeed', async () => {
  const { b } = backend({ fail: { bad: 'KeyError: x' } });
  const store = new AssetStore(b);
  const states: AssetState[] = [];
  store.onState((f, s) => f === 'bad' && states.push(s));
  const [ok, bad] = await store.getMany(['good', 'bad']);
  assert.ok('doc' in ok);
  assert.deepEqual(bad, { file: 'bad', error: 'KeyError: x' });
  assert.deepEqual(states.at(-1), { state: 'failed', error: 'KeyError: x' });
  await assert.rejects(store.get('bad'), /KeyError: x/);
});

test('a backend that throws fails every file in the run with its message', async () => {
  const store = new AssetStore({ peek: () => undefined, run: async () => { throw new Error('spawn failed'); } });
  await assert.rejects(store.get('a'), /spawn failed/);
});

test('force bypasses the cache and runs separately from ordinary requests', async () => {
  const { b, cache, runs } = backend();
  cache.set('a', doc('a'));
  const store = new AssetStore(b);
  await Promise.all([store.get('a', { force: true }), store.get('b')]);
  assert.deepEqual(runs, [{ files: ['b'], force: false }, { files: ['a'], force: true }]);
});
