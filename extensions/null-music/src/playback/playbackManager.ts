'use strict';

import { IMusicProvider } from '../provider/musicProvider';
import { PlaybackDevice, PlaybackState, Playlist, PlayOptions, RepeatMode, SearchResults, Track } from '../types';

export type PlaybackStateListener = (state: PlaybackState | null) => void;
export type TrackChangeListener = (track: Track | null) => void;

export interface PlaybackManagerOptions {
  provider: IMusicProvider;
  getPollingIntervalMs?: () => number;
  onNotification?: (message: string) => void;
}

export class PlaybackManager {
  private readonly provider: IMusicProvider;
  private readonly getPollingIntervalMs: () => number;
  private readonly onNotification?: (message: string) => void;

  private currentState: PlaybackState | null = null;
  private lastTrackId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private isDisposed: boolean = false;
  private isPollingActive: boolean = false;

  private readonly stateListeners: Set<PlaybackStateListener> = new Set();
  private readonly trackChangeListeners: Set<TrackChangeListener> = new Set();

  constructor(options: PlaybackManagerOptions) {
    this.provider = options.provider;
    this.getPollingIntervalMs = options.getPollingIntervalMs ?? (() => 2500);
    this.onNotification = options.onNotification;

    this.startPolling();
  }

  public get activeProvider(): IMusicProvider {
    return this.provider;
  }

  public getCurrentState(): PlaybackState | null {
    if (!this.currentState) {
      return null;
    }

    if (this.currentState.isPlaying && this.currentState.timestamp > 0) {
      const elapsed = Date.now() - this.currentState.timestamp;
      const interpolatedProgress = Math.min(
        this.currentState.durationMs || Infinity,
        this.currentState.progressMs + elapsed
      );
      return {
        ...this.currentState,
        progressMs: interpolatedProgress,
      };
    }

    return this.currentState;
  }

  public onDidChangePlaybackState(listener: PlaybackStateListener): { dispose: () => void } {
    this.stateListeners.add(listener);
    return {
      dispose: () => this.stateListeners.delete(listener),
    };
  }

  public onDidTrackChange(listener: TrackChangeListener): { dispose: () => void } {
    this.trackChangeListeners.add(listener);
    return {
      dispose: () => this.trackChangeListeners.delete(listener),
    };
  }

  public async refreshNow(): Promise<PlaybackState | null> {
    try {
      const isAuth = await this.provider.isAuthenticated();
      if (!isAuth) {
        this.updateState(null);
        return null;
      }

      const state = await this.provider.getPlaybackState();
      this.updateState(state);
      return state;
    } catch {
      return this.currentState;
    }
  }

  private updateState(newState: PlaybackState | null): void {
    const previousTrackId = this.lastTrackId;
    this.currentState = newState;
    const currentTrackId = newState?.track?.id ?? null;

    for (const listener of this.stateListeners) {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('Error in onDidChangePlaybackState listener:', err);
      }
    }

    if (currentTrackId !== previousTrackId) {
      this.lastTrackId = currentTrackId;
      for (const listener of this.trackChangeListeners) {
        try {
          listener(newState?.track ?? null);
        } catch (err) {
          console.error('Error in onDidTrackChange listener:', err);
        }
      }

      if (newState?.track && this.onNotification) {
        this.onNotification(`Now Playing: ${newState.track.name} • ${newState.track.artist}`);
      }
    }
  }

  public startPolling(): void {
    if (this.isPollingActive || this.isDisposed) {
      return;
    }
    this.isPollingActive = true;

    const tick = async () => {
      if (this.isDisposed) {
        return;
      }
      await this.refreshNow();
      if (!this.isDisposed && this.isPollingActive) {
        const interval = Math.max(1000, this.getPollingIntervalMs());
        this.pollTimer = setTimeout(tick, interval);
      }
    };

    tick();
  }

  public stopPolling(): void {
    this.isPollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async playPause(): Promise<void> {
    if (this.currentState?.isPlaying) {
      await this.provider.pause();
    } else {
      await this.provider.play();
    }
    await this.refreshNow();
  }

  public async play(options?: PlayOptions): Promise<void> {
    await this.provider.play(options);
    await this.refreshNow();
  }

  public async pause(): Promise<void> {
    await this.provider.pause();
    await this.refreshNow();
  }

  public async next(): Promise<void> {
    await this.provider.next();
    await this.refreshNow();
  }

  public async previous(): Promise<void> {
    await this.provider.previous();
    await this.refreshNow();
  }

  public async seek(positionMs: number): Promise<void> {
    await this.provider.seek(positionMs);
    if (this.currentState) {
      this.currentState.progressMs = positionMs;
      this.currentState.timestamp = Date.now();
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async setVolume(volumePercent: number): Promise<void> {
    await this.provider.setVolume(volumePercent);
    if (this.currentState) {
      this.currentState.volume = Math.max(0, Math.min(100, volumePercent));
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async volumeUp(step: number = 10): Promise<void> {
    const currentVol = this.currentState?.volume ?? 50;
    const target = Math.min(100, currentVol + step);
    await this.setVolume(target);
  }

  public async volumeDown(step: number = 10): Promise<void> {
    const currentVol = this.currentState?.volume ?? 50;
    const target = Math.max(0, currentVol - step);
    await this.setVolume(target);
  }

  public async toggleShuffle(): Promise<void> {
    const nextState = !this.currentState?.shuffle;
    await this.provider.setShuffle(nextState);
    if (this.currentState) {
      this.currentState.shuffle = nextState;
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async toggleRepeat(): Promise<void> {
    const modes: RepeatMode[] = ['off', 'context', 'track'];
    const currentMode = this.currentState?.repeat || 'off';
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    const nextMode = modes[nextIndex];

    await this.provider.setRepeatMode(nextMode);
    if (this.currentState) {
      this.currentState.repeat = nextMode;
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async toggleLike(): Promise<boolean> {
    const track = this.currentState?.track;
    if (!track?.id) {
      return false;
    }

    const currentLiked = !!track.isLiked;
    if (currentLiked) {
      await this.provider.removeTrack(track.id);
      track.isLiked = false;
    } else {
      await this.provider.saveTrack(track.id);
      track.isLiked = true;
    }

    this.updateState(this.currentState);
    return !currentLiked;
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    return this.provider.getUserPlaylists();
  }

  public async search(query: string): Promise<SearchResults> {
    return this.provider.search(query);
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    return this.provider.getDevices();
  }

  public async transferPlayback(deviceId: string): Promise<void> {
    await this.provider.transferPlayback(deviceId);
    await this.refreshNow();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopPolling();
    this.stateListeners.clear();
    this.trackChangeListeners.clear();
  }
}
