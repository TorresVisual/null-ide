import { win32 as win } from 'node:path';
import { ExportDoc, Header, parseExport, SCHEMA } from './exportFormat';

export interface CacheIo { readFile(p: string): string | undefined; exists(p: string): boolean }

export const assetsDir = (projectDir: string) => win.join(projectDir, 'Saved', 'NullUnreal', 'assets');

// /Game/A/B -> <assets>/Game/A/B.json
export function entryPath(assets: string, pkg: string): string {
  return win.join(assets, ...pkg.split('/').filter(Boolean)) + '.json';
}

export type Lookup = { state: 'hit'; doc: ExportDoc } | { state: 'miss'; reason: 'absent' | 'corrupt' | 'stale' };

// A hit needs the same schema, engine version, source mtime and size, and every sidecar file still present.
export function lookup(assets: string, pkg: string, current: Omit<Header, 'schema'>, io: CacheIo): Lookup {
  const file = entryPath(assets, pkg);
  const text = io.readFile(file);
  if (text === undefined) return { state: 'miss', reason: 'absent' };
  const doc = parseExport(text);
  if (!doc || doc.package !== pkg) return { state: 'miss', reason: 'corrupt' };
  if (
    doc.schema !== SCHEMA ||
    doc.engineVersion !== current.engineVersion ||
    doc.sourceMtime !== current.sourceMtime ||
    doc.sourceSize !== current.sourceSize
  ) {
    return { state: 'miss', reason: 'stale' };
  }
  const dir = win.dirname(file);
  for (const v of Object.values(doc.sidecars)) {
    if (typeof v === 'string' && !io.exists(win.join(dir, v))) return { state: 'miss', reason: 'stale' };
  }
  return { state: 'hit', doc };
}
