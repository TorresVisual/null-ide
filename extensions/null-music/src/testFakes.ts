'use strict';

import { SecretVault } from './auth/authStore';
import { IMusicProvider } from './provider/musicProvider';
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
} from './types';

export class FakeSecretVault implements SecretVault {
  public readonly data = new Map<string, string>();

  public async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  public async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export class FakeMusicProvider implements IMusicProvider {
  public id: string;
  public displayName: string;
  public authenticated: boolean = true;
  public state: PlaybackState | null = null;
  public playlists: Playlist[] = [];
  public devices: PlaybackDevice[] = [];
  public searchResults: SearchResults = { tracks: [], playlists: [], artists: [], albums: [] };
  public likedTracks = new Set<string>();
  public user: MusicAuthAccount | null = { id: 'u1', name: 'Test User', email: 'test@example.com', product: 'premium' };

  public calls: Array<{ method: string; args: any[] }> = [];

  constructor(id: string = 'spotify', displayName: string = 'Spotify') {
    this.id = id;
    this.displayName = displayName;
  }

  public async isAuthenticated(): Promise<boolean> {
    this.calls.push({ method: 'isAuthenticated', args: [] });
    return this.authenticated;
  }

  public async authenticate(): Promise<boolean> {
    this.calls.push({ method: 'authenticate', args: [] });
    this.authenticated = true;
    return true;
  }

  public async disconnect(): Promise<void> {
    this.calls.push({ method: 'disconnect', args: [] });
    this.authenticated = false;
    this.state = null;
  }

  public async getCurrentUser(): Promise<MusicAuthAccount | null> {
    this.calls.push({ method: 'getCurrentUser', args: [] });
    return this.user;
  }

  public async getPlaybackState(): Promise<PlaybackState | null> {
    this.calls.push({ method: 'getPlaybackState', args: [] });
    return this.state;
  }

  public async play(options?: PlayOptions): Promise<void> {
    this.calls.push({ method: 'play', args: [options] });
    if (this.state) {
      this.state.isPlaying = true;
    }
  }

  public async pause(): Promise<void> {
    this.calls.push({ method: 'pause', args: [] });
    if (this.state) {
      this.state.isPlaying = false;
    }
  }

  public async next(): Promise<void> {
    this.calls.push({ method: 'next', args: [] });
  }

  public async previous(): Promise<void> {
    this.calls.push({ method: 'previous', args: [] });
  }

  public async seek(positionMs: number): Promise<void> {
    this.calls.push({ method: 'seek', args: [positionMs] });
    if (this.state) {
      this.state.progressMs = positionMs;
    }
  }

  public async setVolume(volumePercent: number): Promise<void> {
    this.calls.push({ method: 'setVolume', args: [volumePercent] });
    if (this.state) {
      this.state.volume = volumePercent;
    }
  }

  public async setShuffle(shuffle: boolean): Promise<void> {
    this.calls.push({ method: 'setShuffle', args: [shuffle] });
    if (this.state) {
      this.state.shuffle = shuffle;
    }
  }

  public async setRepeatMode(mode: RepeatMode): Promise<void> {
    this.calls.push({ method: 'setRepeatMode', args: [mode] });
    if (this.state) {
      this.state.repeat = mode;
    }
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    this.calls.push({ method: 'getUserPlaylists', args: [] });
    return this.playlists;
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    this.calls.push({ method: 'getPlaylistTracks', args: [playlistId] });
    return [];
  }

  public async search(query: string): Promise<SearchResults> {
    this.calls.push({ method: 'search', args: [query] });
    return this.searchResults;
  }

  public async isLiked(trackId: string): Promise<boolean> {
    this.calls.push({ method: 'isLiked', args: [trackId] });
    return this.likedTracks.has(trackId);
  }

  public async saveTrack(trackId: string): Promise<void> {
    this.calls.push({ method: 'saveTrack', args: [trackId] });
    this.likedTracks.add(trackId);
  }

  public async removeTrack(trackId: string): Promise<void> {
    this.calls.push({ method: 'removeTrack', args: [trackId] });
    this.likedTracks.delete(trackId);
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    this.calls.push({ method: 'getDevices', args: [] });
    return this.devices;
  }

  public async transferPlayback(deviceId: string): Promise<void> {
    this.calls.push({ method: 'transferPlayback', args: [deviceId] });
  }
}

export function makeSampleTrack(overrides?: Partial<Track>): Track {
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

export function makeSamplePlaybackState(overrides?: Partial<PlaybackState>): PlaybackState {
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
