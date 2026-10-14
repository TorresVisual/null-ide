'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { classifyWorkspace, isSha, parseWebviewMessage, shaFromArg, unavailableText } from './graphMessages';

const sha = 'a'.repeat(40);

test('isSha accepts only 40 lowercase hex characters', () => {
  assert.strictEqual(isSha(sha), true);
  for (const bad of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), '--upload-pack=x', `${sha}\n`, 42, null, undefined, {}]) {
    assert.strictEqual(isSha(bad), false, String(bad));
  }
});

test('shaFromArg takes a sha string or an object carrying one (tree element, webview context)', () => {
  assert.strictEqual(shaFromArg(sha), sha);
  assert.strictEqual(shaFromArg({ sha, webviewSection: 'commit' }), sha);
  assert.strictEqual(shaFromArg({ sha: '-x' }), undefined);
  assert.strictEqual(shaFromArg(undefined), undefined);
  assert.strictEqual(shaFromArg('HEAD'), undefined);
});

test('parseWebviewMessage keeps well-formed messages and drops everything else', () => {
  assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'loadMore', extra: 1 }), { type: 'loadMore' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'refresh' }), { type: 'refresh' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'manageTrust' }), { type: 'manageTrust' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'select', sha }), { type: 'select', sha });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'goto', sha }), { type: 'goto', sha });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'banner', action: 'skip' }), { type: 'banner', action: 'skip' });
  assert.deepStrictEqual(
    parseWebviewMessage({ type: 'openDiff', sha, file: 'dir/a b é.txt' }),
    { type: 'openDiff', sha, file: 'dir/a b é.txt' },
  );
  assert.deepStrictEqual(parseWebviewMessage({ type: 'openDiff', sha, file: '-dash.txt' }), { type: 'openDiff', sha, file: '-dash.txt' });

  const rejected: unknown[] = [
    null, 'ready', 42, [], {}, { type: 'nope' },
    { type: 'select', sha: '--upload-pack=x' }, { type: 'select' }, { type: 'goto', sha: 'HEAD' },
    { type: 'openDiff', sha, file: '' }, { type: 'openDiff', sha, file: 'a\0b' }, { type: 'openDiff', sha, file: 'x'.repeat(5000) },
    { type: 'openDiff', sha: 'zz', file: 'a.txt' }, { type: 'banner', action: 'nuke' },
  ];
  for (const raw of rejected) assert.strictEqual(parseWebviewMessage(raw), undefined, JSON.stringify(raw));
});

test('classifyWorkspace: no folder, remote, untrusted, otherwise available', () => {
  assert.strictEqual(classifyWorkspace({ folderScheme: undefined, trusted: true }), 'no-folder');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'vscode-remote', trusted: true }), 'remote');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'file', trusted: false }), 'untrusted');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'file', trusted: true }), undefined);
});

test('unavailableText has a sentence for every reason', () => {
  for (const reason of ['no-folder', 'remote', 'untrusted', 'not-a-repo', 'no-git'] as const) {
    assert.ok(unavailableText(reason).length > 10, reason);
  }
});
