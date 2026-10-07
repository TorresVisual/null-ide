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

export interface PlaybackState {
  isPlaying: boolean;
  track: Track | null;
  progressMs: number;
  durationMs: number;
  volume: number; // 0 - 100
  shuffle: boolean;
  repeat: RepeatMode;
  timestamp: number;
}

