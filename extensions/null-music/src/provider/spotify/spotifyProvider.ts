'use strict';

import { SpotifyAuth } from '../../auth/spotifyAuth';
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
import { IMusicProvider } from '../musicProvider';
import { SpotifyApi } from './spotifyApi';

export class SpotifyProvider implements IMusicProvider {
  public readonly id = 'spotify';
  public readonly displayName = 'Spotify';
  private readonly api: SpotifyApi;

  constructor(
    private readonly auth: SpotifyAuth,
    apiOverride?: SpotifyApi
  ) {
    this.api =
      apiOverride ??
      new SpotifyApi({
        getAccessToken: () => this.auth.getValidAccessToken(),
      });
  }

  public async isAuthenticated(): Promise<boolean> {
    return this.auth.isAuthenticated();
  }

  public async authenticate(): Promise<boolean> {
    return this.auth.login();
  }

  public async disconnect(): Promise<void> {
    await this.auth.logout();
  }

  public async getCurrentUser(): Promise<MusicAuthAccount | null> {
    return this.api.getCurrentUser();
  }

  public async getPlaybackState(): Promise<PlaybackState | null> {
    const state = await this.api.getPlaybackState();
    if (state?.track?.id) {
      try {
        state.track.isLiked = await this.api.isLiked(state.track.id);
      } catch {
        // Liked status is non-critical
      }
    }
    return state;
  }

  public async play(options?: PlayOptions): Promise<void> {
    await this.api.play(options);
  }

  public async pause(): Promise<void> {
    await this.api.pause();
  }

  public async next(): Promise<void> {
    await this.api.next();
  }

  public async previous(): Promise<void> {
    await this.api.previous();
  }

  public async seek(positionMs: number): Promise<void> {
    await this.api.seek(positionMs);
  }

  public async setVolume(volumePercent: number): Promise<void> {
    await this.api.setVolume(volumePercent);
  }

  public async setShuffle(shuffle: boolean): Promise<void> {
    await this.api.setShuffle(shuffle);
  }

  public async setRepeatMode(mode: RepeatMode): Promise<void> {
    await this.api.setRepeatMode(mode);
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    return this.api.getUserPlaylists();
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    return this.api.getPlaylistTracks(playlistId);
  }

  public async search(query: string): Promise<SearchResults> {
    return this.api.search(query);
  }

  public async isLiked(trackId: string): Promise<boolean> {
    return this.api.isLiked(trackId);
  }

  public async saveTrack(trackId: string): Promise<void> {
    await this.api.saveTrack(trackId);
  }

  public async removeTrack(trackId: string): Promise<void> {
    await this.api.removeTrack(trackId);
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    return this.api.getDevices();
  }

  public async transferPlayback(deviceId: string): Promise<void> {
    await this.api.transferPlayback(deviceId);
  }
}
