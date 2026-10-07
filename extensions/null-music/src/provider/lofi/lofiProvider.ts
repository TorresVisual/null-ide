'use strict';

import {
  MusicAuthAccount,
  PlaybackDevice,
  PlaybackState,
  Playlist,
  PlayOptions,
  RepeatMode,
  SearchResults,
  Track,
} from '../../types';
import { IMusicProvider } from '../musicProvider';
import { LOFI_STATIONS, LofiStation } from './stations';

export interface StreamAudioAdapter {
  playStream(url: string): void;
  pauseStream(): void;
  setVolume(volumePercent: number): void;
}

export class LofiProvider implements IMusicProvider {
  public readonly id = 'lofi';
  public readonly displayName = 'Null Lo-Fi Radio';

  private currentStationIndex: number = 0;
  private isPlaying: boolean = false;
  private volume: number = 80;
  private startTime: number = 0;
  private readonly likedStationIds = new Set<string>();

  constructor(private audioAdapter?: StreamAudioAdapter) {}

  public setAudioAdapter(adapter: StreamAudioAdapter): void {
    this.audioAdapter = adapter;
  }

  public async isAuthenticated(): Promise<boolean> {
    // 100% free, no login or account required
    return true;
  }

  public async authenticate(): Promise<boolean> {
    return true;
  }

  public async disconnect(): Promise<void> {
    await this.pause();
  }

  public async getCurrentUser(): Promise<MusicAuthAccount | null> {
    return {
      id: 'null-coder',
      name: 'Null IDE Free Radio',
      product: 'free-stream',
    };
  }

  public async getPlaybackState(): Promise<PlaybackState | null> {
    const station = LOFI_STATIONS[this.currentStationIndex] || LOFI_STATIONS[0];
    const track: Track = {
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

    const device: PlaybackDevice = {
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

  public async play(options?: PlayOptions): Promise<void> {
    if (options?.contextUri || options?.uri) {
      const targetUri = options.contextUri || options.uri || '';
      const stationId = targetUri.replace('lofi:station:', '').replace('lofi:playlist:', '');
      const idx = LOFI_STATIONS.findIndex((s) => s.id === stationId);
      if (idx >= 0) {
        this.currentStationIndex = idx;
      }
    }

    this.isPlaying = true;
    this.startTime = Date.now();
    const station = LOFI_STATIONS[this.currentStationIndex] || LOFI_STATIONS[0];
    this.audioAdapter?.playStream(station.streamUrl);
  }

  public async pause(): Promise<void> {
    this.isPlaying = false;
    this.audioAdapter?.pauseStream();
  }

  public async next(): Promise<void> {
    this.currentStationIndex = (this.currentStationIndex + 1) % LOFI_STATIONS.length;
    if (this.isPlaying) {
      await this.play();
    }
  }

  public async previous(): Promise<void> {
    this.currentStationIndex = (this.currentStationIndex - 1 + LOFI_STATIONS.length) % LOFI_STATIONS.length;
    if (this.isPlaying) {
      await this.play();
    }
  }

  public async seek(_positionMs: number): Promise<void> {
    // Live radio stream cannot be seeked
  }

  public async setVolume(volumePercent: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, volumePercent));
    this.audioAdapter?.setVolume(this.volume);
  }

  public async setShuffle(_shuffle: boolean): Promise<void> {}

  public async setRepeatMode(_mode: RepeatMode): Promise<void> {}

  public async getUserPlaylists(): Promise<Playlist[]> {
    return LOFI_STATIONS.map((s) => ({
      id: s.id,
      name: s.name,
      description: `${s.genre} — ${s.description}`,
      imageUrl: s.imageUrl,
      trackCount: 1,
      uri: `lofi:station:${s.id}`,
      owner: 'Null Radio',
    }));
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const station = LOFI_STATIONS.find((s) => s.id === playlistId);
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

  public async search(query: string): Promise<SearchResults> {
    const q = query.toLowerCase().trim();
    const matching = LOFI_STATIONS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );

    const tracks: Track[] = matching.map((s) => ({
      id: s.id,
      name: s.name,
      artist: s.genre,
      artists: [s.genre],
      album: s.description,
      albumArtUrl: s.imageUrl,
      durationMs: 0,
      uri: `lofi:station:${s.id}`,
    }));

    const playlists: Playlist[] = matching.map((s) => ({
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

  public async isLiked(trackId: string): Promise<boolean> {
    return this.likedStationIds.has(trackId);
  }

  public async saveTrack(trackId: string): Promise<void> {
    this.likedStationIds.add(trackId);
  }

  public async removeTrack(trackId: string): Promise<void> {
    this.likedStationIds.delete(trackId);
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
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

  public async transferPlayback(_deviceId: string): Promise<void> {}
}
