import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from './commandLine';

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function logDir(projectDir: string): string {
  return path.join(projectDir, 'Saved', 'NullUnreal');
}

// A run always keeps its log. When the folder cannot be made, the run still goes ahead without one.
export function openLog(
  projectDir: string,
  cmd: Command,
  now: Date,
): { path: string; stream: fs.WriteStream } | { path: undefined; warning: string } {
  const dir = logDir(projectDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${cmd}-${stamp(now)}.log`);
    const fd = fs.openSync(file, 'w');
    return { path: file, stream: fs.createWriteStream(file, { fd }) };
  } catch (e) {
    return { path: undefined, warning: `could not create ${dir}: ${(e as Error).message}` };
  }
}

// Stamps sort chronologically by name, so the oldest are the first in sorted order.
export function rotate(projectDir: string, cmd: Command, keep = 10): void {
  const dir = logDir(projectDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const re = new RegExp(`^${cmd}-\\d{8}-\\d{6}\\.log$`);
  const old = names.filter((n) => re.test(n)).sort();
  for (const n of old.slice(0, Math.max(0, old.length - keep))) {
    try {
      fs.rmSync(path.join(dir, n), { force: true });
    } catch {
      // A locked log (Windows keeps files open) is not worth failing a run for.
    }
  }
}

// The newest log of any command (the stamp, not the command name, orders them).
export function latestLogAny(projectDir: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(logDir(projectDir));
  } catch {
    return undefined;
  }
  const stamped = names.flatMap((n) => {
    const m = /^[a-z]+-(\d{8}-\d{6})\.log$/.exec(n);
    return m ? [{ n, stamp: m[1] }] : [];
  });
  stamped.sort((a, b) => a.stamp.localeCompare(b.stamp) || a.n.localeCompare(b.n));
  const newest = stamped.pop();
  return newest ? path.join(logDir(projectDir), newest.n) : undefined;
}

// The newest log of one command, or undefined when none exists yet.
export function latestLog(projectDir: string, cmd: Command): string | undefined {
  const dir = logDir(projectDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const re = new RegExp(`^${cmd}-\\d{8}-\\d{6}\\.log$`);
  const newest = names.filter((n) => re.test(n)).sort().pop();
  return newest ? path.join(dir, newest) : undefined;
}
