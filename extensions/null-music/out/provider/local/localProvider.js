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
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma'];
class LocalMusicProvider {
    audioAdapter;
    context;
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
    constructor(audioAdapter, context) {
        this.audioAdapter = audioAdapter;
        this.context = context;
        this.loadPersistedState();
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
            // Play a specific track by URI (local:track:<id>)
            const trackId = options.uri.replace('local:track:', '');
            const idx = this.queue.findIndex((t) => t.id === trackId);
            if (idx >= 0) {
                this.currentIndex = idx;
            }
        }
        else if (options?.contextUri) {
            // Play a "playlist" (folder) by URI (local:folder:<folderUri>)
            const folderUri = decodeURIComponent(options.contextUri.replace('local:folder:', ''));
            await this.loadFolder(folderUri);
            this.currentIndex = 0;
        }
        if (this.currentIndex < 0 && this.queue.length > 0) {
            this.currentIndex = 0;
        }
        const track = this.currentTrack;
        if (!track)
            return;
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
        // If past 3 seconds, restart; otherwise go back
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
        return this.folderUris.map((uri, i) => ({
            id: `local-folder-${i}`,
            name: path.basename(uri),
            description: uri,
            trackCount: this.tracks.filter((t) => t.album === uri).length,
            uri: `local:folder:${encodeURIComponent(uri)}`,
            owner: 'Local Library',
        }));
    }
    async getPlaylistTracks(playlistId) {
        const idx = parseInt(playlistId.replace('local-folder-', ''), 10);
        if (isNaN(idx) || idx >= this.folderUris.length)
            return [];
        const folderUri = this.folderUris[idx];
        return this.tracks.filter((t) => t.album === folderUri);
    }
    async search(query) {
        const q = query.toLowerCase().trim();
        const matching = this.tracks.filter((t) => t.name.toLowerCase().includes(q) ||
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
    /** Called by the extension host after a folder is picked via the file picker. */
    async addFolder(folderUri) {
        if (!this.folderUris.includes(folderUri)) {
            this.folderUris.push(folderUri);
            await this.persistFolders();
        }
        return this.loadFolder(folderUri);
    }
    /** Remove a previously added folder. */
    async removeFolder(folderUri) {
        this.folderUris = this.folderUris.filter((u) => u !== folderUri);
        this.tracks = this.tracks.filter((t) => t.album !== folderUri);
        this.queue = this.queue.filter((t) => t.album !== folderUri);
        await this.persistFolders();
    }
    /** Called by webview audio events to keep state in sync. */
    notifyDuration(durationMs) {
        this.durationMs = durationMs;
    }
    /** Called when audio ends naturally. */
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
            // End of queue, stop
            this.isPlayingState = false;
            this.progressMs = 0;
            this.startTime = 0;
        }
    }
    getAllTracks() {
        return this.tracks;
    }
    getFolderUris() {
        return this.folderUris;
    }
    /** Queue a specific set of tracks starting at the given index. */
    queueAndPlay(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentIndex = startIndex;
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
    async loadFolder(folderUri) {
        try {
            const uri = vscode.Uri.parse(folderUri);
            const entries = await vscode.workspace.fs.readDirectory(uri);
            const audioEntries = entries.filter(([name, type]) => {
                if (type !== vscode.FileType.File)
                    return false;
                const ext = path.extname(name).toLowerCase();
                return SUPPORTED_EXTENSIONS.includes(ext);
            });
            const folderTracks = audioEntries.map(([name]) => {
                const fileUri = vscode.Uri.joinPath(uri, name).toString();
                const trackName = path.basename(name, path.extname(name));
                const id = `local:${fileUri}`;
                return {
                    id,
                    name: trackName,
                    artist: path.basename(folderUri),
                    artists: [path.basename(folderUri)],
                    album: folderUri,
                    durationMs: 0,
                    uri: fileUri,
                };
            });
            // Merge: remove old tracks from this folder and add new ones
            this.tracks = this.tracks.filter((t) => t.album !== folderUri);
            this.tracks.push(...folderTracks);
            // Also update queue if it was from this folder
            if (this.queue.length > 0 && this.queue[0]?.album === folderUri) {
                this.queue = folderTracks;
                this.currentIndex = 0;
            }
            else if (this.queue.length === 0) {
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