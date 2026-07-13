'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface ScratchLanguage {
  label: string;
  extension: string;
}

export const SCRATCH_LANGUAGES: ScratchLanguage[] = [
  { label: 'JavaScript', extension: '.js' },
  { label: 'TypeScript', extension: '.ts' },
  { label: 'Python', extension: '.py' },
  { label: 'Markdown', extension: '.md' },
  { label: 'JSON', extension: '.json' },
  { label: 'Plain Text', extension: '.txt' },
];

export function getNullDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.null');
}

export function getScratchDir(workspaceRoot: string): string {
  return path.join(getNullDir(workspaceRoot), 'scratch');
}

export function getNotesDir(workspaceRoot: string): string {
  return path.join(getNullDir(workspaceRoot), 'notes');
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildScratchFilename(extension: string, date: Date = new Date()): string {
  return `scratch-${formatTimestamp(date)}${extension}`;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'note';
}

export function buildNoteFilename(title: string, existingFilenames: string[]): string {
  const base = slugify(title);
  const existing = new Set(existingFilenames);
  let candidate = `${base}.md`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${n}.md`;
    n++;
  }
  return candidate;
}

export function deriveNoteLabel(filePath: string, content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) { return match[1].trim(); }
  return path.basename(filePath, '.md');
}

export function ensureGitignoreEntry(workspaceRoot: string): void {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    content = '';
  }
  const alreadyPresent = content.split(/\r?\n/).some(line => line.trim() === '.null/');
  if (alreadyPresent) { return; }
  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  fs.writeFileSync(gitignorePath, `${content}${needsLeadingNewline ? '\n' : ''}.null/\n`);
}
