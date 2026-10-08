'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { runTool, TOOL_UNAVAILABLE } from './tool';

test('runTool reports the exit code and output; a program that cannot start is TOOL_UNAVAILABLE', async () => {
  const ok = await runTool(process.execPath, ['-e', 'console.log("hi")']);
  assert.deepStrictEqual([ok.code, ok.stdout.trim()], [0, 'hi']);
  assert.strictEqual((await runTool(process.execPath, ['-e', 'process.exit(3)'])).code, 3);
  assert.strictEqual((await runTool('null-accounts-no-such-tool', [])).code, TOOL_UNAVAILABLE);
});

test('runTool merges env over the current environment', async () => {
  const r = await runTool(process.execPath, ['-e', 'console.log(process.env.NULL_ACCOUNTS_X)'], { env: { NULL_ACCOUNTS_X: 'yes' } });
  assert.strictEqual(r.stdout.trim(), 'yes');
});

test('runTool closes stdin, so a tool that waits for input ends instead of hanging', async () => {
  const r = await runTool(process.execPath, ['-e', 'process.stdin.on("end", () => console.log("eof")).resume()'], { timeoutMs: 5000 });
  assert.strictEqual(r.stdout.trim(), 'eof');
});
