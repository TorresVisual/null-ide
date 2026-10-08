'use strict';

import { Disposable, Emitter, Event } from '../emitter';
import { PlaybackState, RepeatMode, Track } from '../types';
import { AudioEvent, AudioOutput } from './audioOutput';
import { Queue } from './queue';
import { SessionData, SessionStore } from './sessionStore';

const READY_TIMEOUT_MS = 5000;
const RESTART_THRESHOLD_MS = 3000;
const SAVE_INTERVAL_MS = 3000;
const DURATION_EPSILON_MS = 500;

export interface PlayerDeps {
  output: AudioOutput;
  session?: SessionStore;
  isLiked?(trackId: string): boolean;
  /** Used when Play is pressed with an empty queue. */
  defaultQueue?(): Track[];
  onDuration?(track: Track, durationMs: number): void;
  onSkipped?(consecutiveSkips: number): void;
  onError?(message: string): void;
}

/**
 * Owns the queue and the one playback clock. `isPlaying` flips true only when the
 * output reports `play`; until then a requested play is `pending`.
 */
export class Player {
  private readonly changeEmitter = new Emitter<void>();
  private readonly trackEmitter = new Emitter<Track | null>();
  readonly onDidChange: Event<void> = this.changeEmitter.event;
  readonly onDidChangeTrack: Event<Track | null> = this.trackEmitter.event;

  private volume = 80;
  private positionMs = 0;
  private positionAt = 0;
  private durationMs = 0;
  private playing = false;
  private pending = false;
  private loadedId: string | undefined;
  private skipStreak = 0;
  private lastTrackId: string | null = null;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly subscription: Disposable;

  constructor(private readonly deps: PlayerDeps, readonly queue: Queue = new Queue()) {
    this.subscription = deps.output.onEvent((e) => this.handle(e));
  }

  private get output(): AudioOutput {
    return this.deps.output;
  }

  getState(): PlaybackState {
    const track = this.queue.current;
    return {
      isPlaying: this.playing,
      track: track ? { ...track, isLiked: this.deps.isLiked?.(track.id) ?? false } : null,
      progressMs: this.positionMs,
      durationMs: track ? this.durationMs || track.durationMs : 0,
      volume: this.volume,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
      timestamp: this.positionAt,
    };
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    this.skipStreak = 0;
    this.queue.replace(tracks, startIndex);
    await this.startCurrent(true, 0, true);
  }

  async play(): Promise<void> {
    if (!this.queue.current) {
      this.queue.replace(this.deps.defaultQueue?.() ?? [], 0);
      if (!this.queue.current) return;
    }
    await this.startCurrent(true, this.positionMs, false);
  }

  pause(): void {
    this.pending = false;
    this.playing = false;
    if (this.output.isReady) this.output.pause();
    this.changed();
  }

  async playPause(): Promise<void> {
    if (this.playing || this.pending) this.pause();
    else await this.play();
  }

  async next(): Promise<void> {
    const autoplay = this.playing || this.pending;
    if (!this.queue.next()) {
      this.stopAtEnd();
      return;
    }
    this.skipStreak = 0;
    await this.startCurrent(autoplay, 0, true);
  }

  async previous(): Promise<void> {
    const autoplay = this.playing || this.pending;
    if (this.positionMs <= RESTART_THRESHOLD_MS && this.queue.previous()) {
      await this.startCurrent(autoplay, 0, true);
      return;
    }
    this.seek(0);
  }

  seek(positionMs: number): void {
    this.positionMs = Math.max(0, positionMs);
    this.positionAt = Date.now();
    if (this.output.isReady && this.loadedId === this.queue.current?.id) this.output.seek(this.positionMs);
    this.changed();
  }

  setVolume(volumePercent: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(volumePercent)));
    if (this.output.isReady) this.output.setVolume(this.volume);
    this.changed();
  }

  adjustVolume(delta: number): void {
    this.setVolume(this.volume + delta);
  }

  toggleShuffle(): void {
    this.queue.setShuffle(!this.queue.shuffle);
    this.changed();
  }

  toggleRepeat(): void {
    const order: RepeatMode[] = ['off', 'context', 'track'];
    this.queue.repeat = order[(order.indexOf(this.queue.repeat) + 1) % order.length];
    this.changed();
  }

  playNext(track: Track): void {
    this.queue.playNext(track);
    this.changed();
  }

  addToQueue(track: Track): void {
    this.queue.add(track);
    this.changed();
  }

  /** Re-emit state (e.g. after a like toggled). */
  refresh(): void {
    this.changed();
  }

  // ─── Session ───────────────────────────────────────────────────────────────

  /** Restore a saved session, paused. `resolve` maps saved ids to tracks; unknown ids are dropped. */
  restore(session: SessionData, resolve: (id: string) => Track | undefined): void {
    const tracks: Track[] = [];
    let start = 0;
    let currentSurvived = false;
    session.trackIds.forEach((id, i) => {
      const t = resolve(id);
      if (!t) return;
      if (i === session.index) {
        start = tracks.length;
        currentSurvived = true;
      }
      tracks.push(t);
    });
    this.queue.replace(tracks, start);
    this.queue.setShuffle(session.shuffle);
    this.queue.repeat = session.repeat;
    this.volume = session.volume;
    this.positionMs = currentSurvived ? session.positionMs : 0;
    this.positionAt = Date.now();
    this.durationMs = this.queue.current?.durationMs ?? 0;
    this.lastTrackId = this.queue.current?.id ?? null; // restoring is not a track change
    this.playing = false;
    this.pending = false;
    if (this.output.isReady) this.syncOutput();
    this.changeEmitter.fire();
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.deps.session?.save({
      trackIds: this.queue.tracks.map((t) => t.id),
      index: this.queue.index,
      positionMs: this.positionMs,
      volume: this.volume,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
    });
  }

  dispose(): void {
    this.flush();
    this.subscription.dispose();
    this.changeEmitter.dispose();
    this.trackEmitter.dispose();
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** Make the current item sound (autoplay) or sit loaded and paused. */
  private async startCurrent(autoplay: boolean, startMs: number, reload: boolean): Promise<void> {
    const track = this.queue.current;
    if (!track) return;
    if (reload) {
      this.loadedId = undefined;
      this.positionMs = startMs;
      this.positionAt = Date.now();
      this.durationMs = track.durationMs;
    }
    this.pending = autoplay;
    this.changed();
    // Without sound to make there is no reason to reveal the view: the next `ready` loads this track paused.
    if (!autoplay && !this.output.isReady) return;
    try {
      await this.output.ensureReady(READY_TIMEOUT_MS);
    } catch (err: any) {
      this.pending = false;
      this.deps.onError?.(`The player view did not start (${err?.message ?? err}). Open the Music view and try again.`);
      this.changed();
      return;
    }
    if (this.queue.current !== track) return; // superseded while waiting
    autoplay = this.pending; // a pause() while the view was revealing cancels the play
    if (this.loadedId === track.id) {
      if (autoplay) this.output.play();
    } else {
      this.loadedId = track.id;
      this.output.load(track, { startMs, autoplay });
    }
  }

  /** Push volume and the current track (paused) to a fresh or reloaded output. */
  private syncOutput(): void {
    this.output.setVolume(this.volume);
    const track = this.queue.current;
    this.loadedId = track?.id;
    if (track) this.output.load(track, { startMs: this.positionMs, autoplay: false });
  }

  private handle(e: AudioEvent): void {
    const current = this.queue.current;
    if ('trackUri' in e && e.trackUri && e.trackUri !== current?.uri) return; // stale event from an old source
    switch (e.type) {
      case 'ready':
        this.playing = false; // a (re)loaded view has no source and is not playing
        this.syncOutput();
        break;
      case 'play':
        this.playing = true;
        this.pending = false;
        this.skipStreak = 0;
        break;
      case 'pause':
        if (e.positionMs !== undefined) {
          this.positionMs = e.positionMs;
          this.positionAt = Date.now();
        }
        if (!this.pending) this.playing = false;
        break;
      case 'time':
        this.positionMs = e.positionMs;
        this.positionAt = Date.now();
        break;
      case 'duration':
        if (current) {
          this.durationMs = e.durationMs;
          if (Math.abs(current.durationMs - e.durationMs) >= DURATION_EPSILON_MS) this.deps.onDuration?.(current, e.durationMs);
        }
        break;
      case 'ended':
        void this.onEnded();
        return;
      case 'error':
        void this.onOutputError(e);
        return;
    }
    this.changed();
  }

  private async onEnded(): Promise<void> {
    this.playing = false;
    if (this.queue.repeat === 'track') {
      await this.startCurrent(true, 0, true);
      return;
    }
    await this.advance();
  }

  private async onOutputError(e: Extract<AudioEvent, { type: 'error' }>): Promise<void> {
    const wasActive = this.playing || this.pending; // a paused or restored load must stay paused
    this.playing = false;
    if (e.silent) {
      // Autoplay blocked: stay pending until the user clicks the prompt.
      this.changed();
      return;
    }
    const failed = this.queue.current;
    this.skipStreak++;
    if (this.skipStreak >= this.queue.length) {
      this.skipStreak = 0;
      this.pending = false;
      this.changed();
      this.deps.onError?.(`None of the ${this.queue.length} queued tracks could be played (${e.message}).`);
      return;
    }
    this.deps.onSkipped?.(this.skipStreak);
    if (!(await this.advance(wasActive))) {
      this.skipStreak = 0;
      this.deps.onError?.(`Could not play "${failed?.name ?? 'track'}" (${e.message}).`);
    }
  }

  /** Move to the next item and start it; at the end of the queue, stop on the current one. */
  private async advance(autoplay = true): Promise<boolean> {
    if (!this.queue.next()) {
      this.stopAtEnd();
      return false;
    }
    await this.startCurrent(autoplay, 0, true);
    return true;
  }

  private stopAtEnd(): void {
    this.playing = false;
    this.pending = false;
    this.positionMs = 0;
    this.positionAt = Date.now();
    if (this.output.isReady) {
      this.output.pause();
      this.output.seek(0);
    }
    this.changed();
  }

  private changed(): void {
    const id = this.queue.current?.id ?? null;
    if (id !== this.lastTrackId) {
      this.lastTrackId = id;
      this.trackEmitter.fire(this.queue.current ?? null);
    }
    this.changeEmitter.fire();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.deps.session || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, SAVE_INTERVAL_MS);
    this.saveTimer.unref();
  }
}
