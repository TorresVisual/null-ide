'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Library = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const emitter_1 = require("../emitter");
const uri_1 = require("../uri");
const libraryCache_1 = require("./libraryCache");
const m3uParser_1 = require("./m3uParser");
const tagReader_1 = require("./tagReader");
const KEY_FOLDERS = 'null-music.local.folders';
const KEY_LIKED = 'null-music.local.liked';
const KEY_PLAYLISTS = 'null-music.local.playlists';
const MAX_DEPTH = 4;
const EMIT_THROTTLE_MS = 300;
const SAVE_DELAY_MS = 2000;
async function walk(dir, exts, depth) {
    if (depth > MAX_DEPTH)
        return [];
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    }
    catch {
        return []; // missing or offline folder
    }
    const out = [];
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!e.name.startsWith('.'))
                out.push(...(await walk(full, exts, depth + 1)));
        }
        else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
            out.push(full);
        }
    }
    return out;
}
async function mapPool(items, limit, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length)
            await fn(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
/** `Artist - Title` filename convention, else the folder name as artist. */
function filenameMeta(filePath, folderName) {
    const base = path.basename(filePath, path.extname(filePath)).trim().replace(/^\d+[\s.\-_]+/, '');
    const sep = base.indexOf(' - ');
    if (sep >= 0)
        return { artist: base.slice(0, sep).trim(), name: base.slice(sep + 3).trim() };
    return { artist: folderName, name: base };
}
const playlistId = (fsPath) => crypto.createHash('sha1').update(fsPath).digest('hex').slice(0, 16);
class Library {
    options;
    cache;
    folderUris;
    playlistFiles;
    liked;
    byFolder = new Map(); // folder uri → file path → track
    playlistMap = new Map();
    external = new Map(); // playlist-only tracks, by id
    flat;
    index;
    scanned = 0;
    total = 0;
    scanning;
    scanAgain = false;
    emitTimer;
    saveTimer;
    changeEmitter = new emitter_1.Emitter();
    sourcesEmitter = new emitter_1.Emitter();
    likesEmitter = new emitter_1.Emitter();
    /** Tracks, scan progress or likes-affecting data changed (throttled while scanning). */
    onDidChange = this.changeEmitter.event;
    /** Folders or playlists were added/removed/reloaded. */
    onDidChangeSources = this.sourcesEmitter.event;
    /** A like was added or removed (cheap: carries no data, the UI re-reads `likedTracks()`). */
    onDidChangeLikes = this.likesEmitter.event;
    constructor(options) {
        this.options = options;
        this.cache = new libraryCache_1.LibraryCache(options.cacheFile);
        this.folderUris = [...options.state.get(KEY_FOLDERS, [])];
        this.playlistFiles = [...options.state.get(KEY_PLAYLISTS, [])];
        this.liked = new Set(options.state.get(KEY_LIKED, []));
    }
    // ─── Read side ─────────────────────────────────────────────────────────────
    get tracks() {
        if (!this.flat)
            this.flat = this.folderUris.flatMap((f) => this.tracksInFolder(f));
        return this.flat;
    }
    get folders() {
        return [...this.folderUris];
    }
    get playlists() {
        return [...this.playlistMap.values()];
    }
    get playlistPaths() {
        return [...this.playlistFiles];
    }
    /** Folders of playlist-only local files (outside every library folder), so the view may load them. */
    get externalDirs() {
        const dirs = new Set();
        for (const t of this.external.values()) {
            if (t.uri.startsWith('file://') && !t.folder)
                dirs.add(path.dirname((0, uri_1.uriToPath)(t.uri)));
        }
        return [...dirs];
    }
    /** Audio extensions the scanner accepts, as configured (e.g. `.mp3`). */
    get supportedExtensions() {
        return this.options.extensions();
    }
    get progress() {
        return { scanned: this.scanned, total: this.total };
    }
    tracksInFolder(folder) {
        return [...(this.byFolder.get(folder)?.values() ?? [])].sort((a, b) => a.uri.localeCompare(b.uri));
    }
    trackById(id) {
        return this.lookup().get(id);
    }
    trackByUri(uri) {
        return this.trackById(`local:${uri}`);
    }
    /** The list a track should play in (the library, else the first playlist holding it). */
    contextFor(uri) {
        for (const list of [this.tracks, ...this.playlists.map((p) => p.tracks)]) {
            const index = list.findIndex((t) => t.uri === uri);
            if (index >= 0)
                return { tracks: list, index };
        }
        return undefined;
    }
    playlistTracks(id) {
        return id === 'favorites' ? this.likedTracks() : this.playlistMap.get(id)?.tracks ?? [];
    }
    collections() {
        const out = [];
        const liked = this.likedTracks();
        if (liked.length > 0) {
            out.push({ id: 'favorites', kind: 'liked', name: 'Liked Tracks', detail: `${liked.length} favorite track${liked.length !== 1 ? 's' : ''}`, tracks: liked });
        }
        for (const p of this.playlistMap.values()) {
            out.push({ id: p.id, kind: 'playlist', name: p.name, detail: p.filePath, tracks: p.tracks });
        }
        for (const f of this.folderUris) {
            out.push({ id: f, kind: 'folder', name: path.basename((0, uri_1.uriToPath)(f)) || f, detail: f, tracks: this.tracksInFolder(f) });
        }
        return out;
    }
    search(query) {
        const q = query.toLowerCase().trim();
        if (!q)
            return this.tracks;
        return this.tracks.filter((t) => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
    }
    isLiked(id) {
        return this.liked.has(id);
    }
    likedTracks() {
        return this.tracks.filter((t) => this.liked.has(t.id));
    }
    async toggleLike(id) {
        if (!this.liked.delete(id))
            this.liked.add(id);
        await this.options.state.update(KEY_LIKED, [...this.liked]);
        this.likesEmitter.fire();
        return this.liked.has(id);
    }
    /** Called with the duration the audio element measured on first play. */
    learnDuration(id, durationMs) {
        const track = this.trackById(id);
        if (!track || Math.abs(track.durationMs - durationMs) < 500)
            return;
        track.durationMs = durationMs;
        if (track.uri.startsWith('file://')) {
            this.cache.setDuration((0, uri_1.uriToPath)(track.uri), durationMs);
            this.saveSoon();
        }
        this.changed();
    }
    dispose() {
        clearTimeout(this.emitTimer);
        clearTimeout(this.saveTimer);
        void this.cache.save();
        this.changeEmitter.dispose();
        this.sourcesEmitter.dispose();
        this.likesEmitter.dispose();
    }
    lookup() {
        if (!this.index) {
            this.index = new Map([...this.external, ...this.tracks.map((t) => [t.id, t])]);
        }
        return this.index;
    }
    // ─── Folders and scanning ──────────────────────────────────────────────────
    /** Populate from the cache without touching the disk, so the UI fills instantly. */
    async loadCache() {
        await this.cache.load();
        const exts = this.extensionSet();
        for (const folder of this.folderUris) {
            const root = (0, uri_1.uriToPath)(folder);
            const prefix = root.endsWith(path.sep) ? root : root + path.sep;
            const bucket = new Map();
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
    rescan() {
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
            }
            finally {
                this.scanning = undefined;
            }
        })();
        return this.scanning;
    }
    async addFolder(folder) {
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
    }
    async removeFolder(folder) {
        this.folderUris = this.folderUris.filter((u) => u !== folder);
        this.byFolder.delete(folder);
        await this.options.state.update(KEY_FOLDERS, [...this.folderUris]);
        this.changed();
        this.sourcesEmitter.fire();
    }
    async scanAll() {
        this.scanned = 0;
        this.total = 0;
        for (const folder of [...this.folderUris])
            await this.scanFolder(folder);
        // ponytail: an offline folder's cache entries are dropped here and re-read when it returns
        this.cache.prune(new Set([...this.byFolder.values()].flatMap((bucket) => [...bucket.keys()])));
        await this.cache.save();
        await this.loadPlaylists();
        this.scanned = this.total;
        this.fireNow();
    }
    async scanFolder(folder) {
        const files = await walk((0, uri_1.uriToPath)(folder), this.extensionSet(), 0);
        const bucket = this.byFolder.get(folder) ?? new Map();
        this.byFolder.set(folder, bucket);
        this.total += files.length;
        await mapPool(files, this.options.concurrency ?? 8, async (file) => {
            try {
                const st = await fs.promises.stat(file);
                const tags = this.cache.lookup(file, st.mtimeMs, st.size) ?? (await this.readAndCache(file, st));
                bucket.set(file, this.buildTrack(file, folder, tags));
                this.changed();
            }
            catch {
                // unreadable file: leave it out
            }
            this.scanned++;
        });
        const present = new Set(files);
        for (const file of [...bucket.keys()])
            if (!present.has(file))
                bucket.delete(file);
        if (!this.folderUris.includes(folder))
            this.byFolder.delete(folder); // removed mid-scan
        this.changed();
    }
    async readAndCache(file, st) {
        const { art, ...tags } = await (0, tagReader_1.readTags)(file);
        const cached = tags;
        if (art)
            cached.artKey = await this.writeArt(art);
        this.cache.set(file, st.mtimeMs, st.size, cached);
        return cached;
    }
    /** Content-addressed: the same cover is written once and shared by the whole album. */
    async writeArt(art) {
        const key = `${crypto.createHash('sha1').update(art.data).digest('hex').slice(0, 20)}.${art.ext}`;
        try {
            await fs.promises.mkdir(this.options.artDir, { recursive: true });
            await fs.promises.writeFile(path.join(this.options.artDir, key), art.data, { flag: 'wx' });
        }
        catch (err) {
            if (err?.code !== 'EEXIST')
                return undefined;
        }
        return key;
    }
    buildTrack(file, folder, tags) {
        const uri = (0, uri_1.pathToUri)(file);
        const fallback = filenameMeta(file, path.basename((0, uri_1.uriToPath)(folder)));
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
    extensionSet() {
        return new Set(this.options.extensions().map((e) => e.toLowerCase()));
    }
    // ─── Playlists ─────────────────────────────────────────────────────────────
    async importPlaylist(filePathOrUri, content) {
        const playlist = await this.loadPlaylistFile(filePathOrUri, content);
        if (!this.playlistFiles.includes(playlist.filePath)) {
            this.playlistFiles.push(playlist.filePath);
            await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
        }
        this.changed();
        this.sourcesEmitter.fire();
        return playlist;
    }
    async removePlaylist(id) {
        const playlist = this.playlistMap.get(id);
        if (!playlist)
            return;
        this.playlistMap.delete(id);
        this.playlistFiles = this.playlistFiles.filter((p) => p !== playlist.filePath);
        await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
        this.changed();
        this.sourcesEmitter.fire();
    }
    async loadPlaylists() {
        this.external.clear();
        this.playlistMap.clear();
        this.index = undefined;
        for (const file of this.playlistFiles) {
            try {
                await this.loadPlaylistFile(file);
            }
            catch (err) {
                console.error('Null Music: failed to load playlist', file, err);
            }
        }
        this.changed();
        this.sourcesEmitter.fire();
    }
    async loadPlaylistFile(filePathOrUri, content) {
        const fsPath = filePathOrUri.startsWith('file://') ? (0, uri_1.uriToPath)(filePathOrUri) : filePathOrUri;
        if (content === undefined) {
            try {
                content = await fs.promises.readFile(fsPath, 'utf8');
            }
            catch (err) {
                throw new Error(`Failed to read playlist file "${fsPath}": ${err.message}`);
            }
        }
        const parsed = (0, m3uParser_1.parseM3u)(content, fsPath);
        const tracks = new Array(parsed.tracks.length);
        await mapPool(parsed.tracks.map((_, i) => i), this.options.concurrency ?? 8, async (i) => {
            tracks[i] = await this.resolveEntry(parsed.tracks[i]);
        });
        const stored = { id: playlistId(fsPath), name: parsed.name, filePath: fsPath, tracks };
        this.playlistMap.set(stored.id, stored);
        for (const t of tracks)
            this.external.set(t.id, t);
        this.index = undefined;
        return stored;
    }
    /** A library track wins; otherwise tags are read from the file; streams are kept as parsed. */
    async resolveEntry(entry) {
        const known = this.trackById(entry.id);
        if (known)
            return known;
        if (!entry.uri.startsWith('file://'))
            return { ...entry, album: '', folder: '' };
        const tags = await (0, tagReader_1.readTags)((0, uri_1.uriToPath)(entry.uri));
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
    changed() {
        this.flat = undefined;
        this.index = undefined;
        if (this.emitTimer)
            return;
        this.emitTimer = setTimeout(() => {
            this.emitTimer = undefined;
            this.changeEmitter.fire();
        }, EMIT_THROTTLE_MS);
        this.emitTimer.unref();
    }
    fireNow() {
        clearTimeout(this.emitTimer);
        this.emitTimer = undefined;
        this.flat = undefined;
        this.index = undefined;
        this.changeEmitter.fire();
    }
    saveSoon() {
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.cache.save();
        }, SAVE_DELAY_MS);
        this.saveTimer.unref();
    }
}
exports.Library = Library;
//# sourceMappingURL=library.js.map