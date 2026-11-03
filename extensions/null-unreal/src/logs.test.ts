import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { latestLog, latestLogAny, openLog, rotate } from './logs';

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-logs-'));
}

test('openLog creates the missing Saved/NullUnreal folder and names the file by time', async () => {
  const dir = tempProject();
  const log = openLog(dir, 'build', new Date(2026, 0, 2, 3, 4, 5)) as { path: string; stream: fs.WriteStream };
  assert.equal(path.basename(log.path), 'build-20260102-030405.log');
  assert.ok(fs.existsSync(path.join(dir, 'Saved', 'NullUnreal')));
  await new Promise<void>((done) => log.stream.end(done));
});

test('rotate keeps the newest 10 per command and leaves other commands alone', () => {
  const dir = tempProject();
  const logDir = path.join(dir, 'Saved', 'NullUnreal');
  fs.mkdirSync(logDir, { recursive: true });
  for (let i = 1; i <= 12; i++) {
    fs.writeFileSync(path.join(logDir, `build-20260101-0000${String(i).padStart(2, '0')}.log`), '');
  }
  fs.writeFileSync(path.join(logDir, 'test-20260101-000001.log'), '');

  rotate(dir, 'build');

  const left = fs.readdirSync(logDir).sort();
  const builds = left.filter((n) => n.startsWith('build-'));
  assert.equal(builds.length, 10);
  assert.equal(builds[0], 'build-20260101-000003.log');
  assert.equal(builds[9], 'build-20260101-000012.log');
  assert.ok(left.includes('test-20260101-000001.log'));
});

test('openLog returns a warning instead of throwing when Saved is a file', () => {
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, 'Saved'), 'not a folder');
  const log = openLog(dir, 'smoke', new Date());
  assert.equal(log.path, undefined);
  assert.equal(typeof (log as { warning: string }).warning, 'string');
});

test('latestLog returns the newest log of that command, or undefined', () => {
  const dir = tempProject();
  assert.equal(latestLog(dir, 'export'), undefined);
  fs.mkdirSync(path.join(dir, 'Saved', 'NullUnreal'), { recursive: true });
  for (const n of ['export-20240101-100000.log', 'export-20240102-090000.log', 'build-20240103-000000.log']) {
    fs.writeFileSync(path.join(dir, 'Saved', 'NullUnreal', n), '');
  }
  assert.equal(latestLog(dir, 'export'), path.join(dir, 'Saved', 'NullUnreal', 'export-20240102-090000.log'));
});

test('latestLogAny picks the newest stamp across commands and ignores other files', () => {
  const dir = tempProject();
  const logDir = path.join(dir, 'Saved', 'NullUnreal');
  fs.mkdirSync(logDir, { recursive: true });
  for (const n of ['build-20260101-000001.log', 'test-20260102-000001.log', 'smoke-20260101-235959.log', 'export-request-1.json', 'export.lock']) {
    fs.writeFileSync(path.join(logDir, n), '');
  }
  assert.equal(path.basename(latestLogAny(dir)!), 'test-20260102-000001.log');
});

test('latestLogAny is undefined when there are no logs', () => {
  assert.equal(latestLogAny(tempProject()), undefined);
});
