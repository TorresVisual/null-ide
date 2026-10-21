import assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { PresenceOwnership } from './presenceOwnership';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-own-'));
const claim = (dir: string, file: string, pid: number) => fs.writeFileSync(path.join(dir, file), JSON.stringify({ pid, focusedAt: Date.now() }));

test('the default claim file name is unchanged (Discord presence keeps working)', () => {
  const dir = tmp();
  new PresenceOwnership(dir).claim();
  assert.ok(fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
});

test('a custom claim file is used and is independent of the Discord claim', () => {
  const dir = tmp();
  const widgets = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  widgets.claim();
  assert.ok(fs.existsSync(path.join(dir, 'widgets-owner.json')) && !fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
  widgets.release();
  assert.ok(!fs.existsSync(path.join(dir, 'widgets-owner.json')));
});

test('a live foreign owner keeps ownership; a dead owner is taken over', async () => {
  const dir = tmp();
  const live = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
  try {
    claim(dir, 'widgets-owner.json', live.pid!);
    assert.strictEqual(new PresenceOwnership(dir, undefined, 'widgets-owner.json').isOwner(), false);
  } finally { live.kill(); }
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(r => dead.on('exit', r));
  claim(dir, 'widgets-owner.json', dead.pid!);
  const mine = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  assert.strictEqual(mine.isOwner(), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'widgets-owner.json'), 'utf8')).pid, process.pid);
});
