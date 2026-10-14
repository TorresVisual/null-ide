'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadMachineId } from '../machineId';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-machine-'));

test('the id is created once and then stays', () => {
  const dir = tmp();
  assert.strictEqual(loadMachineId(dir, () => '0123456789'), '0123456789');
  assert.strictEqual(loadMachineId(dir, () => 'ffffffffff'), '0123456789');
});

test('a corrupt or malformed machine.json is replaced', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'machine.json'), JSON.stringify({ id: '../../etc' }));
  assert.strictEqual(loadMachineId(dir, () => 'aaaaaaaaaa'), 'aaaaaaaaaa');
  fs.writeFileSync(path.join(dir, 'machine.json'), '{nope');
  assert.strictEqual(loadMachineId(dir, () => 'bbbbbbbbbb'), 'bbbbbbbbbb');
});

test('an unwritable folder still gives an id for this launch', () => {
  const file = path.join(tmp(), 'file');
  fs.writeFileSync(file, '');
  assert.strictEqual(loadMachineId(path.join(file, 'sub'), () => 'cccccccccc'), 'cccccccccc');
});
