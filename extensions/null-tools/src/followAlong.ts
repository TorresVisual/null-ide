'use strict';

import * as fs from 'fs';
import * as path from 'path';

// Claude Code encodes workspace paths as: lowercase drive letter, :\ → --, remaining \/ → -
// e.g. D:\Coding\Apps\null-ide → d--Coding-Apps-null-ide
export function encodeProjectPath(workspacePath: string): string {
  let p = workspacePath;
  p = p.replace(/^([A-Za-z]):[\\\/]/, (_, d: string) => d.toLowerCase() + '--');
  p = p.replace(/[\\\/]/g, '-');
  return p;
}

// Both `D--Coding-...` and `d--Coding-...` can exist for the same repo on Windows
// (see #99) — match the encoded directory name case-insensitively.
export function findProjectDir(claudeProjectsDir: string, workspacePath: string): string | null {
  const expected = encodeProjectPath(workspacePath).toLowerCase();
  let entries: string[];
  try {
    entries = fs.readdirSync(claudeProjectsDir);
  } catch {
    return null;
  }
  const match = entries.find(e => e.toLowerCase() === expected);
  return match ? path.join(claudeProjectsDir, match) : null;
}

// Several parallel sessions can write to the same project dir — follow only
// the most recently written transcript.
export function pickNewestTranscript(projectDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch {
    return null;
  }
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const full = path.join(projectDir, entry);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
  }
  return newest?.file ?? null;
}

export function isPathInWorkspace(filePath: string, workspaceRoot: string): boolean {
  const rel = path.relative(workspaceRoot, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface AppendedLines {
  lines: unknown[];
  consumedLength: number;
}

// Splits complete newline-terminated lines off the front of `text`, parsing
// each as JSON. Any trailing partial line (not yet newline-terminated) is
// left unconsumed so the caller can prepend it to the next read.
export function parseAppendedLines(text: string): AppendedLines {
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return { lines: [], consumedLength: 0 };

  const complete = text.slice(0, lastNewline);
  const lines: unknown[] = [];
  for (const raw of complete.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // Undocumented/evolving transcript format — skip lines we can't parse.
    }
  }
  return { lines, consumedLength: lastNewline + 1 };
}

export interface RemovedLine {
  // 1-based new-file line number the removed text used to sit in front of.
  beforeLine: number;
  text: string;
}

export interface TranscriptEdit {
  filePath: string;
  newStart: number;
  newLines: number;
  addedLines: number[]; // 1-based line numbers, present in the new file
  removedLines: RemovedLine[];
}

interface StructuredPatchEntry {
  newStart?: unknown;
  newLines?: unknown;
  lines?: unknown;
}

// Walks a unified-diff hunk's `lines` (each prefixed ' '/'+'/'-', from the
// `diff` package's structuredPatch) to classify which new-file line numbers
// were added and what text was removed, so callers can render both.
function classifyHunkLines(newStart: number, lines: unknown): Pick<TranscriptEdit, 'addedLines' | 'removedLines'> {
  const addedLines: number[] = [];
  const removedLines: RemovedLine[] = [];
  if (!Array.isArray(lines)) return { addedLines, removedLines };

  let lineNum = newStart;
  for (const raw of lines) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const marker = raw[0];
    if (marker === '+') {
      addedLines.push(lineNum);
      lineNum++;
    } else if (marker === '-') {
      removedLines.push({ beforeLine: lineNum, text: raw.slice(1) });
    } else {
      lineNum++;
    }
  }
  return { addedLines, removedLines };
}

// Pulls exact post-edit line ranges out of a transcript `user` line's
// toolUseResult (the result of an Edit/Write tool_use). Parses defensively
// since the transcript format is undocumented and unrelated line shapes
// (e.g. Bash results) don't have this structure.
export function extractEdits(line: unknown): TranscriptEdit[] {
  if (!line || typeof line !== 'object') return [];
  const toolUseResult = (line as Record<string, unknown>)['toolUseResult'];
  if (!toolUseResult || typeof toolUseResult !== 'object') return [];

  const filePath = (toolUseResult as Record<string, unknown>)['filePath'];
  const structuredPatch = (toolUseResult as Record<string, unknown>)['structuredPatch'];
  if (typeof filePath !== 'string' || !Array.isArray(structuredPatch)) return [];

  const edits: TranscriptEdit[] = [];
  for (const entry of structuredPatch as StructuredPatchEntry[]) {
    const newStart = entry?.newStart;
    const newLines = entry?.newLines;
    if (typeof newStart === 'number' && typeof newLines === 'number') {
      edits.push({ filePath, newStart, newLines, ...classifyHunkLines(newStart, entry?.lines) });
    }
  }
  return edits;
}
