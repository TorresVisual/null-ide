'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

interface WireTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs: number;
  /** Webview-loadable cover URL, absent when the track has no embedded art. */
  artUrl?: string;
}

interface WirePlayerState {
  isPlaying: boolean;
  track: WireTrack | null;
  liked: boolean;
  progressMs: number;
  durationMs: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  /** Host clock (ms) when progressMs was measured. */
  timestamp: number;
}

interface WireQueueItem {
  key: number;
  track: WireTrack;
}

interface WireFolder {
  uri: string;
  name: string;
  trackCount: number;
}

interface WirePlaylist {
  id: string;
  name: string;
  /** Carried in full: a playlist can hold files that are not in any library folder. */
  tracks: WireTrack[];
}

type HostToWebview =
  | { type: 'player'; state: WirePlayerState; unavailable: string[] }
  | { type: 'queue'; history: WireQueueItem[]; current: WireQueueItem | null; upcoming: WireQueueItem[]; reorderable: boolean }
  | { type: 'library'; tracks: WireTrack[]; folders: WireFolder[]; playlists: WirePlaylist[]; scan: { scanned: number; total: number; active: boolean }; extensions: string[] }
  | { type: 'liked'; ids: string[] }
  // audio element commands (owned by WebviewAudioOutput; unchanged from the engine)
  | { type: 'localLoad'; uri: string; trackUri: string; startMs: number; autoplay: boolean }
  | { type: 'localPause' }
  | { type: 'localResume' }
  | { type: 'localSeek'; positionMs: number }
  | { type: 'localVolume'; volumePercent: number };

type WebviewToHost =
  | { type: 'ready' }
  // transport
  | { type: 'playPause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volumePercent: number }
  | { type: 'toggleShuffle' }
  | { type: 'toggleRepeat' }
  // library
  | { type: 'playTracks'; ids: string[]; startId: string; shuffle?: boolean }
  | { type: 'toggleLike'; trackId?: string } // no id = the current track
  // queue
  | { type: 'queuePlayNext'; trackId: string }
  | { type: 'queueAdd'; trackId: string }
  | { type: 'queueRemove'; key: number }
  | { type: 'queueMove'; key: number; beforeKey: number | null }
  | { type: 'queueClear' }
  | { type: 'queueJump'; key: number }
  // setup
  | { type: 'addFolder' }
  | { type: 'importPlaylist' }
  | { type: 'removeFolder'; uri: string }
  | { type: 'removePlaylist'; id: string }
  | { type: 'rescan' }
  // audio element events (consumed by WebviewAudioOutput; unchanged from the engine)
  | { type: 'localAudioPlayStarted' }
  | { type: 'localAudioPaused'; positionMs: number; trackUri?: string }
  | { type: 'localAudioTimeUpdate'; positionMs: number; trackUri?: string }
  | { type: 'localAudioDuration'; durationMs: number; trackUri?: string }
  | { type: 'localAudioEnded'; trackUri?: string }
  | { type: 'localAudioError'; error: string; trackUri?: string }
  | { type: 'localAudioPlayFailed'; error: string; trackUri?: string; silent?: boolean };
