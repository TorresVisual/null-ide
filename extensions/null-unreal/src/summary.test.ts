import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { summarizeBuild, summarizeCompdb, summarizeSmoke, summarizeTest } from './summary';

// Logs captured from UE 5.8 runs (scrubbed); out/ is two levels below the extension root.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'logs', name), 'utf8');

test('a build with BUILD SUCCESSFUL and exit 0 is ok', () => {
  const s = summarizeBuild(fixture('build-ok.txt'));
  assert.equal(s.verdict, 'ok');
});

test('build errors are listed once with a count, and the AutomationTool exit code is named', () => {
  const s = summarizeBuild(fixture('build-fail.txt'));
  assert.equal(s.verdict, 'failed');
  assert.equal(s.lines[0], 'build failed: 2 errors, AutomationTool exit 6');
  assert.ok(s.lines.some((l) => l.includes('MyGameTests.cpp(16,19): error C2065') && l.endsWith('(x2)')), s.lines.join('\n'));
  assert.ok(s.lines.some((l) => l.includes('error C2440')));
});

test('a build log with no success marker and no errors is unknown, with the tail', () => {
  const s = summarizeBuild('Starting AutomationTool...\nsomething else\n');
  assert.equal(s.verdict, 'unknown');
  assert.ok(s.lines[0].startsWith('could not summarize'));
  assert.ok(s.lines.includes('something else'));
});

test('a linker error and a UAT ERROR line count', () => {
  const s = summarizeBuild('Foo.obj : error LNK2019: unresolved external symbol bar\nERROR: BuildCookRun failed\n');
  assert.equal(s.verdict, 'failed');
  assert.equal(s.lines.length, 3);
});

test('more than 30 distinct errors are capped with a pointer to the log', () => {
  const log = Array.from({ length: 35 }, (_, i) => `a.cpp(${i + 1}): error C1000: boom`).join('\n');
  const s = summarizeBuild(log, 'X.txt');
  assert.equal(s.lines.length, 1 + 30 + 1);
  assert.equal(s.lines[31], '… 5 more, see X.txt');
});

test('passing tests are counted', () => {
  const s = summarizeTest(fixture('test-ok.txt'));
  assert.deepEqual(s, { verdict: 'ok', lines: ['test passed: 2 passed, 0 failed'] });
});

test('failing tests are named with their error and warning lines', () => {
  const s = summarizeTest(fixture('test-fail.txt'));
  assert.equal(s.verdict, 'failed');
  assert.equal(s.lines[0], 'test failed: 2 passed, 2 failed');
  assert.ok(s.lines.includes('FAIL MyGame.Broken.Fail (Fail)'));
  assert.ok(s.lines.some((l) => l.startsWith('  error: Expected \'two is three\' to be 3')));
  assert.ok(s.lines.some((l) => l.startsWith('  warning: heads up')));
  assert.ok(s.lines.some((l) => l.startsWith('  error: custom failure')));
});

test('a filter that matches nothing is a failure that says so', () => {
  const s = summarizeTest(fixture('test-none.txt'));
  assert.equal(s.verdict, 'failed');
  assert.equal(s.lines[0], "test failed: no tests matched 'Nothing.Matches' (wrong --filter?)");
});

test('a test that started and never completed is reported as hung', () => {
  const log = 'LogAutomationController: Display: Test Started. Name={A} Path={X.A}\n';
  const s = summarizeTest(log);
  assert.equal(s.verdict, 'failed');
  assert.ok(s.lines.includes('HUNG X.A (started, never completed)'));
});

test('a test log without any result is unknown', () => {
  assert.equal(summarizeTest('nothing useful\n').verdict, 'unknown');
});

test('a smoke run that shuts down cleanly is ok', () => {
  assert.equal(summarizeSmoke(fixture('smoke-ok.txt')).verdict, 'ok');
});

test('a smoke run with an appError is failed and shows the reason', () => {
  const s = summarizeSmoke(fixture('smoke-crash.txt'));
  assert.equal(s.verdict, 'failed');
  assert.ok(s.lines[1].includes('Crashing the gamethread at your request'), s.lines.join('\n'));
});

test('a smoke log that ends before shutdown is unknown, never ok', () => {
  assert.equal(summarizeSmoke('LogInit: Display: starting\n').verdict, 'unknown');
});

test('compdb prints the database path', () => {
  const s = summarizeCompdb(fixture('compdb-ok.txt'));
  assert.deepEqual(s, { verdict: 'ok', lines: ['compile database: D:\\Proj\\MyGame\\compile_commands.json'] });
});

test('compdb names the UBT failure', () => {
  const s = summarizeCompdb(fixture('compdb-fail.txt'));
  assert.equal(s.verdict, 'failed');
  assert.ok(s.lines[0].startsWith('compdb failed: Failed (RulesError)'), s.lines[0]);
});
