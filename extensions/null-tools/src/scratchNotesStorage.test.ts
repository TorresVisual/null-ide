import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getNullDir,
  getScratchDir,
  getNotesDir,
  ensureDir,
  formatTimestamp,
  buildScratchFilename,
  slugify,
  buildNoteFilename,
  deriveNoteLabel,
  ensureGitignoreEntry,
  buildScratchRunCommand,
} from './scratchNotesStorage';

test('getScratchDir and getNotesDir nest under .null inside the workspace root', () => {
  const root = 'C:\\Projects\\Foo';
  assert.equal(getNullDir(root), path.join(root, '.null'));
  assert.equal(getScratchDir(root), path.join(root, '.null', 'scratch'));
  assert.equal(getNotesDir(root), path.join(root, '.null', 'notes'));
});

test('formatTimestamp zero-pads month/day/hour/minute/second', () => {
  const date = new Date(2026, 0, 5, 9, 3, 7); // Jan 5 2026, 09:03:07
  assert.equal(formatTimestamp(date), '20260105-090307');
});

test('buildScratchFilename combines the scratch prefix, timestamp, and extension', () => {
  const date = new Date(2026, 0, 5, 9, 3, 7);
  assert.equal(buildScratchFilename('.ts', date), 'scratch-20260105-090307.ts');
});

test('slugify lowercases, hyphenates, and trims non-alphanumeric runs', () => {
  assert.equal(slugify('Meeting Notes: Q3 Plan!'), 'meeting-notes-q3-plan');
  assert.equal(slugify('  leading/trailing  '), 'leading-trailing');
});

test('slugify falls back to "note" when nothing alphanumeric remains', () => {
  assert.equal(slugify('***'), 'note');
});

test('buildNoteFilename appends -2, -3, ... on collision', () => {
  assert.equal(buildNoteFilename('Ideas', []), 'ideas.md');
  assert.equal(buildNoteFilename('Ideas', ['ideas.md']), 'ideas-2.md');
  assert.equal(buildNoteFilename('Ideas', ['ideas.md', 'ideas-2.md']), 'ideas-3.md');
});

test('deriveNoteLabel prefers the first markdown heading', () => {
  assert.equal(
    deriveNoteLabel('C:\\ws\\.null\\notes\\ideas.md', '# Project Ideas\n\nsome text'),
    'Project Ideas',
  );
});

test('deriveNoteLabel falls back to the filename when there is no heading', () => {
  assert.equal(deriveNoteLabel('C:\\ws\\.null\\notes\\ideas.md', 'no heading here'), 'ideas');
});

test('ensureDir creates nested directories', () => {
  const base = path.join(os.tmpdir(), `null-scratch-ensuredir-${process.pid}`);
  const dir = path.join(base, 'a', 'b');
  try {
    ensureDir(dir);
    assert.equal(fs.existsSync(dir), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry appends .null/ to a missing .gitignore', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-missing-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, '.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry appends to an existing .gitignore without a trailing newline', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-existing-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/');
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, 'node_modules/\n.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry is idempotent', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-idempotent-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    ensureGitignoreEntry(root);
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, '.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildScratchRunCommand maps .py to a quoted python invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.py'),
    'python "C:\\ws\\.null\\scratch\\scratch-1.py"',
  );
});

test('buildScratchRunCommand maps .js to a quoted node invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.js'),
    'node "C:\\ws\\.null\\scratch\\scratch-1.js"',
  );
});

test('buildScratchRunCommand maps .ts to a quoted npx ts-node invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.ts'),
    'npx "ts-node" "C:\\ws\\.null\\scratch\\scratch-1.ts"',
  );
});

test('buildScratchRunCommand returns undefined for non-runnable extensions', () => {
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.md'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.json'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.txt'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.unknown'), undefined);
});
