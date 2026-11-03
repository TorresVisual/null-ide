import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { shimFiles, cliUsageSnippet } from './shim';

const EXEC = 'C:\\Users\\Me\\AppData\\Local\\Programs\\Null IDE\\null.exe';
const CLI = 'C:\\Users\\Me\\AppData\\Local\\Programs\\Null IDE\\resources\\app\\extensions\\null-unreal\\out\\cli.js';

test('both shims quote the editor runtime and the CLI path, spaces included', () => {
  const f = shimFiles(EXEC, CLI);
  assert.ok(f['null-unreal.cmd'].includes(`"${EXEC}" "${CLI}"`));
  assert.ok(f['null-unreal'].includes(`"${EXEC}" "${CLI}"`));
});

test('the .cmd sets ELECTRON_RUN_AS_NODE, forwards %* and uses CRLF', () => {
  const cmd = shimFiles(EXEC, CLI)['null-unreal.cmd'];
  assert.match(cmd, /set ELECTRON_RUN_AS_NODE=1/);
  assert.ok(cmd.includes('%*'));
  assert.ok(cmd.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(cmd), 'every newline is CRLF');
});

test('the POSIX shim is a sh script that forwards "$@"', () => {
  const sh = shimFiles(EXEC, CLI)['null-unreal'];
  assert.ok(sh.startsWith('#!/bin/sh\n'));
  assert.match(sh, /export ELECTRON_RUN_AS_NODE=1/);
  assert.match(sh, /exec "/);
  assert.ok(sh.includes('"$@"'));
});

test('the usage snippet names the absolute shim path and all four commands', () => {
  const shimPath = 'C:\\Users\\Me\\AppData\\Local\\Null\\bin\\null-unreal.cmd';
  const s = cliUsageSnippet(shimPath);
  assert.ok(s.includes(shimPath));
  for (const c of ['build', 'test', 'run', 'smoke']) assert.ok(s.includes(c), `mentions ${c}`);
});
