import assert from 'node:assert';
import test from 'node:test';
import { localPathsFrom, mergeRepos, repoChoices, widgetEnv } from './widgetSetup';

test('mergeRepos replaces only the chosen account\'s entries and keeps order stable', () => {
  const existing = [{ repo: 'a/b', account: 'x' }, { repo: 'k/l', account: 'y' }];
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['c/d', 'a/b']), [{ repo: 'k/l', account: 'y' }, { repo: 'c/d', account: 'x' }, { repo: 'a/b', account: 'x' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', []), [{ repo: 'k/l', account: 'y' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['bad repo', '../x', 'ok/ok']), [{ repo: 'k/l', account: 'y' }, { repo: 'ok/ok', account: 'x' }]);
});

test('repoChoices reads full_name and ignores everything unusable', () => {
  assert.deepStrictEqual(repoChoices([{ full_name: 'o/r' }, { full_name: 'x y/z' }, {}, null, 'nope', { full_name: 'o/r2' }]), ['o/r', 'o/r2']);
  assert.deepStrictEqual(repoChoices({}), []);
});

test('localPathsFrom maps a remote repo to the first checkout, case-insensitively', () => {
  const m = localPathsFrom(new Map([['D:\\one', 'Owner/Repo'], ['D:\\two', 'owner/repo'], ['D:\\three', null]]));
  assert.deepStrictEqual([...m], [['owner/repo', 'D:\\one']]);
});

test('widgetEnv drops what would make a later null.exe run as plain Node, and nothing else', () => {
  const env = widgetEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', VSCODE_PID: '5', vscode_ipc_hook: 'x', Keep: 'k' } as NodeJS.ProcessEnv);
  assert.deepStrictEqual(env, { PATH: 'p', Keep: 'k' });
});
