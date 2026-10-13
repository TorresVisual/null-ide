import { after, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from 'jsonc-parser';
import { FakeGist } from './fakeGist';
import { Device, cleanup } from './testDevice';

after(cleanup);

const PASS = 'correct horse battery staple';
const SETTINGS = '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe"\n}\n';

/** Two devices that already hold exactly `files` and agree with the cloud. */
async function synced(files: Record<string, string>) {
  const gist = new FakeGist();
  const a = new Device(gist);
  const b = new Device(gist);
  for (const [file, text] of Object.entries(files)) {
    a.write(file, text);
    b.write(file, text);
  }
  assert.equal((await a.enable(PASS)).ok, true);
  assert.equal((await b.enable(PASS, 'cloud')).ok, true);
  assert.equal(a.status.state, 'idle');
  assert.equal(b.status.state, 'idle');
  return { gist, a, b, id: gist.ids()[0] };
}

describe('first sync', () => {
  it('a new device takes the cloud data but keeps its own excluded settings', async () => {
    const gist = new FakeGist();
    const a = new Device(gist);
    const b = new Device(gist);
    a.write('settings.json', '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\a\\\\git.exe"\n}\n');
    assert.equal((await a.enable(PASS)).ok, true);
    b.write('settings.json', '{\n  "git.path": "D:\\\\b\\\\git.exe"\n}\n');
    assert.equal((await b.enable(PASS, 'cloud')).ok, true);
    assert.deepEqual(parse(b.read('settings.json')!), { 'editor.fontSize': 14, 'git.path': 'D:\\b\\git.exe' });
    assert.equal(b.backups('settings.json.').length, 1, 'the old local file is backed up');
    assert.deepEqual(parse(a.read('settings.json')!), { 'editor.fontSize': 14, 'git.path': 'C:\\a\\git.exe' });
  });

  it('"use this device" makes the cloud match this device', async () => {
    const { gist, a } = await synced({ 'keybindings.json': '[]\n' });
    const c = new Device(gist);
    c.write('keybindings.json', '[1]\n');
    assert.equal((await c.enable(PASS, 'device')).ok, true);
    await a.run();
    assert.equal(a.read('keybindings.json'), '[1]\n');
    assert.equal(c.status.state, 'idle');
  });

  it('"decide per file" leaves the conflict for the user and changes nothing', async () => {
    const { gist } = await synced({ 'keybindings.json': '[]\n' });
    const c = new Device(gist);
    c.write('keybindings.json', '[1]\n');
    assert.equal((await c.enable(PASS, 'each')).ok, true);
    assert.deepEqual(c.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
    assert.equal(c.status.state, 'needsAttention');
    assert.equal(c.read('keybindings.json'), '[1]\n');
  });

  it('a device with no snippets simply receives them', async () => {
    const gist = new FakeGist();
    const a = new Device(gist);
    a.write('snippets/cpp.json', '{}\n');
    assert.equal((await a.enable(PASS)).ok, true);
    const b = new Device(gist);
    assert.equal((await b.enable(PASS, 'each')).ok, true);
    assert.equal(b.read('snippets/cpp.json'), '{}\n');
    assert.equal(b.status.state, 'idle');
  });
});

describe('syncing edits', () => {
  it('an edit on one device reaches the other, and nothing ping-pongs', async () => {
    const { gist, a, b, id } = await synced({ 'settings.json': SETTINGS });
    const before = gist.revisionCount(id);
    for (let i = 0; i < 2; i++) { await a.run(); await b.run(); }
    assert.equal(gist.revisionCount(id), before, 'idle devices push nothing');

    b.write('settings.json', SETTINGS.replace('14', '16'));
    await b.run();
    await a.run();
    assert.deepEqual(parse(a.read('settings.json')!), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });

    const afterEdit = gist.revisionCount(id);
    for (let i = 0; i < 2; i++) { await a.run(); await b.run(); }
    assert.equal(gist.revisionCount(id), afterEdit, 'no further pushes');
    assert.equal(a.status.state, 'idle');
    assert.equal(b.status.state, 'idle');
  });

  it('editing only an excluded setting syncs nothing', async () => {
    const { gist, a, id } = await synced({ 'settings.json': SETTINGS });
    const before = gist.revisionCount(id);
    a.write('settings.json', SETTINGS.replace('C:\\\\git.exe', 'D:\\\\other.exe'));
    await a.run();
    assert.equal(gist.revisionCount(id), before);
  });

  it('a secret-looking setting never reaches the other device', async () => {
    const { a, b } = await synced({ 'settings.json': '{\n  "editor.fontSize": 14\n}\n' });
    a.write('settings.json', '{\n  "editor.fontSize": 18,\n  "my.apiToken": "s3cret"\n}\n');
    await a.run();
    await b.run();
    assert.equal(b.read('settings.json')!.includes('s3cret'), false);
    assert.deepEqual(parse(b.read('settings.json')!), { 'editor.fontSize': 18 });
  });

  it('a new snippet file is added on the other device', async () => {
    const { a, b } = await synced({});
    a.write('snippets/rust.json', '{"a":1}\n');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/rust.json'), '{"a":1}\n');
  });
});

describe('conflicts', () => {
  it('a file edited on both devices is a conflict that no run resolves silently', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    b.write('keybindings.json', '[2]\n');
    await a.run();
    await b.run();
    assert.deepEqual(b.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
    assert.equal(b.status.state, 'needsAttention');
    assert.equal(b.read('keybindings.json'), '[2]\n');
    await b.run();
    assert.equal(b.read('keybindings.json'), '[2]\n', 'still untouched on a later run');
    assert.equal(b.status.conflicts.length, 1);
  });
});

describe('connectivity and credentials', () => {
  it('offline edits are kept and pushed when the connection returns', async () => {
    const { gist, a, b } = await synced({ 'keybindings.json': '[]\n' });
    gist.offline = true;
    a.write('keybindings.json', '[1]\n');
    await a.run();
    assert.equal(a.status.state, 'offline');
    assert.match(a.status.message!, /ENOTFOUND/);
    assert.equal(a.read('keybindings.json'), '[1]\n');
    gist.offline = false;
    await a.run();
    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.equal(a.status.state, 'idle');
  });

  it('a wrong saved passphrase is an error and writes nothing locally', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    b.passphrase = 'some other passphrase';
    a.write('keybindings.json', '[1]\n');
    await a.run();
    await b.run();
    assert.equal(b.status.state, 'error');
    assert.match(b.status.message!, /passphrase/);
    assert.equal(b.read('keybindings.json'), '[]\n');
  });

  it('a deleted gist asks to set up again instead of recreating it', async () => {
    const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
    gist.delete(id);
    await a.run();
    assert.equal(a.status.state, 'signedOut');
    assert.match(a.status.message!, /no longer exists/);
    assert.equal(gist.ids().length, 0, 'a background run must not create a new gist');
  });

  it('is disabled when switched off and signedOut when never set up', async () => {
    const d = new Device(new FakeGist());
    d.enabled = false;
    await d.run();
    assert.equal(d.status.state, 'disabled');
    d.enabled = true;
    await d.run();
    assert.equal(d.status.state, 'signedOut');
  });

  it('a held cross-window lock skips a background run quietly and tells an interactive one', async () => {
    const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
    a.locked = true;
    a.write('keybindings.json', '[1]\n');
    const before = gist.revisionCount(id);
    await a.run();
    assert.equal(gist.revisionCount(id), before);
    assert.equal(a.status.state, 'idle');
    await a.syncNow();
    assert.match(a.status.message!, /Another window/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('tells listeners about every status change', async () => {
    const { a } = await synced({});
    const seen: string[] = [];
    const sub = a.engine.onDidChange(() => seen.push(a.status.state));
    await a.run();
    sub.dispose();
    await a.run();
    assert.deepEqual(seen, ['syncing', 'idle']);
  });
});

describe('deletions', () => {
  it('a missing settings.json is restored from the cloud and never deleted there', async () => {
    const S = '{\n  "editor.fontSize": 14\n}\n';
    const { gist, a, id } = await synced({ 'settings.json': S });
    const before = gist.revisionCount(id);
    a.remove('settings.json');
    await a.run();
    assert.equal(a.read('settings.json'), S);
    assert.equal(gist.revisionCount(id), before);
  });

  it('a device that never had a keybindings.json pushes nothing for it', async () => {
    const { gist, a, b, id } = await synced({});
    const before = gist.revisionCount(id);
    await a.run();
    await b.run();
    assert.equal(a.read('keybindings.json'), null);
    assert.equal(gist.revisionCount(id), before);
    assert.equal(a.status.state, 'idle');
  });

  it('a deleted snippet is deleted on the other device, with a backup', async () => {
    const { a, b } = await synced({ 'snippets/a.json': '{"a":1}\n' });
    a.remove('snippets/a.json');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/a.json'), null);
    assert.equal(b.backups('snippets__a.json.').length, 1);
    assert.equal(b.status.state, 'idle');
  });
});

describe('unsaved edits', () => {
  it('a file open with unsaved edits is skipped and applied on the next run', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    await a.run();
    b.dirty.add('keybindings.json');
    await b.run();
    assert.deepEqual(b.status.pending, ['keybindings.json']);
    assert.equal(b.status.state, 'needsAttention');
    assert.equal(b.read('keybindings.json'), '[]\n');
    b.dirty.clear();
    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.deepEqual(b.status.pending, []);
    assert.equal(b.status.state, 'idle');
  });

  it('an interactive run asks, and only overwrites when told to', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    await a.run();
    b.dirty.add('keybindings.json');
    await b.syncNow();
    assert.deepEqual(b.status.pending, ['keybindings.json']);
    b.overwrite = true;
    await b.syncNow();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.deepEqual(b.status.pending, []);
  });
});

describe('bad data', () => {
  it('one corrupt remote file is reported while the rest still syncs, and nothing is written from it', async () => {
    const { gist, a, b, id } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
    gist.tamper(id, 'keybindings.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
    a.write('snippets/a.json', '{"x":1}\n');
    a.write('keybindings.json', '[9]\n');
    await a.run();
    await b.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /keybindings\.json\.enc/);
    assert.equal(a.read('keybindings.json'), '[9]\n', 'an undecryptable remote file is never overwritten');
    assert.equal(b.read('snippets/a.json'), '{"x":1}\n');
    assert.equal(b.read('keybindings.json'), '[]\n');
    assert.equal(b.status.state, 'error');
  });

  it('a remote file name that tries to leave the snippets folder is ignored', async () => {
    const { gist, b, id } = await synced({});
    gist.tamper(id, 'snippets__..\\..\\evil.json.enc', 'x');
    gist.tamper(id, 'tasks.json.enc', 'x');
    await b.run();
    assert.equal(b.status.state, 'idle');
    assert.equal(b.read('tasks.json'), null);
  });

  it('an invalid local settings.json is reported and not uploaded', async () => {
    const { gist, a, id } = await synced({ 'settings.json': '{\n  "a": 1\n}\n' });
    const before = gist.revisionCount(id);
    a.write('settings.json', '{ "a": ');
    await a.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /settings\.json is not valid JSON/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('an empty settings.json, comments and trailing commas are all fine', async () => {
    const { a, b } = await synced({ 'settings.json': '' });
    a.write('settings.json', '// my settings\n{\n  "a": 1, // one\n}\n');
    await a.run();
    await b.run();
    assert.equal(b.status.state, 'idle');
    assert.deepEqual(parse(b.read('settings.json')!), { a: 1 });
    assert.match(b.read('settings.json')!, /\/\/ my settings/);
  });

  it('a file over 900 KB is reported and not uploaded', async () => {
    const { gist, a, id } = await synced({});
    a.write('snippets/big.json', 'x'.repeat(900_001));
    await a.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /too large/);
    assert.equal(Object.keys(gist.files(id)).some((n) => n.includes('big')), false);
  });
});

describe('categories', () => {
  it('a disabled category is neither uploaded nor applied', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
    a.categories.snippets = false;
    b.categories.keybindings = false;
    a.write('snippets/a.json', '{"x":1}\n');
    a.write('keybindings.json', '[1]\n');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/a.json'), '{}\n', 'a never uploaded the snippet');
    assert.equal(b.read('keybindings.json'), '[]\n', 'b does not apply keybindings');
  });
});
