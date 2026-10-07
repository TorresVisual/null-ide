'use strict';

import assert from 'node:assert';
import * as path from 'path';
import { test } from 'node:test';
import { pathToUri, uriToPath } from '../uri';

test('uriToPath inverts pathToUri, including spaces and non-ASCII', () => {
  const p = path.join(path.resolve('/'), 'Music', 'My Album', 'Bjørk – Ünïcode.mp3');
  assert.strictEqual(uriToPath(pathToUri(p)), p);
  assert.ok(pathToUri(p).startsWith('file:///'));
});
