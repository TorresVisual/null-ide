import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { categoryOf, fileOfRemoteName, isDeletable, isSyncableFile, remoteNameOf } from './layout';

describe('isSyncableFile', () => {
  it('accepts the two core files and plain snippet files', () => {
    for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/my.code-snippets']) {
      assert.equal(isSyncableFile(f), true, f);
    }
  });

  it('rejects anything else, including traversal', () => {
    const bad = [
      '', 'tasks.json', 'snippets/', 'snippets/a.txt', 'snippets/../settings.json', 'snippets/..\\x.json',
      'snippets/a/b.json', '../settings.json', 'snippets/C:x.json', '/etc/passwd', 'settings.json/..',
    ];
    for (const f of bad) assert.equal(isSyncableFile(f), false, f);
  });
});

describe('remote names', () => {
  it('round-trips every syncable file', () => {
    for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/a__b.code-snippets']) {
      assert.equal(fileOfRemoteName(remoteNameOf(f)), f, f);
    }
    assert.equal(remoteNameOf('snippets/cpp.json'), 'snippets__cpp.json.enc');
  });

  it('ignores remote names that are not ours or would escape the user folder', () => {
    const bad = [
      'manifest.json', 'settings.json', 'snippets__..\\..\\x.json.enc', 'snippets__a/b.json.enc',
      'snippets/a.json.enc', 'tasks.json.enc', '.enc', 'snippets__.enc', 'extensions.json.enc',
    ];
    for (const n of bad) assert.equal(fileOfRemoteName(n), undefined, n);
  });
});

describe('categories', () => {
  it('maps files to categories', () => {
    assert.equal(categoryOf('settings.json'), 'settings');
    assert.equal(categoryOf('keybindings.json'), 'keybindings');
    assert.equal(categoryOf('snippets/a.json'), 'snippets');
  });

  it('only snippets can be deleted', () => {
    assert.equal(isDeletable('snippets/a.json'), true);
    assert.equal(isDeletable('settings.json'), false);
    assert.equal(isDeletable('keybindings.json'), false);
  });
});
