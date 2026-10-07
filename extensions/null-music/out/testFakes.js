'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeMusicProvider = exports.FakeSecretVault = void 0;
exports.makeSampleTrack = makeSampleTrack;
exports.makeSamplePlaybackState = makeSamplePlaybackState;
class FakeSecretVault {
    data = new Map();
    async get(key) {
        return this.data.get(key);
    }
    async store(key, value) {
        this.data.set(key, value);
    }
    async delete(key) {
        this.data.delete(key);
    }
}
exports.FakeSecretVault = FakeSecretVault;
class FakeMusicProvider {
    id;
    displayName;
    authenticated = true;
    state = null;
    playlists = [];
    devices = [];
    searchResults = { tracks: [], playlists: [], artists: [], albums: [] };
    likedTracks = new Set();
    user = { id: 'u1', name: 'Test User', email: 'test@example.com', product: 'premium' };
    calls = [];
    constructor(id = 'spotify', displayName = 'Spotify') {
        this.id = id;
        this.displayName = displayName;
    }
    async isAuthenticated() {
        this.calls.push({ method: 'isAuthenticated', args: [] });
        return this.authenticated;
    }
    async authenticate() {
        this.calls.push({ method: 'authenticate', args: [] });
        this.authenticated = true;
        return true;
    }
    async disconnect() {
        this.calls.push({ method: 'disconnect', args: [] });
        this.authenticated = false;
        this.state = null;
    }
    async getCurrentUser() {
        this.calls.push({ method: 'getCurrentUser', args: [] });
        return this.user;
    }
    async getPlaybackState() {
        this.calls.push({ method: 'getPlaybackState', args: [] });
        return this.state;
    }
    async play(options) {
        this.calls.push({ method: 'play', args: [options] });
        if (this.state) {
            this.state.isPlaying = true;
        }
    }
    async pause() {
        this.calls.push({ method: 'pause', args: [] });
        if (this.state) {
            this.state.isPlaying = false;
        }
    }
    async next() {
        this.calls.push({ method: 'next', args: [] });
    }
    async previous() {
        this.calls.push({ method: 'previous', args: [] });
    }
    async seek(positionMs) {
        this.calls.push({ method: 'seek', args: [positionMs] });
        if (this.state) {
            this.state.progressMs = positionMs;
        }
    }
    async setVolume(volumePercent) {
        this.calls.push({ method: 'setVolume', args: [volumePercent] });
        if (this.state) {
            this.state.volume = volumePercent;
        }
    }
    async setShuffle(shuffle) {
        this.calls.push({ method: 'setShuffle', args: [shuffle] });
        if (this.state) {
            this.state.shuffle = shuffle;
        }
    }
    async setRepeatMode(mode) {
        this.calls.push({ method: 'setRepeatMode', args: [mode] });
        if (this.state) {
            this.state.repeat = mode;
        }
    }
    async getUserPlaylists() {
        this.calls.push({ method: 'getUserPlaylists', args: [] });
        return this.playlists;
    }
    async getPlaylistTracks(playlistId) {
        this.calls.push({ method: 'getPlaylistTracks', args: [playlistId] });
        return [];
    }
    async search(query) {
        this.calls.push({ method: 'search', args: [query] });
        return this.searchResults;
    }
    async isLiked(trackId) {
        this.calls.push({ method: 'isLiked', args: [trackId] });
        return this.likedTracks.has(trackId);
    }
    async saveTrack(trackId) {
        this.calls.push({ method: 'saveTrack', args: [trackId] });
        this.likedTracks.add(trackId);
    }
    async removeTrack(trackId) {
        this.calls.push({ method: 'removeTrack', args: [trackId] });
        this.likedTracks.delete(trackId);
    }
    async getDevices() {
        this.calls.push({ method: 'getDevices', args: [] });
        return this.devices;
    }
    async transferPlayback(deviceId) {
        this.calls.push({ method: 'transferPlayback', args: [deviceId] });
    }
}
exports.FakeMusicProvider = FakeMusicProvider;
function makeSampleTrack(overrides) {
    return {
        id: 'track-123',
        name: 'Lo-Fi Coding Beats',
        artist: 'Chill Coder',
        artists: ['Chill Coder'],
        album: 'Code Vibes Vol. 1',
        albumArtUrl: 'https://example.com/art.jpg',
        durationMs: 180000,
        uri: 'spotify:track:track-123',
        isLiked: false,
        ...overrides,
    };
}
function makeSamplePlaybackState(overrides) {
    return {
        isPlaying: true,
        track: makeSampleTrack(),
        progressMs: 45000,
        durationMs: 180000,
        volume: 80,
        shuffle: false,
        repeat: 'off',
        device: {
            id: 'dev-1',
            name: 'MacBook Pro',
            type: 'Computer',
            isActive: true,
            volumePercent: 80,
        },
        timestamp: Date.now(),
        ...overrides,
    };
}
//# sourceMappingURL=testFakes.js.map