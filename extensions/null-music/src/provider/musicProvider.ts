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
} from '../types';

export interface IMusicProvider {
  readonly id: string;
  readonly displayName: string;

  isAuthenticated(): Promise<boolean>;
  authenticate(): Promise<boolean>;
  disconnect(): Promise<void>;

  getCurrentUser(): Promise<MusicAuthAccount | null>;
  getPlaybackState(): Promise<PlaybackState | null>;

  play(options?: PlayOptions): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volumePercent: number): Promise<void>;
  setShuffle(shuffle: boolean): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<void>;

  getUserPlaylists(): Promise<Playlist[]>;
  getPlaylistTracks(playlistId: string): Promise<Track[]>;
  search(query: string): Promise<SearchResults>;

  isLiked(trackId: string): Promise<boolean>;
  saveTrack(trackId: string): Promise<void>;
  removeTrack(trackId: string): Promise<void>;

  getDevices(): Promise<PlaybackDevice[]>;
  transferPlayback(deviceId: string): Promise<void>;
}
