'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
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

export interface LocalAudioAdapter {
  playFile(uri: string, trackId: string): void;
  pauseAudio(): void;
  resumeAudio(): void;
  seekAudio(positionMs: number): void;
  setVolume(volumePercent: number): void;
}

const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma'];

export class LocalMusicProvider implements IMusicProvider {
  public readonly id = 'local';
  public readonly displayName = 'Local Music';

  private tracks: Track[] = [];
  private queue: Track[] = [];
  private currentIndex: number = -1;
  private isPlayingState: boolean = false;
  private volume: number = 80;
  private shuffleState: boolean = false;
  private repeatMode: RepeatMode = 'off';
  private progressMs: number = 0;
  private durationMs: number = 0;
  private startTime: number = 0;
  private readonly likedTrackIds = new Set<string>();
  private folderUris: string[] = [];

  constructor(
    private readonly audioAdapter?: LocalAudioAdapter,
    private readonly context?: vscode.ExtensionContext
  ) {
    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    if (!this.context) return;
    try {
      const saved = this.context.globalState.get<string[]>('null-music.local.folders', []);
      this.folderUris = saved;
      const liked = this.context.globalState.get<string[]>('null-music.local.liked', []);
      liked.forEach((id) => this.likedTrackIds.add(id));
    } catch (_) {}
  }

  private async persistFolders(): Promise<void> {
    if (!this.context) return;
    await this.context.globalState.update('null-music.local.folders', this.folderUris);
  }

  private async persistLiked(): Promise<void> {
    if (!this.context) return;
    await this.context.globalState.update('null-music.local.liked', Array.from(this.likedTrackIds));
  }

  // ─── IMusicProvider ──────────────────────────────────────────────────────────

  public async isAuthenticated(): Promise<boolean> {
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
      id: 'local-user',
      name: 'Local Library',
      product: 'local',
    };
  }

  public async getPlaybackState(): Promise<PlaybackState | null> {
    const track = this.currentTrack;
    if (!track) {
      return {
        isPlaying: false,
        track: null,
        progressMs: 0,
        durationMs: 0,
        volume: this.volume,
        shuffle: this.shuffleState,
        repeat: this.repeatMode,
        device: this.builtInDevice,
        timestamp: Date.now(),
      };
    }

    const elapsed =
      this.isPlayingState && this.startTime > 0 ? Date.now() - this.startTime : 0;
    const currentProgress = Math.min(this.durationMs || Infinity, this.progressMs + elapsed);

    return {
      isPlaying: this.isPlayingState,
      track: { ...track, isLiked: this.likedTrackIds.has(track.id) },
      progressMs: currentProgress,
      durationMs: this.durationMs,
      volume: this.volume,
      shuffle: this.shuffleState,
      repeat: this.repeatMode,
      device: this.builtInDevice,
      timestamp: Date.now(),
    };
  }

  public async play(options?: PlayOptions): Promise<void> {
    if (options?.uri) {
      // Play a specific track by URI (local:track:<id>)
      const trackId = options.uri.replace('local:track:', '');
      const idx = this.queue.findIndex((t) => t.id === trackId);
      if (idx >= 0) {
        this.currentIndex = idx;
      }
    } else if (options?.contextUri) {
      // Play a "playlist" (folder) by URI (local:folder:<folderUri>)
      const folderUri = decodeURIComponent(options.contextUri.replace('local:folder:', ''));
      await this.loadFolder(folderUri);
      this.currentIndex = 0;
    }

    if (this.currentIndex < 0 && this.queue.length > 0) {
      this.currentIndex = 0;
    }

    const track = this.currentTrack;
    if (!track) return;

    this.isPlayingState = true;
    this.progressMs = 0;
    this.startTime = Date.now();

    this.audioAdapter?.playFile(track.uri, track.id);
  }

  public async pause(): Promise<void> {
    if (this.isPlayingState && this.startTime > 0) {
      this.progressMs = Math.min(
        this.durationMs || Infinity,
        this.progressMs + (Date.now() - this.startTime)
      );
    }
    this.isPlayingState = false;
    this.startTime = 0;
    this.audioAdapter?.pauseAudio();
  }

  public async next(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.shuffleState) {
      this.currentIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    }
    this.progressMs = 0;
    this.durationMs = 0;
    if (this.isPlayingState) {
      this.startTime = Date.now();
      const track = this.currentTrack!;
      this.audioAdapter?.playFile(track.uri, track.id);
    }
  }

  public async previous(): Promise<void> {
    if (this.queue.length === 0) return;
    // If past 3 seconds, restart; otherwise go back
    const elapsed =
      this.isPlayingState && this.startTime > 0 ? Date.now() - this.startTime : 0;
    if (this.progressMs + elapsed > 3000) {
      this.progressMs = 0;
      this.startTime = Date.now();
      const track = this.currentTrack;
      if (track) this.audioAdapter?.playFile(track.uri, track.id);
      return;
    }

    if (this.shuffleState) {
      this.currentIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
    }
    this.progressMs = 0;
    this.durationMs = 0;
    if (this.isPlayingState) {
      this.startTime = Date.now();
      const track = this.currentTrack!;
      this.audioAdapter?.playFile(track.uri, track.id);
    }
  }

  public async seek(positionMs: number): Promise<void> {
    this.progressMs = positionMs;
    this.startTime = this.isPlayingState ? Date.now() : 0;
    this.audioAdapter?.seekAudio(positionMs);
  }

  public async setVolume(volumePercent: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, volumePercent));
    this.audioAdapter?.setVolume(this.volume);
  }

  public async setShuffle(shuffle: boolean): Promise<void> {
    this.shuffleState = shuffle;
  }

  public async setRepeatMode(mode: RepeatMode): Promise<void> {
    this.repeatMode = mode;
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    return this.folderUris.map((uri, i) => ({
      id: `local-folder-${i}`,
      name: path.basename(uri),
      description: uri,
      trackCount: this.tracks.filter((t) => t.album === uri).length,
      uri: `local:folder:${encodeURIComponent(uri)}`,
      owner: 'Local Library',
    }));
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const idx = parseInt(playlistId.replace('local-folder-', ''), 10);
    if (isNaN(idx) || idx >= this.folderUris.length) return [];
    const folderUri = this.folderUris[idx];
    return this.tracks.filter((t) => t.album === folderUri);
  }

  public async search(query: string): Promise<SearchResults> {
    const q = query.toLowerCase().trim();
    const matching = this.tracks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
    return { tracks: matching, playlists: [], artists: [], albums: [] };
  }

  public async isLiked(trackId: string): Promise<boolean> {
    return this.likedTrackIds.has(trackId);
  }

  public async saveTrack(trackId: string): Promise<void> {
    this.likedTrackIds.add(trackId);
    await this.persistLiked();
  }

  public async removeTrack(trackId: string): Promise<void> {
    this.likedTrackIds.delete(trackId);
    await this.persistLiked();
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    return [this.builtInDevice];
  }

  public async transferPlayback(_deviceId: string): Promise<void> {}

  // ─── Local-specific public API ────────────────────────────────────────────

  /** Called by the extension host after a folder is picked via the file picker. */
  public async addFolder(folderUri: string): Promise<Track[]> {
    if (!this.folderUris.includes(folderUri)) {
      this.folderUris.push(folderUri);
      await this.persistFolders();
    }
    return this.loadFolder(folderUri);
  }

  /** Remove a previously added folder. */
  public async removeFolder(folderUri: string): Promise<void> {
    this.folderUris = this.folderUris.filter((u) => u !== folderUri);
    this.tracks = this.tracks.filter((t) => t.album !== folderUri);
    this.queue = this.queue.filter((t) => t.album !== folderUri);
    await this.persistFolders();
  }

  /** Called by webview audio events to keep state in sync. */
  public notifyDuration(durationMs: number): void {
    this.durationMs = durationMs;
  }

  /** Called when audio ends naturally. */
  public async notifyEnded(): Promise<void> {
    if (this.repeatMode === 'track') {
      this.progressMs = 0;
      this.startTime = Date.now();
      const track = this.currentTrack;
      if (track) this.audioAdapter?.playFile(track.uri, track.id);
    } else if (this.repeatMode === 'context' || this.currentIndex < this.queue.length - 1) {
      await this.next();
    } else {
      // End of queue, stop
      this.isPlayingState = false;
      this.progressMs = 0;
      this.startTime = 0;
    }
  }

  public getAllTracks(): Track[] {
    return this.tracks;
  }

  public getFolderUris(): string[] {
    return this.folderUris;
  }

  /** Queue a specific set of tracks starting at the given index. */
  public queueAndPlay(tracks: Track[], startIndex: number = 0): void {
    this.queue = tracks;
    this.currentIndex = startIndex;
    this.progressMs = 0;
    this.durationMs = 0;
    this.isPlayingState = true;
    this.startTime = Date.now();
    const track = this.currentTrack;
    if (track) this.audioAdapter?.playFile(track.uri, track.id);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private get currentTrack(): Track | undefined {
    return this.queue[this.currentIndex];
  }

  private get builtInDevice(): PlaybackDevice {
    return {
      id: 'null-local-player',
      name: 'Null IDE Local Player',
      type: 'Local',
      isActive: true,
      volumePercent: this.volume,
    };
  }

  private async loadFolder(folderUri: string): Promise<Track[]> {
    try {
      const uri = vscode.Uri.parse(folderUri);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const audioEntries = entries.filter(([name, type]) => {
        if (type !== vscode.FileType.File) return false;
        const ext = path.extname(name).toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
      });

      const folderTracks: Track[] = audioEntries.map(([name]) => {
        const fileUri = vscode.Uri.joinPath(uri, name).toString();
        const trackName = path.basename(name, path.extname(name));
        const id = `local:${fileUri}`;
        return {
          id,
          name: trackName,
          artist: path.basename(folderUri),
          artists: [path.basename(folderUri)],
          album: folderUri,
          durationMs: 0,
          uri: fileUri,
        };
      });

      // Merge: remove old tracks from this folder and add new ones
      this.tracks = this.tracks.filter((t) => t.album !== folderUri);
      this.tracks.push(...folderTracks);

      // Also update queue if it was from this folder
      if (this.queue.length > 0 && this.queue[0]?.album === folderUri) {
        this.queue = folderTracks;
        this.currentIndex = 0;
      } else if (this.queue.length === 0) {
        this.queue = [...this.tracks];
      }

      return folderTracks;
    } catch (err) {
      console.error('LocalMusicProvider: Failed to load folder', folderUri, err);
      return [];
    }
  }
}
