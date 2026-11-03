import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatResult, parseLogPath, exitCodeOf } from './result';

test('a finished run prints the result line and the log path', () => {
  const out = formatResult('test', { code: 0, timedOut: false, seconds: 12.4 }, 'C:\\My Games\\Saved\\NullUnreal\\test-1.log');
  assert.equal(out, 'null-unreal test: exit 0 in 12s\nlog: C:\\My Games\\Saved\\NullUnreal\\test-1.log');
});

test('parseLogPath round-trips a path with spaces', () => {
  const logPath = 'C:\\My Games\\Saved\\NullUnreal\\smoke-20260102-030405.log';
  const out = formatResult('smoke', { code: 0, timedOut: false, seconds: 3 }, logPath);
  assert.equal(parseLogPath(out), logPath);
});

test('a run without a log prints the warning and parses to undefined', () => {
  const out = formatResult('run', { code: 0, timedOut: false, seconds: 1 }, undefined, 'could not create C:\\x');
  assert.equal(out.split('\n')[1], 'log: not kept (could not create C:\\x)');
  assert.equal(parseLogPath(out), undefined);
});

test('a timeout prints timed out and the elapsed seconds', () => {
  const out = formatResult('smoke', { code: null, timedOut: true, seconds: 120.2 }, 'C:\\p\\smoke.log');
  assert.equal(out.split('\n')[0], 'null-unreal smoke: timed out after 120s');
});

test('a process killed by a signal reports 255, never 0', () => {
  assert.equal(formatResult('build', { code: null, timedOut: false, seconds: 2 }, undefined, 'x').split('\n')[0], 'null-unreal build: exit 255 in 2s');
  assert.equal(exitCodeOf({ code: null, timedOut: false, seconds: 2 }), 255);
});

test('exit codes: the process code passes through, a timeout is 124', () => {
  assert.equal(exitCodeOf({ code: 3, timedOut: false, seconds: 1 }), 3);
  assert.equal(exitCodeOf({ code: 1, timedOut: true, seconds: 1 }), 124);
});
