'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { DocRef, PLACEHOLDER, decodeBlob, docQuery, parseDocQuery } from './pullDocs';

const ref: DocRef = {
  owner: 'TorresVisual', repo: 'null-ide', pull: 12, path: 'src/a b/é.ts',
  sha: 'a'.repeat(40), head: 'b'.repeat(40), side: 'LEFT',
};

test('docQuery / parseDocQuery round-trip, including spaces and unicode in the path', () => {
  assert.deepStrictEqual(parseDocQuery(`/${ref.path}`, docQuery(ref)), ref);
});

test('parseDocQuery rejects a traversal path, dot-only owner/repo, short shas, a bad side and a bad pull number', () => {
  const q = (over: Partial<DocRef>) => docQuery({ ...ref, ...over });
  assert.strictEqual(parseDocQuery('/src/../../etc/passwd', q({})), null);
  assert.strictEqual(parseDocQuery('/', q({})), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ owner: '..' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ repo: 'a/b' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ sha: 'abc123' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ head: 'z'.repeat(40) })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ side: 'MIDDLE' as DocRef['side'] })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ pull: 0 })), null);
  assert.strictEqual(parseDocQuery('/a.ts', ''), null);
});

test('decodeBlob returns text as UTF-8 and replaces a binary file with the placeholder', () => {
  assert.strictEqual(decodeBlob(Buffer.from('héllo\n', 'utf8')), 'héllo\n');
  assert.strictEqual(decodeBlob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), PLACEHOLDER);
  assert.strictEqual(decodeBlob(Buffer.alloc(0)), '');
});
