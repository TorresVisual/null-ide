import assert from 'node:assert';
import test from 'node:test';
import * as path from 'node:path';
import { resolveNullNotesExePath } from './nullNotesPath';

test('resolveNullNotesExePath uses the override when set', () => {
  assert.strictEqual(
    resolveNullNotesExePath('C:\\custom\\null-notes.exe', 'C:\\Users\\me\\AppData\\Local'),
    'C:\\custom\\null-notes.exe',
  );
});

test('resolveNullNotesExePath falls back to the default install location when empty', () => {
  assert.strictEqual(
    resolveNullNotesExePath('', 'C:\\Users\\me\\AppData\\Local'),
    path.join('C:\\Users\\me\\AppData\\Local', 'null-notes', 'null-notes.exe'),
  );
});

test('resolveNullNotesExePath treats a whitespace-only override as unset', () => {
  assert.strictEqual(
    resolveNullNotesExePath('   ', 'C:\\Users\\me\\AppData\\Local'),
    path.join('C:\\Users\\me\\AppData\\Local', 'null-notes', 'null-notes.exe'),
  );
});
