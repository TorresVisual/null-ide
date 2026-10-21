import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { Snapshot } from './widgetTypes';

const snap = (writtenAt: string): Snapshot => ({ schema: 1, writtenAt,
  projects: { status: 'ok', failed: [], items: [] }, issues: { status: 'ok', failed: [], items: [] }, prs: { status: 'ok', failed: [], items: [] } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-widgets-'));

test('write creates the folder, leaves no .tmp behind and round-trips', () => {
  const dir = path.join(tmp(), 'Null', 'widgets');
  const store = new SnapshotStore(dir);
  store.write(snap('2026-10-21T14:00:00Z'));
  assert.deepStrictEqual(fs.readdirSync(dir), ['snapshot.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, '2026-10-21T14:00:00Z');
});

test('a second write replaces the first atomically (same file name, no partial state visible)', () => {
  const store = new SnapshotStore(tmp());
  store.write(snap('a')); store.write(snap('b'));
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, 'b');
});

test('remove deletes the snapshot and a stale .tmp, and is fine when nothing exists', () => {
  const dir = tmp();
  const store = new SnapshotStore(dir);
  store.remove();
  fs.writeFileSync(path.join(dir, 'snapshot.json'), '{}');
  fs.writeFileSync(path.join(dir, 'snapshot.json.tmp'), '{');
  store.remove();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('widgetsDir needs LOCALAPPDATA', () => {
  assert.strictEqual(widgetsDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } as NodeJS.ProcessEnv), path.win32.join('C:\\Users\\u\\AppData\\Local', 'Null', 'widgets'));
  assert.throws(() => widgetsDir({} as NodeJS.ProcessEnv));
});
