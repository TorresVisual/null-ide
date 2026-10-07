'use strict';

import * as fs from 'fs';
import * as path from 'path';

export const CACHE_VERSION = 1;

/** Tags minus the cover bytes: the cover lives in the art directory, keyed by `artKey`. */
export interface CachedTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs?: number;
  artKey?: string;
}

interface CacheEntry {
  mtime: number;
  size: number;
  tags: CachedTags;
}

export class LibraryCache {
  private readonly map = new Map<string, CacheEntry>();
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.map.clear();
    this.dirty = false;
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      if (raw?.version !== CACHE_VERSION || typeof raw.entries !== 'object' || raw.entries === null) return;
      for (const [file, e] of Object.entries<any>(raw.entries)) {
        if (typeof e?.mtime === 'number' && typeof e?.size === 'number' && typeof e?.tags === 'object' && e.tags !== null) {
          this.map.set(file, { mtime: e.mtime, size: e.size, tags: e.tags });
        }
      }
    } catch {
      this.map.clear(); // missing, unreadable or corrupt: start fresh
    }
  }

  lookup(file: string, mtime: number, size: number): CachedTags | undefined {
    const e = this.map.get(file);
    return e && e.mtime === mtime && e.size === size ? e.tags : undefined;
  }

  set(file: string, mtime: number, size: number, tags: CachedTags): void {
    this.map.set(file, { mtime, size, tags });
    this.dirty = true;
  }

  setDuration(file: string, durationMs: number): void {
    const e = this.map.get(file);
    if (!e) return;
    e.tags.durationMs = durationMs;
    this.dirty = true;
  }

  prune(keep: Set<string>): void {
    for (const file of [...this.map.keys()]) {
      if (!keep.has(file)) {
        this.map.delete(file);
        this.dirty = true;
      }
    }
  }

  *entries(): IterableIterator<[string, CachedTags]> {
    for (const [file, e] of this.map) yield [file, e.tags];
  }

  save(): Promise<void> {
    this.chain = this.chain.then(() => this.write());
    return this.chain;
  }

  private async write(): Promise<void> {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(this.map) }));
      await fs.promises.rename(tmp, this.file);
      this.dirty = false;
    } catch {
      // an unwritable cache only costs a re-scan next start
    }
  }
}
