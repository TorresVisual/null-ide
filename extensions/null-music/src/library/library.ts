'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter } from '../emitter';
import { KeyValueStore, Track } from '../types';
import { pathToUri, uriToPath } from '../uri';
import { CachedTags, LibraryCache } from './libraryCache';
import { parseM3u } from './m3uParser';
import { readTags, Tags } from './tagReader';

const KEY_FOLDERS = 'null-music.local.folders';
const KEY_LIKED = 'null-music.local.liked';
const KEY_PLAYLISTS = 'null-music.local.playlists';
const MAX_DEPTH = 4;
const EMIT_THROTTLE_MS = 300;
const SAVE_DELAY_MS = 2000;

export interface LibraryOptions {
  state: KeyValueStore;
  cacheFile: string;
  artDir: string;
  extensions: () => string[];
  concurrency?: number;
}

export interface StoredPlaylist {
  id: string;
  name: string;
  filePath: string;
  tracks: Track[];
}

export interface Collection {
  id: string;
  kind: 'liked' | 'playlist' | 'folder';
  name: string;
  detail: string;
  tracks: Track[];
}

async function walk(dir: string, exts: Set<string>, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // missing or offline folder
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) out.push(...(await walk(full, exts, depth + 1)));
    } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** `Artist - Title` filename convention, else the folder name as artist. */
function filenameMeta(filePath: string, folderName: string): { name: string; artist: string } {
  const base = path.basename(filePath, path.extname(filePath)).trim().replace(/^\d+[\s.\-_]+/, '');
  const sep = base.indexOf(' - ');
  if (sep >= 0) return { artist: base.slice(0, sep).trim(), name: base.slice(sep + 3).trim() };
  return { artist: folderName, name: base };
}

const playlistId = (fsPath: string): string => crypto.createHash('sha1').update(fsPath).digest('hex').slice(0, 16);

export class Library {
  private readonly cache: LibraryCache;
  private folderUris: string[];
  private playlistFiles: string[];
  private readonly liked: Set<string>;
  private readonly byFolder = new Map<string, Map<string, Track>>(); // folder uri → file path → track
  private readonly playlistMap = new Map<string, StoredPlaylist>();
  private readonly external = new Map<string, Track>(); // playlist-only tracks, by id
  private flat: Track[] | undefined;
  private index: Map<string, Track> | undefined;
  private scanned = 0;
  private adding = 0; // addFolder calls in flight (they scan without going through `scanning`)
  private total = 0;
  private scanning: Promise<void> | undefined;
  private scanAgain = false;
  private emitTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly changeEmitter = new Emitter<void>();
  private readonly sourcesEmitter = new Emitter<void>();
  private readonly likesEmitter = new Emitter<void>();

  /** Tracks, scan progress or likes-affecting data changed (throttled while scanning). */
  readonly onDidChange = this.changeEmitter.event;
  /** Folders or playlists were added/removed/reloaded. */
  readonly onDidChangeSources = this.sourcesEmitter.event;
  /** A like was added or removed (cheap: carries no data, the UI re-reads `likedTracks()`). */
  readonly onDidChangeLikes = this.likesEmitter.event;

  constructor(private readonly options: LibraryOptions) {
    this.cache = new LibraryCache(options.cacheFile);
    this.folderUris = [...options.state.get<string[]>(KEY_FOLDERS, [])];
    this.playlistFiles = [...options.state.get<string[]>(KEY_PLAYLISTS, [])];
    this.liked = new Set(options.state.get<string[]>(KEY_LIKED, []));
  }
  // ─── Read side ─────────────────────────────────────────────────────────────

  get tracks(): Track[] {
    if (!this.flat) this.flat = this.folderUris.flatMap((f) => this.tracksInFolder(f));
    return this.flat;
  }

  get folders(): string[] {
    return [...this.folderUris];
  }

  get playlists(): StoredPlaylist[] {
    return [...this.playlistMap.values()];
  }

  get playlistPaths(): string[] {
    return [...this.playlistFiles];
  }

  /** Folders of playlist-only local files (outside every library folder), so the view may load them. */
  get externalDirs(): string[] {
    const dirs = new Set<string>();
    for (const t of this.external.values()) {
      if (t.uri.startsWith('file://') && !t.folder) dirs.add(path.dirname(uriToPath(t.uri)));
    }
    return [...dirs];
  }

  /** Audio extensions the scanner accepts, as configured (e.g. `.mp3`). */
  get supportedExtensions(): string[] {
    return this.options.extensions();
  }

  /** A rescan or an addFolder is walking and reading files right now. */
  get isScanning(): boolean {
    return this.scanning !== undefined || this.adding > 0;
  }

  get progress(): { scanned: number; total: number } {
    return { scanned: this.scanned, total: this.total };
  }

  tracksInFolder(folder: string): Track[] {
    return [...(this.byFolder.get(folder)?.values() ?? [])].sort((a, b) => a.uri.localeCompare(b.uri));
  }

  trackById(id: string): Track | undefined {
    return this.lookup().get(id);
  }

  trackByUri(uri: string): Track | undefined {
    return this.trackById(`local:${uri}`);
  }

  /** The list a track should play in (the library, else the first playlist holding it). */
  contextFor(uri: string): { tracks: Track[]; index: number } | undefined {
    for (const list of [this.tracks, ...this.playlists.map((p) => p.tracks)]) {
      const index = list.findIndex((t) => t.uri === uri);
      if (index >= 0) return { tracks: list, index };
    }
    return undefined;
  }

  playlistTracks(id: string): Track[] {
    return id === 'favorites' ? this.likedTracks() : this.playlistMap.get(id)?.tracks ?? [];
  }

  collections(): Collection[] {
    const out: Collection[] = [];
    const liked = this.likedTracks();
    if (liked.length > 0) {
      out.push({ id: 'favorites', kind: 'liked', name: 'Liked Tracks', detail: `${liked.length} favorite track${liked.length !== 1 ? 's' : ''}`, tracks: liked });
    }
    for (const p of this.playlistMap.values()) {
      out.push({ id: p.id, kind: 'playlist', name: p.name, detail: p.filePath, tracks: p.tracks });
    }
    for (const f of this.folderUris) {
      out.push({ id: f, kind: 'folder', name: path.basename(uriToPath(f)) || f, detail: f, tracks: this.tracksInFolder(f) });
    }
    return out;
  }

  search(query: string): Track[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.tracks;
    return this.tracks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)
    );
  }

  isLiked(id: string): boolean {
    return this.liked.has(id);
  }

  likedTracks(): Track[] {
    return this.tracks.filter((t) => this.liked.has(t.id));
  }

  async toggleLike(id: string): Promise<boolean> {
    if (!this.liked.delete(id)) this.liked.add(id);
    await this.options.state.update(KEY_LIKED, [...this.liked]);
    this.likesEmitter.fire();
    return this.liked.has(id);
  }

  /** Called with the duration the audio element measured on first play. */
  learnDuration(id: string, durationMs: number): void {
    const track = this.trackById(id);
    if (!track || Math.abs(track.durationMs - durationMs) < 500) return;
    track.durationMs = durationMs;
    if (track.uri.startsWith('file://')) {
      this.cache.setDuration(uriToPath(track.uri), durationMs);
      this.saveSoon();
    }
    this.changed();
  }

  dispose(): void {
    clearTimeout(this.emitTimer);
    clearTimeout(this.saveTimer);
    void this.cache.save();
    this.changeEmitter.dispose();
    this.sourcesEmitter.dispose();
    this.likesEmitter.dispose();
  }

  private lookup(): Map<string, Track> {
    if (!this.index) {
      this.index = new Map([...this.external, ...this.tracks.map((t): [string, Track] => [t.id, t])]);
    }
    return this.index;
  }

  // ─── Folders and scanning ──────────────────────────────────────────────────

  /** Populate from the cache without touching the disk, so the UI fills instantly. */
  async loadCache(): Promise<void> {
    await this.cache.load();
    const exts = this.extensionSet();
    for (const folder of this.folderUris) {
      const root = uriToPath(folder);
      const prefix = root.endsWith(path.sep) ? root : root + path.sep;
      const bucket = new Map<string, Track>();
      for (const [file, tags] of this.cache.entries()) {
        if (file.startsWith(prefix) && exts.has(path.extname(file).toLowerCase())) {
          bucket.set(file, this.buildTrack(file, folder, tags));
        }
      }
      this.byFolder.set(folder, bucket);
    }
    await this.loadPlaylists();
    this.fireNow();
  }

  rescan(): Promise<void> {
    if (this.scanning) {
      this.scanAgain = true;
      return this.scanning;
    }
    this.scanning = (async () => {
      try {
        do {
          this.scanAgain = false;
          await this.scanAll();
        } while (this.scanAgain);
      } finally {
        this.scanning = undefined;
      }
    })();
    return this.scanning;
  }

  async addFolder(folder: string): Promise<Track[]> {
    this.adding++;
    try {
      if (!this.folderUris.includes(folder)) {
        this.folderUris.push(folder);
        await this.options.state.update(KEY_FOLDERS, [...this.folderUris]);
        this.sourcesEmitter.fire();
      }
      this.scanned = 0;
      this.total = 0;
      await this.scanFolder(folder);
      await this.cache.save();
      this.scanned = this.total;
      this.fireNow();
      return this.tracksInFolder(folder);
    } finally {
      this.adding--;
    }
  }

  async removeFolder(folder: string): Promise<void> {
    this.folderUris = this.folderUris.filter((u) => u !== folder);
    this.byFolder.delete(folder);
    await this.options.state.update(KEY_FOLDERS, [...this.folderUris]);
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async scanAll(): Promise<void> {
    this.scanned = 0;
    this.total = 0;
    for (const folder of [...this.folderUris]) await this.scanFolder(folder);
    // ponytail: an offline folder's cache entries are dropped here and re-read when it returns
    this.cache.prune(new Set([...this.byFolder.values()].flatMap((bucket) => [...bucket.keys()])));
    await this.cache.save();
    await this.loadPlaylists();
    this.scanned = this.total;
    this.fireNow();
  }

  private async scanFolder(folder: string): Promise<void> {
    const files = await walk(uriToPath(folder), this.extensionSet(), 0);
    const bucket = this.byFolder.get(folder) ?? new Map<string, Track>();
    this.byFolder.set(folder, bucket);
    this.total += files.length;
    await mapPool(files, this.options.concurrency ?? 8, async (file) => {
      try {
        const st = await fs.promises.stat(file);
        const tags = this.cache.lookup(file, st.mtimeMs, st.size) ?? (await this.readAndCache(file, st));
        bucket.set(file, this.buildTrack(file, folder, tags));
        this.changed();
      } catch {
        // unreadable file: leave it out
      }
      this.scanned++;
    });
    const present = new Set(files);
    for (const file of [...bucket.keys()]) if (!present.has(file)) bucket.delete(file);
    if (!this.folderUris.includes(folder)) this.byFolder.delete(folder); // removed mid-scan
    this.changed();
  }

  private async readAndCache(file: string, st: fs.Stats): Promise<CachedTags> {
    const { art, ...tags }: Tags = await readTags(file);
    const cached: CachedTags = tags;
    if (art) cached.artKey = await this.writeArt(art);
    this.cache.set(file, st.mtimeMs, st.size, cached);
    return cached;
  }

  /** Content-addressed: the same cover is written once and shared by the whole album. */
  private async writeArt(art: NonNullable<Tags['art']>): Promise<string | undefined> {
    const key = `${crypto.createHash('sha1').update(art.data).digest('hex').slice(0, 20)}.${art.ext}`;
    try {
      await fs.promises.mkdir(this.options.artDir, { recursive: true });
      await fs.promises.writeFile(path.join(this.options.artDir, key), art.data, { flag: 'wx' });
    } catch (err: any) {
      if (err?.code !== 'EEXIST') return undefined;
    }
    return key;
  }

  private buildTrack(file: string, folder: string, tags: CachedTags): Track {
    const uri = pathToUri(file);
    const fallback = filenameMeta(file, path.basename(uriToPath(folder)));
    const artist = tags.artist || fallback.artist;
    return {
      id: `local:${uri}`,
      name: tags.title || fallback.name,
      artist,
      artists: [artist],
      album: tags.album ?? '',
      albumArtist: tags.albumArtist ?? '',
      trackNo: tags.trackNo,
      discNo: tags.discNo,
      year: tags.year,
      artKey: tags.artKey,
      durationMs: tags.durationMs ?? 0,
      uri,
      folder,
    };
  }

  private extensionSet(): Set<string> {
    return new Set(this.options.extensions().map((e) => e.toLowerCase()));
  }

  // ─── Playlists ─────────────────────────────────────────────────────────────

  async importPlaylist(filePathOrUri: string, content?: string): Promise<StoredPlaylist> {
    const playlist = await this.loadPlaylistFile(filePathOrUri, content);
    if (!this.playlistFiles.includes(playlist.filePath)) {
      this.playlistFiles.push(playlist.filePath);
      await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
    }
    this.changed();
    this.sourcesEmitter.fire();
    return playlist;
  }

  async removePlaylist(id: string): Promise<void> {
    const playlist = this.playlistMap.get(id);
    if (!playlist) return;
    this.playlistMap.delete(id);
    this.playlistFiles = this.playlistFiles.filter((p) => p !== playlist.filePath);
    await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async loadPlaylists(): Promise<void> {
    this.external.clear();
    this.playlistMap.clear();
    this.index = undefined;
    for (const file of this.playlistFiles) {
      try {
        await this.loadPlaylistFile(file);
      } catch (err) {
        console.error('Null Music: failed to load playlist', file, err);
      }
    }
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async loadPlaylistFile(filePathOrUri: string, content?: string): Promise<StoredPlaylist> {
    const fsPath = filePathOrUri.startsWith('file://') ? uriToPath(filePathOrUri) : filePathOrUri;
    if (content === undefined) {
      try {
        content = await fs.promises.readFile(fsPath, 'utf8');
      } catch (err: any) {
        throw new Error(`Failed to read playlist file "${fsPath}": ${err.message}`);
      }
    }
    const parsed = parseM3u(content, fsPath);
    const tracks: Track[] = new Array(parsed.tracks.length);
    await mapPool(
      parsed.tracks.map((_, i) => i),
      this.options.concurrency ?? 8,
      async (i) => {
        tracks[i] = await this.resolveEntry(parsed.tracks[i]);
      }
    );
    const stored: StoredPlaylist = { id: playlistId(fsPath), name: parsed.name, filePath: fsPath, tracks };
    this.playlistMap.set(stored.id, stored);
    for (const t of tracks) this.external.set(t.id, t);
    this.index = undefined;
    return stored;
  }

  /** A library track wins; otherwise tags are read from the file; streams are kept as parsed. */
  private async resolveEntry(entry: Track): Promise<Track> {
    const known = this.trackById(entry.id);
    if (known) return known;
    if (!entry.uri.startsWith('file://')) return { ...entry, album: '', folder: '' };
    const tags = await readTags(uriToPath(entry.uri));
    const artist = tags.artist || entry.artist;
    return {
      ...entry,
      name: tags.title || entry.name,
      artist,
      artists: [artist],
      album: tags.album ?? '',
      albumArtist: tags.albumArtist ?? '',
      trackNo: tags.trackNo,
      discNo: tags.discNo,
      year: tags.year,
      durationMs: entry.durationMs || tags.durationMs || 0,
      folder: '',
    };
  }

  // ─── Change notification ───────────────────────────────────────────────────

  private changed(): void {
    this.flat = undefined;
    this.index = undefined;
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.changeEmitter.fire();
    }, EMIT_THROTTLE_MS);
    this.emitTimer.unref();
  }

  private fireNow(): void {
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    this.flat = undefined;
    this.index = undefined;
    this.changeEmitter.fire();
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.cache.save();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }
}
