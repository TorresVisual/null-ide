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
  /** Library folder URI this track was scanned from; '' for playlist-only tracks. */
  folder?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** File name of the cover in the art directory (`<content hash>.<jpg|png>`). */
  artKey?: string;
}

/** The slice of `vscode.Memento` the extension uses (kept vscode-free for tests). */
export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
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
