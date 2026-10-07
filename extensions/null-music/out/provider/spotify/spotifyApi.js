'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyApi = void 0;
class SpotifyApi {
    static BASE_URL = 'https://api.spotify.com/v1';
    getAccessToken;
    fetch;
    constructor(options) {
        this.getAccessToken = options.getAccessToken;
        this.fetch = options.fetchFn ?? globalThis.fetch;
    }
    async request(endpoint, options = {}) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated with Spotify');
        }
        let url = `${SpotifyApi.BASE_URL}${endpoint}`;
        if (options.queryParams) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.queryParams)) {
                if (value !== undefined) {
                    params.set(key, String(value));
                }
            }
            const qs = params.toString();
            if (qs) {
                url += (url.includes('?') ? '&' : '?') + qs;
            }
        }
        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
        const fetchOptions = {
            method: options.method || 'GET',
            headers,
        };
        if (options.body !== undefined) {
            fetchOptions.body = JSON.stringify(options.body);
        }
        const res = await this.fetch(url, fetchOptions);
        if (res.status === 204) {
            return null;
        }
        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            if (res.status === 404 && endpoint.includes('/player')) {
                throw new Error('No active Spotify playback device found. Open Spotify on any device to start listening.');
            }
            if (res.status === 403 && errorText.includes('PREMIUM_REQUIRED')) {
                throw new Error('Spotify Premium is required for playback control via API.');
            }
            throw new Error(`Spotify API error ${res.status}: ${errorText || res.statusText}`);
        }
        try {
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    async getCurrentUser() {
        const data = await this.request('/me');
        if (!data) {
            return null;
        }
        return {
            id: data.id,
            name: data.display_name || data.id,
            email: data.email,
            product: data.product,
        };
    }
    async getPlaybackState() {
        const data = await this.request('/me/player');
        if (!data || !data.item) {
            return null;
        }
        const track = this.mapTrack(data.item);
        const repeatMap = {
            off: 'off',
            track: 'track',
            context: 'context',
        };
        const device = data.device
            ? {
                id: data.device.id,
                name: data.device.name,
                type: data.device.type,
                isActive: data.device.is_active,
                volumePercent: data.device.volume_percent ?? 100,
            }
            : undefined;
        return {
            isPlaying: !!data.is_playing,
            track,
            progressMs: data.progress_ms || 0,
            durationMs: data.item?.duration_ms || 0,
            volume: data.device?.volume_percent ?? 100,
            shuffle: !!data.shuffle_state,
            repeat: repeatMap[data.repeat_state] || 'off',
            device,
            timestamp: data.timestamp || Date.now(),
        };
    }
    async play(options) {
        const body = {};
        if (options?.contextUri) {
            body.context_uri = options.contextUri;
            if (options.offset !== undefined) {
                if (typeof options.offset === 'number') {
                    body.offset = { position: options.offset };
                }
                else {
                    body.offset = options.offset;
                }
            }
        }
        else if (options?.uri) {
            body.uris = [options.uri];
            if (options.offset !== undefined && typeof options.offset === 'number') {
                body.offset = { position: options.offset };
            }
        }
        await this.request('/me/player/play', {
            method: 'PUT',
            body: Object.keys(body).length > 0 ? body : undefined,
        });
    }
    async pause() {
        await this.request('/me/player/pause', { method: 'PUT' });
    }
    async next() {
        await this.request('/me/player/next', { method: 'POST' });
    }
    async previous() {
        await this.request('/me/player/previous', { method: 'POST' });
    }
    async seek(positionMs) {
        await this.request('/me/player/seek', {
            method: 'PUT',
            queryParams: { position_ms: Math.max(0, Math.floor(positionMs)) },
        });
    }
    async setVolume(volumePercent) {
        const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
        await this.request('/me/player/volume', {
            method: 'PUT',
            queryParams: { volume_percent: clamped },
        });
    }
    async setShuffle(shuffle) {
        await this.request('/me/player/shuffle', {
            method: 'PUT',
            queryParams: { state: shuffle },
        });
    }
    async setRepeatMode(mode) {
        const state = mode === 'track' ? 'track' : mode === 'context' ? 'context' : 'off';
        await this.request('/me/player/repeat', {
            method: 'PUT',
            queryParams: { state },
        });
    }
    async getUserPlaylists() {
        const data = await this.request('/me/playlists', {
            queryParams: { limit: 50 },
        });
        if (!data?.items || !Array.isArray(data.items)) {
            return [];
        }
        return data.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.images?.[0]?.url,
            trackCount: item.tracks?.total || 0,
            uri: item.uri,
            owner: item.owner?.display_name || item.owner?.id || 'Unknown',
        }));
    }
    async getPlaylistTracks(playlistId) {
        const data = await this.request(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
            queryParams: { limit: 50 },
        });
        if (!data?.items || !Array.isArray(data.items)) {
            return [];
        }
        return data.items
            .filter((item) => item?.track && item.track.type === 'track')
            .map((item) => this.mapTrack(item.track));
    }
    async search(query) {
        if (!query.trim()) {
            return { tracks: [], playlists: [], artists: [], albums: [] };
        }
        const data = await this.request('/search', {
            queryParams: {
                q: query,
                type: 'track,playlist,artist,album',
                limit: 10,
            },
        });
        const tracks = (data?.tracks?.items || [])
            .filter((item) => item && item.type === 'track')
            .map((item) => this.mapTrack(item));
        const playlists = (data?.playlists?.items || [])
            .filter((item) => item !== null)
            .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.images?.[0]?.url,
            trackCount: item.tracks?.total || 0,
            uri: item.uri,
            owner: item.owner?.display_name || 'Unknown',
        }));
        const artists = (data?.artists?.items || [])
            .filter((item) => item !== null)
            .map((item) => ({
            id: item.id,
            name: item.name,
            imageUrl: item.images?.[0]?.url,
            uri: item.uri,
        }));
        const albums = (data?.albums?.items || [])
            .filter((item) => item !== null)
            .map((item) => ({
            id: item.id,
            name: item.name,
            artist: item.artists?.map((a) => a.name).join(', ') || 'Unknown Artist',
            imageUrl: item.images?.[0]?.url,
            uri: item.uri,
            trackCount: item.total_tracks || 0,
        }));
        return { tracks, playlists, artists, albums };
    }
    async isLiked(trackId) {
        const data = await this.request('/me/tracks/contains', {
            queryParams: { ids: trackId },
        });
        return Array.isArray(data) && data[0] === true;
    }
    async saveTrack(trackId) {
        await this.request('/me/tracks', {
            method: 'PUT',
            queryParams: { ids: trackId },
        });
    }
    async removeTrack(trackId) {
        await this.request('/me/tracks', {
            method: 'DELETE',
            queryParams: { ids: trackId },
        });
    }
    async getDevices() {
        const data = await this.request('/me/player/devices');
        if (!data?.devices || !Array.isArray(data.devices)) {
            return [];
        }
        return data.devices.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            isActive: !!d.is_active,
            volumePercent: d.volume_percent ?? 100,
        }));
    }
    async transferPlayback(deviceId) {
        await this.request('/me/player', {
            method: 'PUT',
            body: {
                device_ids: [deviceId],
                play: true,
            },
        });
    }
    mapTrack(item) {
        const artists = (item.artists || []).map((a) => a.name);
        return {
            id: item.id || '',
            name: item.name || 'Unknown Track',
            artist: artists.join(', ') || 'Unknown Artist',
            artists,
            album: item.album?.name || 'Unknown Album',
            albumArtUrl: item.album?.images?.[0]?.url,
            durationMs: item.duration_ms || 0,
            uri: item.uri || `spotify:track:${item.id}`,
        };
    }
}
exports.SpotifyApi = SpotifyApi;
//# sourceMappingURL=spotifyApi.js.map