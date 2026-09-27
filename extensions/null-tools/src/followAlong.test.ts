import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  encodeProjectPath,
  findProjectDir,
  pickNewestTranscript,
  isPathInWorkspace,
  parseAppendedLines,
  extractEdits,
} from './followAlong';

test('encodeProjectPath lowercases the drive letter and flattens separators', () => {
  assert.equal(encodeProjectPath('D:\\Coding\\Apps\\null-ide'), 'd--Coding-Apps-null-ide');
});

test('findProjectDir matches case-insensitively', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
  try {
    fs.mkdirSync(path.join(root, 'D--Coding-Apps-null-ide'));
    const found = findProjectDir(root, 'D:\\Coding\\Apps\\null-ide');
    assert.equal(found, path.join(root, 'D--Coding-Apps-null-ide'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findProjectDir returns null when nothing matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
  try {
    assert.equal(findProjectDir(root, 'D:\\Other\\Repo'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pickNewestTranscript picks the most recently modified .jsonl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
  try {
    const older = path.join(dir, 'a.jsonl');
    const newer = path.join(dir, 'b.jsonl');
    fs.writeFileSync(older, '{}');
    fs.writeFileSync(path.join(dir, 'ignore.txt'), 'nope');
    fs.utimesSync(older, new Date(1000), new Date(1000));
    fs.writeFileSync(newer, '{}');
    fs.utimesSync(newer, new Date(2000), new Date(2000));
    assert.equal(pickNewestTranscript(dir), newer);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isPathInWorkspace rejects paths outside the workspace root', () => {
  assert.equal(isPathInWorkspace('C:\\repo\\src\\a.ts', 'C:\\repo'), true);
  assert.equal(isPathInWorkspace('C:\\other\\a.ts', 'C:\\repo'), false);
  assert.equal(isPathInWorkspace('C:\\repo', 'C:\\repo'), false);
});

test('parseAppendedLines leaves a trailing partial line unconsumed', () => {
  const text = '{"a":1}\n{"b":2}\n{"c":3';
  const result = parseAppendedLines(text);
  assert.deepEqual(result.lines, [{ a: 1 }, { b: 2 }]);
  assert.equal(result.consumedLength, text.lastIndexOf('\n') + 1);
});

test('parseAppendedLines skips malformed JSON lines', () => {
  const text = '{"a":1}\nnot json\n{"b":2}\n';
  const result = parseAppendedLines(text);
  assert.deepEqual(result.lines, [{ a: 1 }, { b: 2 }]);
});

test('extractEdits pulls line ranges out of a structuredPatch', () => {
  const line = {
    type: 'user',
    toolUseResult: {
      filePath: 'C:\\repo\\src\\a.ts',
      structuredPatch: [{ newStart: 10, newLines: 3, lines: [] }],
    },
  };
  assert.deepEqual(extractEdits(line), [
    { filePath: 'C:\\repo\\src\\a.ts', newStart: 10, newLines: 3, addedLines: [], removedLines: [] },
  ]);
});

test('extractEdits classifies added and removed lines from the patch hunk', () => {
  const line = {
    type: 'user',
    toolUseResult: {
      filePath: 'C:\\repo\\src\\a.ts',
      structuredPatch: [{
        newStart: 5,
        newLines: 3,
        lines: [' context', '-old line', '+new line', ' more context'],
      }],
    },
  };
  const [edit] = extractEdits(line);
  assert.deepEqual(edit.addedLines, [6]);
  assert.deepEqual(edit.removedLines, [{ beforeLine: 6, text: 'old line' }]);
});

test('extractEdits ignores unrelated transcript lines', () => {
  assert.deepEqual(extractEdits({ type: 'user', toolUseResult: { stdout: 'ok' } }), []);
  assert.deepEqual(extractEdits({ type: 'assistant' }), []);
  assert.deepEqual(extractEdits(null), []);
});
