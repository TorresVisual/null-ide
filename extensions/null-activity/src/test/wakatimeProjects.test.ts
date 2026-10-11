'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { diskProjectResolver } from '../wakatimeProjects';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-'));
const forward = (p: string) => p.replace(/\\/g, '/');

function repo(root: string, remote: string): void {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`);
}

test('a heartbeat directory inside an existing repo resolves to the repo key and root', () => {
  const root = tmpDir();
  repo(root, 'git@github.com:Torres/Null-IDE.git');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  assert.deepStrictEqual(diskProjectResolver('whatever', forward(src)), {
    key: 'github.com/torres/null-ide',
    name: path.basename(root),
    root,
  });
});

test('missing, relative and non-git directories do not resolve', () => {
  assert.strictEqual(diskProjectResolver('p', forward(path.join(tmpDir(), 'does-not-exist'))), undefined);
  assert.strictEqual(diskProjectResolver('p', 'relative/dir'), undefined);
  const plain = path.join(tmpDir(), 'plain');
  fs.mkdirSync(plain);
  assert.strictEqual(diskProjectResolver('p', forward(plain)), undefined);
});
