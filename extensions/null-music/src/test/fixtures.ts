'use strict';

import { KeyValueStore, Track } from '../types';

export function track(n: number, over: Partial<Track> = {}): Track {
  return {
    id: `local:file:///t${n}.mp3`,
    name: `t${n}`,
    artist: 'a',
    artists: ['a'],
    album: '',
    durationMs: 0,
    uri: `file:///t${n}.mp3`,
    ...over,
  };
}

/** In-memory stand-in for `vscode.Memento`. */
export class MemState implements KeyValueStore {
  readonly map = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return this.map.has(key) ? (this.map.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}
