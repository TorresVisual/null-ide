import { after, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { FakeGist } from './fakeGist';
import { Device, cleanup } from './testDevice';

after(cleanup);

const PASS = 'correct horse battery staple';

async function two() {
  const gist = new FakeGist();
  const a = new Device(gist);
  const b = new Device(gist);
  a.write('settings.json', '{\n  "editor.fontSize": 14\n}\n');
  assert.equal((await a.enable(PASS)).ok, true);
  assert.equal((await b.enable(PASS, 'cloud')).ok, true);
  return { gist, a, b, id: gist.ids()[0] };
}

describe('syncActivity', () => {
  it('does nothing while the activity category is off (the default)', async () => {
    const { a, gist, id } = await two();
    let called = false;
    assert.equal(await a.engine.syncActivity(async () => { called = true; return {}; }), false);
    assert.equal(called, false);
    assert.equal(Object.keys(gist.files(id)).some((n) => n.startsWith('activity__')), false);
  });

  it('does nothing while sync itself is off or the lock is held', async () => {
    const { a } = await two();
    a.categories.activity = true;
    a.enabled = false;
    assert.equal(await a.engine.syncActivity(async () => ({})), false);
    a.enabled = true;
    a.locked = true;
    assert.equal(await a.engine.syncActivity(async () => ({})), false);
  });

  it('uploads encrypted blobs that the other device can read, and deletes them', async () => {
    const { a, b, gist, id } = await two();
    a.categories.activity = true;
    b.categories.activity = true;
    assert.equal(await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': 'hello' })), true);
    const stored = gist.files(id)['activity__aaaaaaaaaa__2026-10.enc'];
    assert.ok(stored && !stored.includes('hello'), 'the Gist holds ciphertext');

    let seen: { names: { name: string }[]; text?: string } | undefined;
    assert.equal(
      await b.engine.syncActivity(async (remote) => {
        seen = { names: remote.names, text: remote.read('activity__aaaaaaaaaa__2026-10.enc') };
        return {};
      }),
      true,
    );
    assert.deepEqual(seen!.names.map((n) => n.name), ['activity__aaaaaaaaaa__2026-10.enc']);
    assert.equal(seen!.text, 'hello');

    assert.equal(await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': null })), true);
    assert.equal('activity__aaaaaaaaaa__2026-10.enc' in gist.files(id), false);
  });

  it('a version changes when a blob changes and stays put when it does not', async () => {
    const { a } = await two();
    a.categories.activity = true;
    const name = 'activity__aaaaaaaaaa__2026-10.enc';
    const versions: string[] = [];
    const watch = async (remote: { names: { name: string; version: string }[] }) => {
      versions.push(remote.names.find((n) => n.name === name)?.version ?? '');
      return {};
    };
    await a.engine.syncActivity(async () => ({ [name]: 'one' }));
    await a.engine.syncActivity(watch);
    await a.engine.syncActivity(watch);
    await a.engine.syncActivity(async () => ({ [name]: 'two' }));
    await a.engine.syncActivity(watch);
    assert.equal(versions[0], versions[1]);
    assert.notEqual(versions[1], versions[2]);
  });

  it('only writes activity__ names, ignores oversized ones, and survives a throwing exchange', async () => {
    const { a, gist, id } = await two();
    a.categories.activity = true;
    const before = Object.keys(gist.files(id)).sort();
    const ok = await a.engine.syncActivity(async () => ({
      'settings.json.enc': 'overwrite attempt',
      'manifest.json': 'x',
      'activity__aaaaaaaaaa__2026-10.enc': 'x'.repeat(900_000),
    }));
    assert.equal(ok, true);
    assert.deepEqual(Object.keys(gist.files(id)).sort(), before, 'nothing was written');
    assert.equal(await a.engine.syncActivity(async () => { throw new Error('boom'); }), false);
    assert.equal(a.status.state, 'idle', 'the settings-sync status is untouched');
  });

  it('is false when the Gist is unreachable, and settings sync keeps ignoring activity files', async () => {
    const { a, b, gist, id } = await two();
    a.categories.activity = true;
    await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': 'hello' }));
    gist.offline = true;
    assert.equal(await a.engine.syncActivity(async () => ({})), false);
    gist.offline = false;

    a.write('settings.json', '{\n  "editor.fontSize": 18\n}\n');
    await a.run();
    await b.run();
    assert.equal(b.status.state, 'idle');
    assert.deepEqual(b.status.conflicts, []);
    assert.match(b.read('settings.json')!, /18/);
    assert.ok('activity__aaaaaaaaaa__2026-10.enc' in gist.files(id), 'the settings run left the blob alone');
  });
});
