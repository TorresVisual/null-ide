'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseGithubRemote } from './githubRemote';

test('parseGithubRemote handles https remotes', () => {
  assert.deepStrictEqual(
    parseGithubRemote('https://github.com/TorresVisual/null-ide.git\n'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
  assert.deepStrictEqual(
    parseGithubRemote('https://github.com/TorresVisual/null-ide'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
});

test('parseGithubRemote handles ssh remotes', () => {
  assert.deepStrictEqual(
    parseGithubRemote('git@github.com:TorresVisual/null-ide.git\n'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
});

test('parseGithubRemote returns null for non-GitHub or malformed remotes', () => {
  assert.strictEqual(parseGithubRemote('https://gitlab.com/foo/bar.git'), null);
  assert.strictEqual(parseGithubRemote('git@bitbucket.org:foo/bar.git'), null);
  assert.strictEqual(parseGithubRemote('not a url'), null);
  assert.strictEqual(parseGithubRemote(''), null);
});
