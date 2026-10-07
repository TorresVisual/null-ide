'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.LofiProvider = void 0;
const stations_1 = require("./stations");
class LofiProvider {
    audioAdapter;
    id = 'lofi';
    displayName = 'Null Lo-Fi Radio';
    currentStationIndex = 0;
    isPlaying = false;
    volume = 80;
    startTime = 0;
    likedStationIds = new Set();
    constructor(audioAdapter) {
        this.audioAdapter = audioAdapter;
    }
    setAudioAdapter(adapter) {
        this.audioAdapter = adapter;
    }
    async isAuthenticated() {
        // 100% free, no login or account required
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
            id: 'null-coder',
            name: 'Null IDE Free Radio',
            product: 'free-stream',
        };
    }
    async getPlaybackState() {
        const station = stations_1.LOFI_STATIONS[this.currentStationIndex] || stations_1.LOFI_STATIONS[0];
        const track = {
            id: station.id,
            name: station.name,
            artist: station.genre,
            artists: [station.genre],
            album: station.description,
            albumArtUrl: station.imageUrl,
            durationMs: 0, // Live infinite stream
            uri: `lofi:station:${station.id}`,
            isLiked: this.likedStationIds.has(station.id),
        };
        const device = {
            id: 'null-built-in-audio',
            name: 'Null IDE Internal Player',
            type: 'IDE Audio',
            isActive: true,
            volumePercent: this.volume,
        };
        const elapsed = this.isPlaying && this.startTime > 0 ? Date.now() - this.startTime : 0;
        return {
            isPlaying: this.isPlaying,
            track,
            progressMs: elapsed,
            durationMs: 0,
            volume: this.volume,
            shuffle: false,
            repeat: 'off',
            device,
            timestamp: Date.now(),
        };
    }
    async play(options) {
        if (options?.contextUri || options?.uri) {
            const targetUri = options.contextUri || options.uri || '';
            const stationId = targetUri.replace('lofi:station:', '').replace('lofi:playlist:', '');
            const idx = stations_1.LOFI_STATIONS.findIndex((s) => s.id === stationId);
            if (idx >= 0) {
                this.currentStationIndex = idx;
            }
        }
        this.isPlaying = true;
        this.startTime = Date.now();
        const station = stations_1.LOFI_STATIONS[this.currentStationIndex] || stations_1.LOFI_STATIONS[0];
        this.audioAdapter?.playStream(station.streamUrl);
    }
    async pause() {
        this.isPlaying = false;
        this.audioAdapter?.pauseStream();
    }
    async next() {
        this.currentStationIndex = (this.currentStationIndex + 1) % stations_1.LOFI_STATIONS.length;
        if (this.isPlaying) {
            await this.play();
        }
    }
    async previous() {
        this.currentStationIndex = (this.currentStationIndex - 1 + stations_1.LOFI_STATIONS.length) % stations_1.LOFI_STATIONS.length;
        if (this.isPlaying) {
            await this.play();
        }
    }
    async seek(_positionMs) {
        // Live radio stream cannot be seeked
    }
    async setVolume(volumePercent) {
        this.volume = Math.max(0, Math.min(100, volumePercent));
        this.audioAdapter?.setVolume(this.volume);
    }
    async setShuffle(_shuffle) { }
    async setRepeatMode(_mode) { }
    async getUserPlaylists() {
        return stations_1.LOFI_STATIONS.map((s) => ({
            id: s.id,
            name: s.name,
            description: `${s.genre} — ${s.description}`,
            imageUrl: s.imageUrl,
            trackCount: 1,
            uri: `lofi:station:${s.id}`,
            owner: 'Null Radio',
        }));
    }
    async getPlaylistTracks(playlistId) {
        const station = stations_1.LOFI_STATIONS.find((s) => s.id === playlistId);
        if (!station) {
            return [];
        }
        return [
            {
                id: station.id,
                name: station.name,
                artist: station.genre,
                artists: [station.genre],
                album: station.description,
                albumArtUrl: station.imageUrl,
                durationMs: 0,
                uri: `lofi:station:${station.id}`,
            },
        ];
    }
    async search(query) {
        const q = query.toLowerCase().trim();
        const matching = stations_1.LOFI_STATIONS.filter((s) => s.name.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
        const tracks = matching.map((s) => ({
            id: s.id,
            name: s.name,
            artist: s.genre,
            artists: [s.genre],
            album: s.description,
            albumArtUrl: s.imageUrl,
            durationMs: 0,
            uri: `lofi:station:${s.id}`,
        }));
        const playlists = matching.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            imageUrl: s.imageUrl,
            trackCount: 1,
            uri: `lofi:station:${s.id}`,
            owner: 'Null Radio',
        }));
        return { tracks, playlists, artists: [], albums: [] };
    }
    async isLiked(trackId) {
        return this.likedStationIds.has(trackId);
    }
    async saveTrack(trackId) {
        this.likedStationIds.add(trackId);
    }
    async removeTrack(trackId) {
        this.likedStationIds.delete(trackId);
    }
    async getDevices() {
        return [
            {
                id: 'null-built-in-audio',
                name: 'Null IDE Internal Audio Player',
                type: 'IDE Audio',
                isActive: true,
                volumePercent: this.volume,
            },
        ];
    }
    async transferPlayback(_deviceId) { }
}
exports.LofiProvider = LofiProvider;
//# sourceMappingURL=lofiProvider.js.map