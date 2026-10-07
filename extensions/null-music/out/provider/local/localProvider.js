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
exports.LocalMusicProvider = void 0;
const path = __importStar(require("path"));
let vscodeModule;
try {
    vscodeModule = require('vscode');
}
catch {
    vscodeModule = {
        FileType: { File: 1, Directory: 2 },
        Uri: {
            parse: (val) => ({
                toString: () => val,
                fsPath: val.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
            }),
            joinPath: (base, ...parts) => {
                const baseStr = typeof base === 'string' ? base : base.toString();
                const joined = [baseStr.replace(/[/\\]$/, ''), ...parts].join('/');
                return {
                    toString: () => joined,
                    fsPath: joined.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
                };
            },
        },
    };
}
const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma'];
class LocalMusicProvider {
    id = 'local';
    displayName = 'Local Music';
    tracks = [];
    queue = [];
    currentIndex = -1;
    isPlayingState = false;
    volume = 80;
    shuffleState = false;
    repeatMode = 'off';
    progressMs = 0;
    durationMs = 0;
    startTime = 0;
    likedTrackIds = new Set();
    folderUris = [];
    audioAdapter;
    context;
    directoryReader;
    constructor(options, context) {
        if (options && typeof options.playFile === 'function') {
            this.audioAdapter = options;
            this.context = context;
        }
        else if (options) {
            const opts = options;
            this.audioAdapter = opts.audioAdapter;
            this.context = opts.context ?? context;
            this.directoryReader = opts.directoryReader;
        }
        else {
            this.context = context;
        }
        this.loadPersistedState();
        this.rescanAllFolders().catch(() => { });
    }
    setAudioAdapter(adapter) {
        this.audioAdapter = adapter;
    }
    loadPersistedState() {
        if (!this.context)
            return;
        try {
            const saved = this.context.globalState.get('null-music.local.folders', []);
            this.folderUris = saved;
            const liked = this.context.globalState.get('null-music.local.liked', []);
            liked.forEach((id) => this.likedTrackIds.add(id));
        }
        catch (_) { }
    }
    async persistFolders() {
        if (!this.context)
            return;
        await this.context.globalState.update('null-music.local.folders', this.folderUris);
    }
    async persistLiked() {
        if (!this.context)
            return;
        await this.context.globalState.update('null-music.local.liked', Array.from(this.likedTrackIds));
    }
    async rescanAllFolders() {
        for (const folderUri of this.folderUris) {
            await this.loadFolder(folderUri);
        }
    }
    // ─── IMusicProvider ──────────────────────────────────────────────────────────
    async isAuthenticated() {
        return true;
    }
    async authenticate() {
        return true;
    }
    async disconnect() {
        await this.pause();
    }
    async getCurrentUser() {
        return {
            id: 'local-user',
            name: 'Local Library',
            product: 'local',
        };
    }
    async getPlaybackState() {
        const track = this.currentTrack;
        if (!track) {
            return {
                isPlaying: false,
                track: null,
                progressMs: 0,
                durationMs: 0,
                volume: this.volume,
                shuffle: this.shuffleState,
                repeat: this.repeatMode,
                device: this.builtInDevice,
                timestamp: Date.now(),
            };
        }
        const elapsed = this.isPlayingState && this.startTime > 0 ? Date.now() - this.startTime : 0;
        const currentProgress = Math.min(this.durationMs || Infinity, this.progressMs + elapsed);
        return {
            isPlaying: this.isPlayingState,
            track: { ...track, isLiked: this.likedTrackIds.has(track.id) },
            progressMs: currentProgress,
            durationMs: this.durationMs,
            volume: this.volume,
            shuffle: this.shuffleState,
            repeat: this.repeatMode,
            device: this.builtInDevice,
            timestamp: Date.now(),
        };
    }
    async play(options) {
        if (options?.uri) {
            const trackId = options.uri.startsWith('local:track:')
                ? options.uri.replace('local:track:', '')
                : options.uri;
            const idx = this.queue.findIndex((t) => t.id === trackId || t.uri === trackId);
            if (idx >= 0) {
                this.currentIndex = idx;
            }
        }
        else if (options?.contextUri) {
            const folderUri = decodeURIComponent(options.contextUri.replace('local:folder:', ''));
            await this.loadFolder(folderUri);
            this.queue = this.tracks.filter((t) => t.album === folderUri);
            this.currentIndex = 0;
        }
        if (this.currentIndex < 0 && this.queue.length > 0) {
            this.currentIndex = 0;
        }
        const track = this.currentTrack;
        if (!track)
            return;
        if (!options?.uri && !options?.contextUri && !this.isPlayingState) {
            this.isPlayingState = true;
            this.startTime = Date.now();
            this.audioAdapter?.resumeAudio();
            return;
        }
        this.isPlayingState = true;
        this.progressMs = 0;
        this.startTime = Date.now();
        this.audioAdapter?.playFile(track.uri, track.id);
    }
    async pause() {
        if (this.isPlayingState && this.startTime > 0) {
            this.progressMs = Math.min(this.durationMs || Infinity, this.progressMs + (Date.now() - this.startTime));
        }
        this.isPlayingState = false;
        this.startTime = 0;
        this.audioAdapter?.pauseAudio();
    }
    async next() {
        if (this.queue.length === 0)
            return;
        if (this.shuffleState) {
            this.currentIndex = Math.floor(Math.random() * this.queue.length);
        }
        else {
            this.currentIndex = (this.currentIndex + 1) % this.queue.length;
        }
        this.progressMs = 0;
        this.durationMs = 0;
        if (this.isPlayingState) {
            this.startTime = Date.now();
            const track = this.currentTrack;
            this.audioAdapter?.playFile(track.uri, track.id);
        }
    }
    async previous() {
        if (this.queue.length === 0)
            return;
        const elapsed = this.isPlayingState && this.startTime > 0 ? Date.now() - this.startTime : 0;
        if (this.progressMs + elapsed > 3000) {
            this.progressMs = 0;
            this.startTime = Date.now();
            const track = this.currentTrack;
            if (track)
                this.audioAdapter?.playFile(track.uri, track.id);
            return;
        }
        if (this.shuffleState) {
            this.currentIndex = Math.floor(Math.random() * this.queue.length);
        }
        else {
            this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
        }
        this.progressMs = 0;
        this.durationMs = 0;
        if (this.isPlayingState) {
            this.startTime = Date.now();
            const track = this.currentTrack;
            this.audioAdapter?.playFile(track.uri, track.id);
        }
    }
    async seek(positionMs) {
        this.progressMs = positionMs;
        this.startTime = this.isPlayingState ? Date.now() : 0;
        this.audioAdapter?.seekAudio(positionMs);
    }
    async setVolume(volumePercent) {
        this.volume = Math.max(0, Math.min(100, volumePercent));
        this.audioAdapter?.setVolume(this.volume);
    }
    async setShuffle(shuffle) {
        this.shuffleState = shuffle;
    }
    async setRepeatMode(mode) {
        this.repeatMode = mode;
    }
    async getUserPlaylists() {
        const playlists = this.folderUris.map((uri, i) => {
            const folderName = path.basename(decodeURIComponent(uri).replace(/[/\\]$/, '')) || uri;
            const count = this.tracks.filter((t) => t.album === uri).length;
            return {
                id: `local-folder-${i}`,
                name: folderName,
                description: uri,
                trackCount: count,
                uri: `local:folder:${encodeURIComponent(uri)}`,
                owner: 'Local Folder',
            };
        });
        const likedCount = this.likedTrackIds.size;
        if (likedCount > 0) {
            playlists.unshift({
                id: 'local-favorites',
                name: 'Liked Tracks',
                description: `${likedCount} favorite track${likedCount !== 1 ? 's' : ''}`,
                trackCount: likedCount,
                uri: 'local:playlist:favorites',
                owner: 'Favorites',
            });
        }
        return playlists;
    }
    async getPlaylistTracks(playlistId) {
        if (playlistId === 'local-favorites') {
            return this.tracks.filter((t) => this.likedTrackIds.has(t.id));
        }
        const idx = parseInt(playlistId.replace('local-folder-', ''), 10);
        if (isNaN(idx) || idx >= this.folderUris.length)
            return [];
        const folderUri = this.folderUris[idx];
        return this.tracks.filter((t) => t.album === folderUri);
    }
    async search(query) {
        const q = query.toLowerCase().trim();
        const source = this.tracks.length > 0 ? this.tracks : this.queue;
        if (!q) {
            return { tracks: source, playlists: [], artists: [], albums: [] };
        }
        const matching = source.filter((t) => t.name.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q));
        return { tracks: matching, playlists: [], artists: [], albums: [] };
    }
    async isLiked(trackId) {
        return this.likedTrackIds.has(trackId);
    }
    async saveTrack(trackId) {
        this.likedTrackIds.add(trackId);
        await this.persistLiked();
    }
    async removeTrack(trackId) {
        this.likedTrackIds.delete(trackId);
        await this.persistLiked();
    }
    async getDevices() {
        return [this.builtInDevice];
    }
    async transferPlayback(_deviceId) { }
    // ─── Local-specific public API ────────────────────────────────────────────
    async addFolder(folderUri) {
        if (!this.folderUris.includes(folderUri)) {
            this.folderUris.push(folderUri);
            await this.persistFolders();
        }
        return this.loadFolder(folderUri);
    }
    async removeFolder(folderUri) {
        this.folderUris = this.folderUris.filter((u) => u !== folderUri);
        this.tracks = this.tracks.filter((t) => t.album !== folderUri);
        this.queue = this.queue.filter((t) => t.album !== folderUri);
        await this.persistFolders();
    }
    notifyDuration(durationMs, trackUri) {
        this.durationMs = durationMs;
        if (trackUri) {
            const track = this.tracks.find((t) => t.uri === trackUri);
            if (track)
                track.durationMs = durationMs;
            const qTrack = this.queue.find((t) => t.uri === trackUri);
            if (qTrack)
                qTrack.durationMs = durationMs;
        }
        else if (this.currentTrack) {
            this.currentTrack.durationMs = durationMs;
        }
    }
    async notifyEnded() {
        if (this.repeatMode === 'track') {
            this.progressMs = 0;
            this.startTime = Date.now();
            const track = this.currentTrack;
            if (track)
                this.audioAdapter?.playFile(track.uri, track.id);
        }
        else if (this.repeatMode === 'context' || this.currentIndex < this.queue.length - 1) {
            await this.next();
        }
        else {
            this.isPlayingState = false;
            this.progressMs = 0;
            this.startTime = 0;
        }
    }
    getAllTracks() {
        return this.tracks.length > 0 ? this.tracks : this.queue;
    }
    getLikedTracks() {
        const source = this.getAllTracks();
        return source.filter((t) => this.likedTrackIds.has(t.id));
    }
    getFolderUris() {
        return this.folderUris;
    }
    queueAndPlay(tracks, startIndex = 0) {
        if (this.tracks.length === 0) {
            this.tracks = [...tracks];
        }
        this.queue = tracks;
        this.currentIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
        this.progressMs = 0;
        this.durationMs = 0;
        this.isPlayingState = true;
        this.startTime = Date.now();
        const track = this.currentTrack;
        if (track)
            this.audioAdapter?.playFile(track.uri, track.id);
    }
    // ─── Private helpers ──────────────────────────────────────────────────────
    get currentTrack() {
        return this.queue[this.currentIndex];
    }
    get builtInDevice() {
        return {
            id: 'null-local-player',
            name: 'Null IDE Local Player',
            type: 'Local',
            isActive: true,
            volumePercent: this.volume,
        };
    }
    async scanDirectoryRecursive(uri, depth = 0, maxDepth = 4) {
        if (depth > maxDepth)
            return [];
        try {
            let entries;
            if (this.directoryReader) {
                entries = await this.directoryReader(uri);
            }
            else if (vscodeModule.workspace?.fs) {
                entries = await vscodeModule.workspace.fs.readDirectory(uri);
            }
            if (!entries)
                return [];
            const audioUris = [];
            const fileTypeFile = vscodeModule.FileType?.File ?? 1;
            const fileTypeDir = vscodeModule.FileType?.Directory ?? 2;
            for (const [name, type] of entries) {
                if (type === fileTypeFile) {
                    const ext = path.extname(name).toLowerCase();
                    if (SUPPORTED_EXTENSIONS.includes(ext)) {
                        audioUris.push(vscodeModule.Uri.joinPath(uri, name));
                    }
                }
                else if (type === fileTypeDir) {
                    if (!name.startsWith('.')) {
                        const subUris = await this.scanDirectoryRecursive(vscodeModule.Uri.joinPath(uri, name), depth + 1, maxDepth);
                        audioUris.push(...subUris);
                    }
                }
            }
            return audioUris;
        }
        catch {
            return [];
        }
    }
    parseTrackMetadata(fileName, folderName) {
        let base = path.basename(fileName, path.extname(fileName)).trim();
        base = base.replace(/^\d+[\s.\-_]+/, '');
        if (base.includes(' - ')) {
            const parts = base.split(' - ');
            if (parts.length >= 2) {
                return {
                    artist: parts[0].trim(),
                    name: parts.slice(1).join(' - ').trim(),
                };
            }
        }
        return {
            artist: folderName,
            name: base,
        };
    }
    async loadFolder(folderUri) {
        try {
            const uri = vscodeModule.Uri.parse(folderUri);
            const audioUris = await this.scanDirectoryRecursive(uri);
            const folderName = path.basename(uri.fsPath || decodeURIComponent(folderUri).replace(/[/\\]$/, ''));
            const folderTracks = audioUris.map((fileUri) => {
                const fileUriStr = fileUri.toString();
                const fileName = path.basename(fileUri.fsPath || fileUriStr);
                const { name, artist } = this.parseTrackMetadata(fileName, folderName);
                const id = `local:${fileUriStr}`;
                const existingTrack = this.tracks.find((t) => t.id === id);
                return {
                    id,
                    name,
                    artist,
                    artists: [artist],
                    album: folderUri,
                    durationMs: existingTrack?.durationMs || 0,
                    uri: fileUriStr,
                };
            });
            this.tracks = this.tracks.filter((t) => t.album !== folderUri);
            this.tracks.push(...folderTracks);
            if (this.queue.length === 0) {
                this.queue = [...this.tracks];
            }
            return folderTracks;
        }
        catch (err) {
            console.error('LocalMusicProvider: Failed to load folder', folderUri, err);
            return [];
        }
    }
}
exports.LocalMusicProvider = LocalMusicProvider;
//# sourceMappingURL=localProvider.js.map