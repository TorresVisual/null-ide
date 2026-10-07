'use strict';

export type RepeatMode = 'off' | 'track' | 'context';

export interface Track {
  id: string;
  name: string;
  artist: string;
  artists: string[];
  album: string;
  albumArtUrl?: string;
  durationMs: number;
  uri: string;
  isLiked?: boolean;
}

export interface PlaybackDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  track: Track | null;
  progressMs: number;
  durationMs: number;
  volume: number; // 0 - 100
  shuffle: boolean;
  repeat: RepeatMode;
  device?: PlaybackDevice;
  timestamp: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  trackCount: number;
  uri: string;
  owner: string;
  filePath?: string;
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  uri: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  imageUrl?: string;
  uri: string;
  trackCount: number;
}

export interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
  artists: Artist[];
  albums: Album[];
}

export interface MusicAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  tokenType?: string;
  scope?: string;
}

export interface MusicAuthAccount {
  id: string;
  name: string;
  email?: string;
  product?: string; // e.g. 'premium', 'free'
}

export interface PlayOptions {
  uri?: string;
  contextUri?: string;
  offset?: number | { position?: number; uri?: string };
}
