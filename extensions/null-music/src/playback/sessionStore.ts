'use strict';

import { KeyValueStore, RepeatMode } from '../types';

const KEY = 'null-music.session';

export interface SessionData {
  trackIds: string[];
  index: number;
  positionMs: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export class SessionStore {
  constructor(private readonly state: KeyValueStore) {}

  /** Returns undefined for anything missing or malformed — a bad session must never block startup. */
  load(): SessionData | undefined {
    try {
      const v = this.state.get<any>(KEY, undefined);
      if (!v || !Array.isArray(v.trackIds) || !v.trackIds.every((id: unknown) => typeof id === 'string')) return undefined;
      return {
        trackIds: v.trackIds,
        index: Number.isInteger(v.index) ? v.index : 0,
        positionMs: Number.isFinite(v.positionMs) && v.positionMs > 0 ? v.positionMs : 0,
        volume: Number.isFinite(v.volume) ? Math.max(0, Math.min(100, v.volume)) : 80,
        shuffle: v.shuffle === true,
        repeat: v.repeat === 'track' || v.repeat === 'context' ? v.repeat : 'off',
      };
    } catch {
      return undefined;
    }
  }

  save(data: SessionData): void {
    try {
      void Promise.resolve(this.state.update(KEY, data)).catch(() => {});
    } catch {
      // ignore: the session is best-effort
    }
  }
}
