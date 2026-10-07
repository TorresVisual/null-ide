'use strict';

import { Event } from '../emitter';

export type AudioEvent =
  | { type: 'ready' }
  | { type: 'play' }
  | { type: 'pause'; positionMs?: number; trackUri?: string }
  | { type: 'time'; positionMs: number; trackUri?: string }
  | { type: 'duration'; durationMs: number; trackUri?: string }
  | { type: 'ended'; trackUri?: string }
  | { type: 'error'; message: string; silent?: boolean; trackUri?: string };

/** Where sound comes out. The host owns all state; implementations only obey and report. */
export interface AudioOutput {
  readonly onEvent: Event<AudioEvent>;
  readonly isReady: boolean;
  /** Resolves once the output can take commands (revealing it if needed); rejects after `timeoutMs`. */
  ensureReady(timeoutMs: number): Promise<void>;
  load(track: { uri: string }, opts: { startMs: number; autoplay: boolean }): void;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  setVolume(volumePercent: number): void;
}
