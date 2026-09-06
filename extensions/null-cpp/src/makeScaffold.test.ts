import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { makefileContent } from './makeScaffoldContent';

test('makefileContent globs src/ into a binary named after the project', () => {
  const content = makefileContent('MiniGit');
  assert.match(content, /BIN := build\/MiniGit/);
  assert.match(content, /SRC := \$\(wildcard src\/\*\.cpp\)/);
});

test('makefileContent declares phony all/run/clean targets', () => {
  const content = makefileContent('MiniGit');
  assert.match(content, /\.PHONY: all run clean/);
  assert.match(content, /^clean:/m);
});
