import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { computeMinimalEdits, offsetToPosition } from './diffUtils';

describe('diffUtils', () => {
  it('returns empty array when text is identical', () => {
    const edits = computeMinimalEdits('const x = 1;\n', 'const x = 1;\n');
    assert.deepStrictEqual(edits, []);
  });

  it('computes minimal edit for middle modification', () => {
    const original = 'const x = 1;\nconst y = 2;\n';
    const formatted = 'const x = 1;\nconst y = 20;\n';
    const edits = computeMinimalEdits(original, formatted);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].startLine, 1);
    assert.strictEqual(edits[0].startChar, 11);
    assert.strictEqual(edits[0].endLine, 1);
    assert.strictEqual(edits[0].endChar, 11);
    assert.strictEqual(edits[0].newText, '0');
  });

  it('computes minimal edit when adding lines', () => {
    const original = 'function foo() {\nreturn 1;\n}\n';
    const formatted = 'function foo() {\n  return 1;\n}\n';
    const edits = computeMinimalEdits(original, formatted);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newText, '  ');
  });

  it('correctly calculates line and character from offset', () => {
    const text = 'line 0\nline 1\nline 2';
    assert.deepStrictEqual(offsetToPosition(text, 0), { line: 0, character: 0 });
    assert.deepStrictEqual(offsetToPosition(text, 6), { line: 0, character: 6 });
    assert.deepStrictEqual(offsetToPosition(text, 7), { line: 1, character: 0 });
    assert.deepStrictEqual(offsetToPosition(text, 14), { line: 2, character: 0 });
    assert.deepStrictEqual(offsetToPosition(text, 17), { line: 2, character: 3 });
  });
});
