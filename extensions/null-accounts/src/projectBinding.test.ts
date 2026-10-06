'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BINDINGS_KEY, folderKey, ProjectBinding } from './projectBinding';
import { FakeMeta } from './testFakes';

function makeBinding() {
  const meta = new FakeMeta();
  return { meta, binding: new ProjectBinding(meta, 'win32') };
}

test('folderKey folds case, slashes and trailing separators on Windows', () => {
  assert.strictEqual(folderKey('C:\\Repo\\', 'win32'), 'c:/repo');
  assert.strictEqual(folderKey('c:/repo', 'win32'), 'c:/repo');
  assert.strictEqual(folderKey('C:\\Users\\Me\\My Project', 'win32'), 'c:/users/me/my project');
});

test('folderKey keeps case elsewhere and drops a trailing slash', () => {
  assert.strictEqual(folderKey('/home/Me/Repo/', 'linux'), '/home/Me/Repo');
  assert.notStrictEqual(folderKey('/home/me/repo', 'linux'), folderKey('/home/Me/Repo', 'linux'));
});

test('a binding is found however the folder path is written', async () => {
  const { binding } = makeBinding();
  await binding.bind('C:\\Repo', 'a1');
  assert.strictEqual(binding.accountIdFor('c:/repo/'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\Other'), undefined);
});

test('rebind replaces, unbind removes, and only real changes fire an event', async () => {
  const { binding } = makeBinding();
  let fired = 0;
  binding.onDidChange(() => fired++);

  await binding.bind('C:\\Repo', 'a1');
  await binding.bind('c:/repo', 'a1'); // same folder, same account: no change
  assert.strictEqual(fired, 1);

  await binding.bind('C:\\Repo', 'a2');
  assert.strictEqual(binding.accountIdFor('C:\\Repo'), 'a2');
  assert.strictEqual(fired, 2);

  await binding.unbind('C:\\Repo');
  assert.strictEqual(binding.accountIdFor('C:\\Repo'), undefined);
  assert.strictEqual(fired, 3);

  await binding.unbind('C:\\Repo'); // already gone
  assert.strictEqual(fired, 3);
});

test('prune drops bindings to accounts that no longer exist', async () => {
  const { binding } = makeBinding();
  await binding.bind('C:\\a', 'a1');
  await binding.bind('C:\\b', 'a2');
  let fired = 0;
  binding.onDidChange(() => fired++);

  await binding.prune(new Set(['a1', 'a2']));
  assert.strictEqual(fired, 0);

  await binding.prune(new Set(['a1']));
  assert.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\b'), undefined);
  assert.strictEqual(fired, 1);
});

test('corrupt stored data reads as no bindings and is overwritten by the next bind', async () => {
  const { binding, meta } = makeBinding();
  meta.data.set(BINDINGS_KEY, 'garbage');
  assert.strictEqual(binding.accountIdFor('C:\\a'), undefined);

  meta.data.set(BINDINGS_KEY, { 'c:/bad': 5, 'c:/ok': 'a1' });
  assert.strictEqual(binding.accountIdFor('C:\\ok'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\bad'), undefined);

  meta.data.set(BINDINGS_KEY, ['not', 'a', 'map']);
  await binding.bind('C:\\a', 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
});
