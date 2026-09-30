'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SECTION_HEADER = '# Added by Null IDE Auto-Gitignore';

export function normalizePattern(pattern: string): string {
  return pattern.trim();
}

export function isPatternInGitignore(content: string, pattern: string): boolean {
  const normalized = normalizePattern(pattern);
  const rawName = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const lines = content.split(/\r?\n/).map(l => l.trim());

  return lines.some(line => {
    if (!line || line.startsWith('#')) { return false; }
    const cleanLine = line.endsWith('/') ? line.slice(0, -1) : line;
    return line === normalized || cleanLine === rawName || line === `/${normalized}` || line === `/${rawName}`;
  });
}

export function getMissingEntries(existingGitignore: string, detectedArtifacts: string[]): string[] {
  return detectedArtifacts.filter(pattern => !isPatternInGitignore(existingGitignore, pattern));
}

export function updateGitignoreContent(existingContent: string, missingEntries: string[]): string {
  if (missingEntries.length === 0) { return existingContent; }

  let updated = existingContent;
  if (updated && !updated.endsWith('\n')) { updated += '\n'; }
  if (!updated.includes(SECTION_HEADER)) { updated += `\n${SECTION_HEADER}\n`; }

  for (const entry of missingEntries) { updated += `${entry}\n`; }
  return updated;
}

export function detectArtifactsInRoot(rootPath: string, patterns: string[]): string[] {
  const detected: string[] = [];

  for (const pattern of patterns) {
    const isDirPattern = pattern.endsWith('/');
    const relName = isDirPattern ? pattern.slice(0, -1) : pattern;

    if (relName.includes('*')) {
      try {
        const files = fs.readdirSync(rootPath);
        const ext = relName.replace('*', '');
        if (files.some(f => f.endsWith(ext))) { detected.push(pattern); }
      } catch { /* ignore */ }
      continue;
    }

    const fullPath = path.join(rootPath, relName);
    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (isDirPattern && stat.isDirectory()) { detected.push(pattern); }
        else if (!isDirPattern) { detected.push(pattern); }
      }
    } catch { /* ignore */ }
  }

  return detected;
}

export interface OutputSink {
  appendLine(msg: string): void;
}

export async function processWorkspaceAutoGitignore(
  rootPath: string,
  patterns: string[],
  autoCommit: boolean,
  output?: OutputSink,
): Promise<{ updated: boolean; added: string[]; committed: boolean }> {
  const gitignorePath = path.join(rootPath, '.gitignore');
  let existingContent = '';

  try {
    if (fs.existsSync(gitignorePath)) {
      existingContent = fs.readFileSync(gitignorePath, 'utf8');
    }
  } catch (err) {
    output?.appendLine(`Error reading .gitignore: ${(err as Error).message}`);
  }

  const detected = detectArtifactsInRoot(rootPath, patterns);
  const missing = getMissingEntries(existingContent, detected);

  if (missing.length === 0) {
    return { updated: false, added: [], committed: false };
  }

  const newContent = updateGitignoreContent(existingContent, missing);
  fs.writeFileSync(gitignorePath, newContent, 'utf8');
  output?.appendLine(`Null Auto-Gitignore added entries to .gitignore: ${missing.join(', ')}`);

  let committed = false;
  if (autoCommit) {
    try {
      const gitDir = path.join(rootPath, '.git');
      if (fs.existsSync(gitDir)) {
        await execAsync(`git add .gitignore`, { cwd: rootPath });
        const commitMsg = `chore: auto-update .gitignore with ${missing.join(', ')} [Null IDE]`;
        await execAsync(`git commit -m "${commitMsg}"`, { cwd: rootPath });
        committed = true;
        output?.appendLine(`Null Auto-Gitignore auto-committed updated .gitignore`);
      }
    } catch (err) {
      output?.appendLine(`Could not auto-commit .gitignore: ${(err as Error).message}`);
    }
  }

  return { updated: true, added: missing, committed };
}
