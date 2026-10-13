import { afterEach, describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFiles } from './localFiles';

const made: string[] = [];
afterEach(() => {
  mock.restoreAll();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(dirty: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-files-'));
  made.push(root);
  const userDir = path.join(root, 'User');
  const backupsDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(userDir, 'snippets'), { recursive: true });
  let clock = 1;
  const files = new LocalFiles({
    userDir,
    backupsDir,
    isDirty: (p) => dirty.includes(p),
    now: () => clock++,
  });
  return { userDir, backupsDir, files };
}

describe('read / list', () => {
  it('reads null for a missing file', async () => {
    assert.equal(await setup().files.read('keybindings.json'), null);
  });

  it('lists only existing synced files in the requested categories', async () => {
    const { userDir, files } = setup();
    fs.writeFileSync(path.join(userDir, 'settings.json'), 'S');
    fs.writeFileSync(path.join(userDir, 'snippets', 'a.json'), 'A');
    fs.writeFileSync(path.join(userDir, 'snippets', 'readme.txt'), 'no');
    fs.mkdirSync(path.join(userDir, 'snippets', 'dir.json'));
    assert.deepEqual(await files.list(['settings']), { 'settings.json': 'S' });
    assert.deepEqual(await files.list(['snippets']), { 'snippets/a.json': 'A' });
    assert.deepEqual(await files.list(['settings', 'keybindings', 'snippets']), { 'settings.json': 'S', 'snippets/a.json': 'A' });
  });
});

describe('write', () => {
  it('creates the file (and the snippets folder) atomically, leaving no temp file', async () => {
    const { userDir, files } = setup();
    fs.rmSync(path.join(userDir, 'snippets'), { recursive: true });
    await files.write('snippets/a.json', 'A');
    assert.equal(fs.readFileSync(path.join(userDir, 'snippets', 'a.json'), 'utf8'), 'A');
    assert.deepEqual(fs.readdirSync(path.join(userDir, 'snippets')), ['a.json']);
  });

  it('backs up the previous content before overwriting or deleting', async () => {
    const { backupsDir, files } = setup();
    await files.write('settings.json', 'v1');
    await files.write('settings.json', 'v2');
    await files.write('settings.json', null);
    assert.equal(await files.read('settings.json'), null);
    const backups = fs.readdirSync(backupsDir).sort();
    assert.deepEqual(backups.map((b) => fs.readFileSync(path.join(backupsDir, b), 'utf8')), ['v1', 'v2']);
  });

  it('keeps only the 10 newest backups per file', async () => {
    const { backupsDir, files } = setup();
    for (let i = 1; i <= 13; i++) await files.write('settings.json', `v${i}`);
    const stamps = fs.readdirSync(backupsDir).filter((n) => n.startsWith('settings.json.')).map((n) => Number(n.split('.').pop()));
    assert.equal(stamps.length, 10);
    assert.equal(Math.min(...stamps), 3);
  });

  it('does not mix backups of different files', async () => {
    const { backupsDir, files } = setup();
    await files.write('snippets/a.json', '1');
    await files.write('snippets/a.json', '2');
    await files.write('settings.json', '1');
    await files.write('settings.json', '2');
    assert.deepEqual(fs.readdirSync(backupsDir).map((n) => n.split('.')[0]).sort(), ['settings', 'snippets__a']);
  });
});

describe('safety', () => {
  it('refuses any name outside the synced set', async () => {
    const { files } = setup();
    for (const name of ['../evil.json', 'snippets/..\\x.json', 'snippets/a/b.json', 'tasks.json']) {
      await assert.rejects(files.write(name, 'x'), /Refusing/, name);
      await assert.rejects(files.read(name), /Refusing/, name);
    }
  });

  it('asks the editor about the absolute path', () => {
    const { userDir } = setup();
    const dirtyPath = path.join(userDir, 'settings.json');
    const files = new LocalFiles({ userDir, backupsDir: '', isDirty: (p) => p === dirtyPath, now: () => 0 });
    assert.equal(files.isDirty('settings.json'), true);
    assert.equal(files.isDirty('keybindings.json'), false);
  });
});

describe('read errors', () => {
  const denied = (): never => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  };

  it('an unreadable snippets folder fails the listing instead of looking like deleted snippets', async () => {
    const { files } = setup();
    mock.method(fs.promises, 'readdir', async () => denied());
    await assert.rejects(files.list(['snippets']), /EACCES/);
  });

  it('a snippet file that cannot be read fails the listing instead of looking deleted', async () => {
    const { userDir, files } = setup();
    fs.writeFileSync(path.join(userDir, 'snippets', 'a.json'), 'A');
    mock.method(fs.promises, 'readFile', async () => denied());
    await assert.rejects(files.list(['snippets']), /EACCES/);
  });
});
