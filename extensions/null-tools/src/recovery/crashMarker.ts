'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface Marker {
  pid: number;
  startedAt: number;
  folders: string[];
}

export interface FoundMarker {
  file: string;
  marker: Marker;
}

// EPERM means the process exists but belongs to someone else — still alive.
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Written to a temp name and renamed so a window scanning at the same moment
// never reads a half-written marker (and deletes it as "corrupt").
export function writeMarker(dir: string, marker: Marker): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${marker.pid}-${marker.startedAt}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(marker));
  fs.renameSync(tmp, file);
  return file;
}

export function removeMarker(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}

function parseMarker(text: string): Marker | null {
  try {
    const m = JSON.parse(text);
    if (
      m &&
      Number.isInteger(m.pid) &&
      Number.isFinite(m.startedAt) &&
      Array.isArray(m.folders) &&
      m.folders.every((f: unknown) => typeof f === 'string')
    ) {
      return m as Marker;
    }
  } catch {
    // corrupt
  }
  return null;
}

// Markers of dead processes = crashed runs. They stay on disk until the user
// reviews or discards them, so they are the pending record too.
// ponytail: a dead pid reused by another live process hides that crash; the age rule cleans it up.
export function findCrashed(
  dir: string,
  isAlive: (pid: number) => boolean,
  now: number,
  maxAgeMs: number,
): FoundMarker[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const crashed: FoundMarker[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    let marker: Marker | null = null;
    try {
      marker = parseMarker(fs.readFileSync(file, 'utf8'));
    } catch {
      // unreadable
    }
    if (!marker || now - marker.startedAt > maxAgeMs) {
      removeMarker(file);
      continue;
    }
    if (!isAlive(marker.pid)) crashed.push({ file, marker });
  }
  return crashed;
}

// Windows paths are case-insensitive; `D:\Repo` and `d:\repo` are one folder.
const norm = (p: string): string => path.resolve(p).toLowerCase();

export function sharesFolder(markerFolders: string[], windowFolders: string[]): boolean {
  const mine = new Set(windowFolders.map(norm));
  return markerFolders.some(f => mine.has(norm(f)));
}
