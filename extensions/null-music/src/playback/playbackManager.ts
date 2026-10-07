'use strict';

import { IMusicProvider } from '../provider/musicProvider';
import { ProviderRegistry } from '../provider/providerRegistry';
import { PlaybackDevice, PlaybackState, Playlist, PlayOptions, RepeatMode, SearchResults, Track } from '../types';

export type PlaybackStateListener = (state: PlaybackState | null) => void;
export type TrackChangeListener = (track: Track | null) => void;

export interface PlaybackManagerOptions {
  providerRegistry: ProviderRegistry;
  getPollingIntervalMs?: () => number;
  onNotification?: (message: string) => void;
}

export class PlaybackManager {
  private readonly providerRegistry: ProviderRegistry;
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
    this.providerRegistry = options.providerRegistry;
    this.getPollingIntervalMs = options.getPollingIntervalMs ?? (() => 2500);
    this.onNotification = options.onNotification;

    this.providerRegistry.onDidChangeActiveProvider(() => {
      this.refreshNow();
    });

    this.startPolling();
  }

  public get activeProvider(): IMusicProvider | null {
    return this.providerRegistry.getActiveProvider();
  }

  public getCurrentState(): PlaybackState | null {
    if (!this.currentState) {
      return null;
    }

    // Interpolate progress if currently playing
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
    const provider = this.activeProvider;
    if (!provider) {
      this.updateState(null);
      return null;
    }

    try {
      const isAuth = await provider.isAuthenticated();
      if (!isAuth) {
        this.updateState(null);
        return null;
      }

      const state = await provider.getPlaybackState();
      this.updateState(state);
      return state;
    } catch (err: any) {
      // Don't clear state on transient network blip
      return this.currentState;
    }
  }

  private updateState(newState: PlaybackState | null): void {
    const previousTrackId = this.lastTrackId;
    this.currentState = newState;
    const currentTrackId = newState?.track?.id ?? null;

    // Fire state listeners
    for (const listener of this.stateListeners) {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('Error in onDidChangePlaybackState listener:', err);
      }
    }

    // Fire track change listeners if song changed
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
    const provider = this.ensureActiveProvider();
    if (this.currentState?.isPlaying) {
      await provider.pause();
    } else {
      await provider.play();
    }
    await this.refreshNow();
  }

  public async play(options?: PlayOptions): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.play(options);
    await this.refreshNow();
  }

  public async pause(): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.pause();
    await this.refreshNow();
  }

  public async next(): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.next();
    await this.refreshNow();
  }

  public async previous(): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.previous();
    await this.refreshNow();
  }

  public async seek(positionMs: number): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.seek(positionMs);
    if (this.currentState) {
      this.currentState.progressMs = positionMs;
      this.currentState.timestamp = Date.now();
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async setVolume(volumePercent: number): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.setVolume(volumePercent);
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
    const provider = this.ensureActiveProvider();
    const nextState = !this.currentState?.shuffle;
    await provider.setShuffle(nextState);
    if (this.currentState) {
      this.currentState.shuffle = nextState;
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async toggleRepeat(): Promise<void> {
    const provider = this.ensureActiveProvider();
    const modes: RepeatMode[] = ['off', 'context', 'track'];
    const currentMode = this.currentState?.repeat || 'off';
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    const nextMode = modes[nextIndex];

    await provider.setRepeatMode(nextMode);
    if (this.currentState) {
      this.currentState.repeat = nextMode;
      this.updateState(this.currentState);
    }
    await this.refreshNow();
  }

  public async toggleLike(): Promise<boolean> {
    const provider = this.ensureActiveProvider();
    const track = this.currentState?.track;
    if (!track?.id) {
      return false;
    }

    const currentLiked = !!track.isLiked;
    if (currentLiked) {
      await provider.removeTrack(track.id);
      track.isLiked = false;
    } else {
      await provider.saveTrack(track.id);
      track.isLiked = true;
    }

    this.updateState(this.currentState);
    return !currentLiked;
  }

  public async getUserPlaylists(): Promise<Playlist[]> {
    const provider = this.ensureActiveProvider();
    return provider.getUserPlaylists();
  }

  public async search(query: string): Promise<SearchResults> {
    const provider = this.ensureActiveProvider();
    return provider.search(query);
  }

  public async getDevices(): Promise<PlaybackDevice[]> {
    const provider = this.ensureActiveProvider();
    return provider.getDevices();
  }

  public async transferPlayback(deviceId: string): Promise<void> {
    const provider = this.ensureActiveProvider();
    await provider.transferPlayback(deviceId);
    await this.refreshNow();
  }

  private ensureActiveProvider(): IMusicProvider {
    const provider = this.activeProvider;
    if (!provider) {
      throw new Error('No active music provider available');
    }
    return provider;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopPolling();
    this.stateListeners.clear();
    this.trackChangeListeners.clear();
  }
}
