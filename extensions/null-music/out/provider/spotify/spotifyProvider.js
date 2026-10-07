'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyProvider = void 0;
const spotifyApi_1 = require("./spotifyApi");
class SpotifyProvider {
    auth;
    id = 'spotify';
    displayName = 'Spotify';
    api;
    constructor(auth, apiOverride) {
        this.auth = auth;
        this.api =
            apiOverride ??
                new spotifyApi_1.SpotifyApi({
                    getAccessToken: () => this.auth.getValidAccessToken(),
                });
    }
    async isAuthenticated() {
        return this.auth.isAuthenticated();
    }
    async authenticate() {
        return this.auth.login();
    }
    async disconnect() {
        await this.auth.logout();
    }
    async getCurrentUser() {
        return this.api.getCurrentUser();
    }
    async getPlaybackState() {
        const state = await this.api.getPlaybackState();
        if (state?.track?.id) {
            try {
                state.track.isLiked = await this.api.isLiked(state.track.id);
            }
            catch {
                // Liked status is non-critical
            }
        }
        return state;
    }
    async play(options) {
        await this.api.play(options);
    }
    async pause() {
        await this.api.pause();
    }
    async next() {
        await this.api.next();
    }
    async previous() {
        await this.api.previous();
    }
    async seek(positionMs) {
        await this.api.seek(positionMs);
    }
    async setVolume(volumePercent) {
        await this.api.setVolume(volumePercent);
    }
    async setShuffle(shuffle) {
        await this.api.setShuffle(shuffle);
    }
    async setRepeatMode(mode) {
        await this.api.setRepeatMode(mode);
    }
    async getUserPlaylists() {
        return this.api.getUserPlaylists();
    }
    async getPlaylistTracks(playlistId) {
        return this.api.getPlaylistTracks(playlistId);
    }
    async search(query) {
        return this.api.search(query);
    }
    async isLiked(trackId) {
        return this.api.isLiked(trackId);
    }
    async saveTrack(trackId) {
        await this.api.saveTrack(trackId);
    }
    async removeTrack(trackId) {
        await this.api.removeTrack(trackId);
    }
    async getDevices() {
        return this.api.getDevices();
    }
    async transferPlayback(deviceId) {
        await this.api.transferPlayback(deviceId);
    }
}
exports.SpotifyProvider = SpotifyProvider;
//# sourceMappingURL=spotifyProvider.js.map