'use strict';

import { execSync, spawn } from 'child_process';

const PROMPT =
  'Output ONLY a single git commit message for the staged diff below. ' +
  'No explanation. No preamble. No code block fences. No bullet points. No quotes. ' +
  'Use conventional commit format: type: short description ' +
  '(imperative mood, under 72 chars). ' +
  'Types: feat, fix, chore, refactor, docs, style, test. ' +
  'Your entire response must be exactly one line -- the commit message itself.\n\n' +
  'Staged diff:\n';

export function getStagedDiff(cwd: string): string {
  try {
    const staged = execSync('git diff --staged', { cwd, encoding: 'utf8', timeout: 10000 });
    if (staged.trim()) return staged;
    return execSync('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
  } catch {
    return '';
  }
}

export function getChangedFiles(cwd: string): string {
  try {
    const staged = execSync('git diff --staged --name-status', { cwd, encoding: 'utf8', timeout: 10000 });
    if (staged.trim()) return staged;
    return execSync('git diff HEAD --name-status', { cwd, encoding: 'utf8', timeout: 10000 });
  } catch {
    return '';
  }
}

/** Offline fallback when claude is unavailable: builds a message from `git diff --name-status` output. */
export function heuristicMessage(nameStatus: string): string {
  const files = nameStatus.split('\n').filter(l => l.trim()).map(l => {
    const [status, ...paths] = l.split('\t');
    return { status: status[0], path: paths[paths.length - 1] };
  });
  if (!files.length) return 'chore: update files';
  const all = (re: RegExp) => files.every(f => re.test(f.path));
  const type = all(/\.(md|mdx|txt)$|(^|\/)docs\//i) ? 'docs' : all(/\.(test|spec)\.|(^|\/)tests?\//i) ? 'test' : 'chore';
  const verb = files.every(f => f.status === 'A') ? 'add' : files.every(f => f.status === 'D') ? 'remove' : 'update';
  const names = files.map(f => f.path.split('/').pop());
  return `${type}: ${verb} ${files.length <= 3 ? names.join(', ') : `${files.length} files`}`;
}

export function runClaude(diff: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--print'], { cwd, shell: true, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.stdin.write(PROMPT + diff);
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude timed out after 30 s')); }, 30000);
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        const msg = out.trim();
        if (msg) resolve(msg);
        else reject(new Error(`claude produced no output (stderr: ${err.trim() || 'none'})`));
      } else {
        reject(new Error(err.trim() || `claude exited with code ${code}`));
      }
    });
  });
}
