import { test } from 'node:test';
import * as assert from 'node:assert';
import { formatCsvCell, rowsToCsv, rowsToJson } from './exportHelper';

test('formatCsvCell handles primitives, nulls and escaping', () => {
  assert.strictEqual(formatCsvCell(null), '');
  assert.strictEqual(formatCsvCell(undefined), '');
  assert.strictEqual(formatCsvCell(123), '123');
  assert.strictEqual(formatCsvCell('hello'), 'hello');
  assert.strictEqual(formatCsvCell('hello, world'), '"hello, world"');
  assert.strictEqual(formatCsvCell('hello "world"'), '"hello ""world"""');
  assert.strictEqual(formatCsvCell('line 1\nline 2'), '"line 1\nline 2"');
  assert.strictEqual(formatCsvCell(BigInt(9007199254740991)), '9007199254740991');
});

test('rowsToCsv formats table to CSV RFC 4180', () => {
  const columns = ['id', 'name', 'bio'];
  const rows = [
    { id: 1, name: 'Alice', bio: 'Coder, creator' },
    { id: 2, name: 'Bob "The Builder"', bio: 'Line1\nLine2' }
  ];

  const csv = rowsToCsv(columns, rows);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], 'id,name,bio');
  assert.strictEqual(lines[1], '1,Alice,"Coder, creator"');
  assert.strictEqual(lines[2], '2,"Bob ""The Builder""","Line1\nLine2"');
});

test('rowsToJson formats rows with bigint and buffers safely', () => {
  const rows = [
    { id: BigInt(42), label: 'item 1' },
    { id: 2, data: new Uint8Array([1, 2, 3]) }
  ];
  const json = rowsToJson(rows, false);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed[0].id, '42');
  assert.strictEqual(parsed[0].label, 'item 1');
  assert.strictEqual(parsed[1].data, '[BLOB 3 bytes]');
});
