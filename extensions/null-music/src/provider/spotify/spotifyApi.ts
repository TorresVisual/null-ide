'use strict';

import {
  Album,
  Artist,
  MusicAuthAccount,
  PlaybackDevice,
  PlaybackState,
  Playlist,
  PlayOptions,
  RepeatMode,
  SearchResults,
  Track,
} from '../../types';

export interface SpotifyApiOptions {
  getAccessToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

export class SpotifyApi {
  private static readonly BASE_URL = 'https://api.spotify.com/v1';
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly fetch: typeof fetch;

  constructor(options: SpotifyApiOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      queryParams?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<T | null> {
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

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
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
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  public async getCurrentUser(): Promise<MusicAuthAccount | null> {
    const data = await this.request<any>('/me');
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

  public async getPlaybackState(): Promise<PlaybackState | null> {
    const data = await this.request<any>('/me/player');
    if (!data || !data.item) {
      return null;
    }

    const track = this.mapTrack(data.item);
    const repeatMap: Record<string, RepeatMode> = {
      off: 'off',
      track: 'track',
      context: 'context',
    };

    const device: PlaybackDevice | undefined = data.device
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

  public async play(options?: PlayOptions): Promise<void> {
    const body: any = {};
    if (options?.contextUri) {
      body.context_uri = options.contextUri;
      if (options.offset !== undefined) {
        if (typeof options.offset === 'number') {
          body.offset = { position: options.offset };
        } else {
          body.offset = options.offset;
        }
      }
    } else if (options?.uri) {
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

  public async pause(): Promise<void> {
    await this.request('/me/player/pause', { method: 'PUT' });
  }

  public async next(): Promise<void> {
    await this.request('/me/player/next', { method: 'POST' });
  }

  public async previous(): Promise<void> {
    await this.request('/me/player/previous', { method: 'POST' });
  }

  public async seek(positionMs: number): Promise<void> {
    await this.request('/me/player/seek', {
      method: 'PUT',
      queryParams: { position_ms: Math.max(0, Math.floor(positionMs)) },
    });
  }

  public async setVolume(volumePercent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
    await this.request('/me/player/volume', {
      method: 'PUT',
      queryParams: { volume_percent: clamped },
    });
  }

  public async setShuffle(shuffle: boolean): Promise<void> {
    await this.request('/me/player/shuffle', {
      method: 'PUT',
      queryParams: { state: shuffle },
    });
  }

  public async setRepeatMode(mode: RepeatMode): Promise<void> {
    const state = mode === 'track' ? 'track' : mode === 'context' ? 'context' : 'off';
    await this.request('/me/player/repeat', {
      method: 'PUT',
      queryParams: { state },
    });
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    const data = await this.request<any>('/me/playlists', {
      queryParams: { limit: 50 },
    });
    if (!data?.items || !Array.isArray(data.items)) {
      return [];
    }

    return data.items.map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: item.images?.[0]?.url,
      trackCount: item.tracks?.total || 0,
      uri: item.uri,
      owner: item.owner?.display_name || item.owner?.id || 'Unknown',
    }));
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const data = await this.request<any>(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      queryParams: { limit: 50 },
    });
    if (!data?.items || !Array.isArray(data.items)) {
      return [];
    }

    return data.items
      .filter((item: any) => item?.track && item.track.type === 'track')
      .map((item: any) => this.mapTrack(item.track));
  }

  public async search(query: string): Promise<SearchResults> {
    if (!query.trim()) {
      return { tracks: [], playlists: [], artists: [], albums: [] };
    }

    const data = await this.request<any>('/search', {
      queryParams: {
        q: query,
        type: 'track,playlist,artist,album',
        limit: 10,
      },
    });

    const tracks: Track[] = (data?.tracks?.items || [])
      .filter((item: any) => item && item.type === 'track')
      .map((item: any) => this.mapTrack(item));

    const playlists: Playlist[] = (data?.playlists?.items || [])
      .filter((item: any) => item !== null)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.images?.[0]?.url,
        trackCount: item.tracks?.total || 0,
        uri: item.uri,
        owner: item.owner?.display_name || 'Unknown',
      }));

    const artists: Artist[] = (data?.artists?.items || [])
      .filter((item: any) => item !== null)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        imageUrl: item.images?.[0]?.url,
        uri: item.uri,
      }));

    const albums: Album[] = (data?.albums?.items || [])
      .filter((item: any) => item !== null)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
        imageUrl: item.images?.[0]?.url,
        uri: item.uri,
        trackCount: item.total_tracks || 0,
      }));

    return { tracks, playlists, artists, albums };
  }

  public async isLiked(trackId: string): Promise<boolean> {
    const data = await this.request<boolean[]>('/me/tracks/contains', {
      queryParams: { ids: trackId },
    });
    return Array.isArray(data) && data[0] === true;
  }

  public async saveTrack(trackId: string): Promise<void> {
    await this.request('/me/tracks', {
      method: 'PUT',
      queryParams: { ids: trackId },
    });
  }

  public async removeTrack(trackId: string): Promise<void> {
    await this.request('/me/tracks', {
      method: 'DELETE',
      queryParams: { ids: trackId },
    });
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    const data = await this.request<{ devices: any[] }>('/me/player/devices');
    if (!data?.devices || !Array.isArray(data.devices)) {
      return [];
    }
    return data.devices.map((d: any) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      isActive: !!d.is_active,
      volumePercent: d.volume_percent ?? 100,
    }));
  }

  public async transferPlayback(deviceId: string): Promise<void> {
    await this.request('/me/player', {
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: true,
      },
    });
  }

  private mapTrack(item: any): Track {
    const artists = (item.artists || []).map((a: any) => a.name);
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
