'use strict';

import type * as vscode from 'vscode';
import * as path from 'path';
import {
  PlaybackDevice,
  PlaybackState,
  Playlist,
  PlayOptions,
  RepeatMode,
  SearchResults,
  Track,
} from '../../types';
import { IMusicProvider } from '../musicProvider';

let vscodeModule: any;
try {
  vscodeModule = require('vscode');
} catch {
  vscodeModule = {
    FileType: { File: 1, Directory: 2 },
    Uri: {
      parse: (val: string) => ({
        toString: () => val,
        fsPath: val.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
      }),
      joinPath: (base: any, ...parts: string[]) => {
        const baseStr = typeof base === 'string' ? base : base.toString();
        const joined = [baseStr.replace(/[/\\]$/, ''), ...parts].join('/');
        return {
          toString: () => joined,
          fsPath: joined.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
        };
      },
    },
  };
}

export interface LocalAudioAdapter {
  playFile(uri: string, trackId: string): void;
  pauseAudio(): void;
  resumeAudio(): void;
  seekAudio(positionMs: number): void;
  setVolume(volumePercent: number): void;
}

export type DirectoryReader = (uri: any) => Promise<Array<[string, number]>>;

export interface LocalMusicProviderOptions {
  audioAdapter?: LocalAudioAdapter;
  context?: vscode.ExtensionContext;
  directoryReader?: DirectoryReader;
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

  private audioAdapter?: LocalAudioAdapter;
  private readonly context?: vscode.ExtensionContext;
  private readonly directoryReader?: DirectoryReader;

  constructor(options?: LocalAudioAdapter | LocalMusicProviderOptions, context?: vscode.ExtensionContext) {
    if (options && typeof (options as any).playFile === 'function') {
      this.audioAdapter = options as LocalAudioAdapter;
      this.context = context;
    } else if (options) {
      const opts = options as LocalMusicProviderOptions;
      this.audioAdapter = opts.audioAdapter;
      this.context = opts.context ?? context;
      this.directoryReader = opts.directoryReader;
    } else {
      this.context = context;
    }

    this.loadPersistedState();
    this.rescanAllFolders().catch(() => {});
  }

  public setAudioAdapter(adapter: LocalAudioAdapter): void {
    this.audioAdapter = adapter;
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

  public async rescanAllFolders(): Promise<void> {
    for (const folderUri of this.folderUris) {
      await this.loadFolder(folderUri);
    }
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

  public async getCurrentUser(): Promise<any> {
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
      const trackId = options.uri.startsWith('local:track:')
        ? options.uri.replace('local:track:', '')
        : options.uri;
      const idx = this.queue.findIndex((t) => t.id === trackId || t.uri === trackId);
      if (idx >= 0) {
        this.currentIndex = idx;
      }
    } else if (options?.contextUri) {
      const folderUri = decodeURIComponent(options.contextUri.replace('local:folder:', ''));
      await this.loadFolder(folderUri);
      this.queue = this.tracks.filter((t) => t.album === folderUri);
      this.currentIndex = 0;
    }

    if (this.currentIndex < 0 && this.queue.length > 0) {
      this.currentIndex = 0;
    }

    const track = this.currentTrack;
    if (!track) return;

    if (!options?.uri && !options?.contextUri && !this.isPlayingState) {
      this.isPlayingState = true;
      this.startTime = Date.now();
      this.audioAdapter?.resumeAudio();
      return;
    }

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
    const playlists: Playlist[] = this.folderUris.map((uri, i) => {
      const folderName = path.basename(decodeURIComponent(uri).replace(/[/\\]$/, '')) || uri;
      const count = this.tracks.filter((t) => t.album === uri).length;
      return {
        id: `local-folder-${i}`,
        name: folderName,
        description: uri,
        trackCount: count,
        uri: `local:folder:${encodeURIComponent(uri)}`,
        owner: 'Local Folder',
      };
    });

    const likedCount = this.likedTrackIds.size;
    if (likedCount > 0) {
      playlists.unshift({
        id: 'local-favorites',
        name: 'Liked Tracks',
        description: `${likedCount} favorite track${likedCount !== 1 ? 's' : ''}`,
        trackCount: likedCount,
        uri: 'local:playlist:favorites',
        owner: 'Favorites',
      });
    }

    return playlists;
  }

  public async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    if (playlistId === 'local-favorites') {
      return this.tracks.filter((t) => this.likedTrackIds.has(t.id));
    }
    const idx = parseInt(playlistId.replace('local-folder-', ''), 10);
    if (isNaN(idx) || idx >= this.folderUris.length) return [];
    const folderUri = this.folderUris[idx];
    return this.tracks.filter((t) => t.album === folderUri);
  }

  public async search(query: string): Promise<SearchResults> {
    const q = query.toLowerCase().trim();
    const source = this.tracks.length > 0 ? this.tracks : this.queue;
    if (!q) {
      return { tracks: source, playlists: [], artists: [], albums: [] };
    }
    const matching = source.filter(
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

  public async addFolder(folderUri: string): Promise<Track[]> {
    if (!this.folderUris.includes(folderUri)) {
      this.folderUris.push(folderUri);
      await this.persistFolders();
    }
    return this.loadFolder(folderUri);
  }

  public async removeFolder(folderUri: string): Promise<void> {
    this.folderUris = this.folderUris.filter((u) => u !== folderUri);
    this.tracks = this.tracks.filter((t) => t.album !== folderUri);
    this.queue = this.queue.filter((t) => t.album !== folderUri);
    await this.persistFolders();
  }

  public notifyDuration(durationMs: number, trackUri?: string): void {
    this.durationMs = durationMs;
    if (trackUri) {
      const track = this.tracks.find((t) => t.uri === trackUri);
      if (track) track.durationMs = durationMs;
      const qTrack = this.queue.find((t) => t.uri === trackUri);
      if (qTrack) qTrack.durationMs = durationMs;
    } else if (this.currentTrack) {
      this.currentTrack.durationMs = durationMs;
    }
  }

  public async notifyEnded(): Promise<void> {
    if (this.repeatMode === 'track') {
      this.progressMs = 0;
      this.startTime = Date.now();
      const track = this.currentTrack;
      if (track) this.audioAdapter?.playFile(track.uri, track.id);
    } else if (this.repeatMode === 'context' || this.currentIndex < this.queue.length - 1) {
      await this.next();
    } else {
      this.isPlayingState = false;
      this.progressMs = 0;
      this.startTime = 0;
    }
  }

  public getAllTracks(): Track[] {
    return this.tracks.length > 0 ? this.tracks : this.queue;
  }

  public getLikedTracks(): Track[] {
    const source = this.getAllTracks();
    return source.filter((t) => this.likedTrackIds.has(t.id));
  }

  public getFolderUris(): string[] {
    return this.folderUris;
  }

  public queueAndPlay(tracks: Track[], startIndex: number = 0): void {
    if (this.tracks.length === 0) {
      this.tracks = [...tracks];
    }
    this.queue = tracks;
    this.currentIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
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

  private async scanDirectoryRecursive(
    uri: any,
    depth: number = 0,
    maxDepth: number = 4
  ): Promise<any[]> {
    if (depth > maxDepth) return [];
    try {
      let entries: Array<[string, number]> | undefined;
      if (this.directoryReader) {
        entries = await this.directoryReader(uri);
      } else if (vscodeModule.workspace?.fs) {
        entries = await vscodeModule.workspace.fs.readDirectory(uri);
      }

      if (!entries) return [];

      const audioUris: any[] = [];
      const fileTypeFile = vscodeModule.FileType?.File ?? 1;
      const fileTypeDir = vscodeModule.FileType?.Directory ?? 2;

      for (const [name, type] of entries) {
        if (type === fileTypeFile) {
          const ext = path.extname(name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            audioUris.push(vscodeModule.Uri.joinPath(uri, name));
          }
        } else if (type === fileTypeDir) {
          if (!name.startsWith('.')) {
            const subUris = await this.scanDirectoryRecursive(
              vscodeModule.Uri.joinPath(uri, name),
              depth + 1,
              maxDepth
            );
            audioUris.push(...subUris);
          }
        }
      }
      return audioUris;
    } catch {
      return [];
    }
  }

  private parseTrackMetadata(fileName: string, folderName: string): { name: string; artist: string } {
    let base = path.basename(fileName, path.extname(fileName)).trim();
    base = base.replace(/^\d+[\s.\-_]+/, '');
    if (base.includes(' - ')) {
      const parts = base.split(' - ');
      if (parts.length >= 2) {
        return {
          artist: parts[0].trim(),
          name: parts.slice(1).join(' - ').trim(),
        };
      }
    }
    return {
      artist: folderName,
      name: base,
    };
  }

  public async loadFolder(folderUri: string): Promise<Track[]> {
    try {
      const uri = vscodeModule.Uri.parse(folderUri);
      const audioUris = await this.scanDirectoryRecursive(uri);
      const folderName = path.basename(uri.fsPath || decodeURIComponent(folderUri).replace(/[/\\]$/, ''));

      const folderTracks: Track[] = audioUris.map((fileUri) => {
        const fileUriStr = fileUri.toString();
        const fileName = path.basename(fileUri.fsPath || fileUriStr);
        const { name, artist } = this.parseTrackMetadata(fileName, folderName);
        const id = `local:${fileUriStr}`;
        const existingTrack = this.tracks.find((t) => t.id === id);

        return {
          id,
          name,
          artist,
          artists: [artist],
          album: folderUri,
          durationMs: existingTrack?.durationMs || 0,
          uri: fileUriStr,
        };
      });

      this.tracks = this.tracks.filter((t) => t.album !== folderUri);
      this.tracks.push(...folderTracks);

      if (this.queue.length === 0) {
        this.queue = [...this.tracks];
      }

      return folderTracks;
    } catch (err) {
      console.error('LocalMusicProvider: Failed to load folder', folderUri, err);
      return [];
    }
  }
}
