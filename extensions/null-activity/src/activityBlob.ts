'use strict';

import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { parseInterval } from './intervalStore';
import { Interval, MACHINE_ID_RE } from './types';

const PREFIX = 'activity__';
const NAME_RE = /^activity__([0-9a-f]{10})__(\d{4}-\d{2})\.enc$/;

export interface MonthBlob {
  machine: string;
  name: string;
  intervals: Interval[];
}

/** The remote file holding one machine's intervals of one month. */
export const blobName = (machine: string, month: string): string => `${PREFIX}${machine}__${month}.enc`;

/** Remote names are untrusted: only exactly the names `blobName` writes are accepted. */
export function parseBlobName(name: string): { machine: string; month: string } | undefined {
  const m = NAME_RE.exec(name);
  return m ? { machine: m[1], month: m[2] } : undefined;
}

export const blobHash = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

/**
 * Header line plus one interval per line (each with its window id, so per-window attribution and WakaTime imports
 * survive), gzipped and base64 so it can be sealed as text. Sorted, so equal data gives equal text and the hash
 * can tell whether anything changed.
 */
export function encodeMonth(machine: { id: string; name: string }, intervals: readonly Interval[]): string {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end || (a.window ?? '').localeCompare(b.window ?? ''));
  const lines = [JSON.stringify({ v: 1, machine: machine.id, name: machine.name })];
  for (const { machine: _machine, ...i } of sorted) lines.push(JSON.stringify(i));
  return zlib.gzipSync(lines.join('\n'), { level: 9 }).toString('base64');
}

/** `undefined` for anything that is not a v1 blob; unreadable lines are skipped like in the log. Never throws. */
export function decodeMonth(text: string): MonthBlob | undefined {
  try {
    const [head, ...lines] = zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8').split('\n');
    const header = JSON.parse(head);
    if (header?.v !== 1 || typeof header.machine !== 'string' || !MACHINE_ID_RE.test(header.machine)) return undefined;
    const intervals = lines.flatMap((line) => (line.trim() ? parseInterval(line) ?? [] : []));
    return { machine: header.machine, name: typeof header.name === 'string' ? header.name.slice(0, 80) : header.machine, intervals };
  } catch {
    return undefined;
  }
}
