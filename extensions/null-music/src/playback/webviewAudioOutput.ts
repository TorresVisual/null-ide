'use strict';

import { Emitter } from '../emitter';
import { AudioEvent, AudioOutput } from './audioOutput';

/** The slice of a vscode Webview the output needs (kept vscode-free for tests). */
export interface WebviewLike {
  postMessage(message: unknown): unknown;
  /** Maps a file URI to something the webview may load. */
  resolveUri(uri: string): string;
}

export interface OutputHost {
  /** Make the view resolve (be created) without leaving focus there. */
  revealView(): Promise<void>;
}

export class WebviewAudioOutput implements AudioOutput {
  private readonly emitter = new Emitter<AudioEvent>();
  readonly onEvent = this.emitter.event;
  private view: WebviewLike | undefined;
  private ready = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly host: OutputHost) {}

  get isReady(): boolean {
    return this.ready;
  }

  /** A freshly resolved view has not loaded its script yet: wait for its `ready` message. */
  attach(view: WebviewLike): void {
    this.view = view;
    this.ready = false;
  }

  /** The view went away; whatever was playing stopped with it. */
  detach(): void {
    const wasAttached = this.view !== undefined;
    this.view = undefined;
    this.ready = false;
    if (wasAttached) this.emitter.fire({ type: 'pause' });
  }

  handleMessage(data: any): void {
    switch (data?.type) {
      case 'ready':
        this.ready = true;
        this.emitter.fire({ type: 'ready' });
        for (const resolve of this.waiters.splice(0)) resolve();
        break;
      case 'localAudioPlayStarted':
        this.emitter.fire({ type: 'play' });
        break;
      case 'localAudioPaused':
        this.emitter.fire({ type: 'pause', positionMs: this.num(data.positionMs), trackUri: data.trackUri });
        break;
      case 'localAudioTimeUpdate':
        if (typeof data.positionMs === 'number') {
          this.emitter.fire({ type: 'time', positionMs: data.positionMs, trackUri: data.trackUri });
        }
        break;
      case 'localAudioDuration':
        if (typeof data.durationMs === 'number') {
          this.emitter.fire({ type: 'duration', durationMs: data.durationMs, trackUri: data.trackUri });
        }
        break;
      case 'localAudioEnded':
        this.emitter.fire({ type: 'ended', trackUri: data.trackUri });
        break;
      case 'localAudioError':
      case 'localAudioPlayFailed':
        this.emitter.fire({ type: 'error', message: data.error || 'Playback error', silent: !!data.silent, trackUri: data.trackUri });
        break;
    }
  }

  async ensureReady(timeoutMs: number): Promise<void> {
    if (this.ready) return;
    const ready = new Promise<void>((resolve) => this.waiters.push(resolve));
    if (!this.view) this.host.revealView().catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('no response from the player view')), timeoutMs);
    });
    try {
      await Promise.race([ready, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  load(track: { uri: string }, opts: { startMs: number; autoplay: boolean }): void {
    const isStream = /^https?:/i.test(track.uri);
    this.post({
      type: 'localLoad',
      uri: isStream || !this.view ? track.uri : this.view.resolveUri(track.uri),
      trackUri: track.uri,
      startMs: opts.startMs,
      autoplay: opts.autoplay,
    });
  }

  play(): void {
    this.post({ type: 'localResume' });
  }

  pause(): void {
    this.post({ type: 'localPause' });
  }

  seek(positionMs: number): void {
    this.post({ type: 'localSeek', positionMs });
  }

  setVolume(volumePercent: number): void {
    this.post({ type: 'localVolume', volumePercent });
  }

  private post(message: unknown): void {
    try {
      void this.view?.postMessage(message);
    } catch {
      // a disposed webview throws; the next `ready` resynchronises
    }
  }

  private num(v: unknown): number | undefined {
    return typeof v === 'number' ? v : undefined;
  }
}
