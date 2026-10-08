'use strict';

import { RepeatMode, Track } from '../types';

export interface Entry {
  key: number;
  track: Track;
}

export interface QueueSnapshot {
  history: Entry[];
  current: Entry | null;
  /** Shuffle order while shuffling, list order otherwise. */
  upcoming: Entry[];
}

const HISTORY_LIMIT = 500;

/**
 * Pure queue state. Entries carry a stable key so `index` is derived from the
 * current item and survives insert/remove/move without fix-ups.
 */
export class Queue {
  repeat: RepeatMode = 'off';

  private entries: Entry[] = [];
  private currentKey = -1;
  private nextKey = 1;
  private history: number[] = []; // keys, oldest first
  private upcoming: number[] = []; // keys still to play (shuffle only)
  private shuffleOn = false;

  constructor(private readonly rand: () => number = Math.random) {}

  get tracks(): Track[] {
    return this.entries.map((e) => e.track);
  }

  get length(): number {
    return this.entries.length;
  }

  get index(): number {
    return this.entries.findIndex((e) => e.key === this.currentKey);
  }

  get current(): Track | undefined {
    return this.entries[this.index]?.track;
  }

  get shuffle(): boolean {
    return this.shuffleOn;
  }

  setShuffle(on: boolean): void {
    this.shuffleOn = on;
    this.rebuild();
  }

  replace(tracks: Track[], startIndex = 0): void {
    this.entries = tracks.map((track) => this.entry(track));
    const start = this.entries[Math.max(0, Math.min(startIndex, this.entries.length - 1))];
    this.currentKey = start ? start.key : -1;
    this.history = [];
    this.rebuild();
  }

  playNext(track: Track): void {
    const e = this.entry(track);
    this.entries.splice(this.index + 1, 0, e);
    if (this.currentKey === -1) this.currentKey = e.key;
    else if (this.shuffleOn) this.upcoming.unshift(e.key);
  }

  add(track: Track): void {
    const e = this.entry(track);
    this.entries.push(e);
    if (this.currentKey === -1) this.currentKey = e.key;
    else if (this.shuffleOn) {
      this.upcoming.splice(Math.floor(this.rand() * (this.upcoming.length + 1)), 0, e.key);
    }
  }

  remove(i: number): void {
    const e = this.entries[i];
    if (!e) return;
    this.entries.splice(i, 1);
    this.history = this.history.filter((k) => k !== e.key);
    this.upcoming = this.upcoming.filter((k) => k !== e.key);
    if (e.key === this.currentKey) {
      const successor = this.entries[i] ?? this.entries[i - 1];
      this.currentKey = successor ? successor.key : -1;
      this.upcoming = this.upcoming.filter((k) => k !== this.currentKey);
    }
  }

  move(from: number, to: number): void {
    if (!this.entries[from] || to < 0 || to >= this.entries.length) return;
    const [e] = this.entries.splice(from, 1);
    this.entries.splice(to, 0, e);
  }

  clear(): void {
    this.entries = [];
    this.currentKey = -1;
    this.history = [];
    this.upcoming = [];
  }

  /** Advance and return the new current track, or undefined (state untouched) at the end. */
  next(): Track | undefined {
    if (this.currentKey === -1) return undefined;
    let key: number | undefined;
    if (this.shuffleOn) {
      if (this.upcoming.length === 0 && this.repeat === 'context') {
        this.upcoming = this.shuffled(this.otherKeys());
        if (this.upcoming.length === 0) this.upcoming = [this.currentKey];
      }
      key = this.upcoming.shift();
    } else {
      key = (this.entries[this.index + 1] ?? (this.repeat === 'context' ? this.entries[0] : undefined))?.key;
    }
    if (key === undefined) return undefined;
    this.history.push(this.currentKey);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.currentKey = key;
    return this.current;
  }

  /** Step back through history (list order when history is empty and not shuffling). */
  previous(): Track | undefined {
    let key = this.history.pop();
    if (key === undefined && !this.shuffleOn) key = this.entries[this.index - 1]?.key;
    if (key === undefined) return undefined;
    if (this.shuffleOn && this.currentKey !== -1) this.upcoming.unshift(this.currentKey);
    this.currentKey = key;
    return this.current;
  }

  snapshot(): QueueSnapshot {
    const byKey = new Map(this.entries.map((e) => [e.key, e]));
    const pick = (keys: number[]) => keys.map((k) => byKey.get(k)).filter((e): e is Entry => !!e);
    const at = this.index;
    return {
      history: pick(this.history),
      current: at >= 0 ? this.entries[at] : null,
      upcoming: this.shuffleOn ? pick(this.upcoming) : at >= 0 ? this.entries.slice(at + 1) : [],
    };
  }

  removeKey(key: number): void {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i >= 0) this.remove(i);
  }

  /** Move the entry with `key` to just before `beforeKey` (`null` = the end). Unknown keys are ignored. */
  moveBefore(key: number, beforeKey: number | null): void {
    const from = this.entries.findIndex((e) => e.key === key);
    if (from < 0 || key === beforeKey) return;
    let to = beforeKey === null ? this.entries.length - 1 : this.entries.findIndex((e) => e.key === beforeKey);
    if (to < 0) return;
    if (beforeKey !== null && from < to) to--;
    this.move(from, to);
  }

  /** Make `key` current (from history or upcoming); the old current goes to history. */
  jumpTo(key: number): Track | undefined {
    const e = this.entries.find((x) => x.key === key);
    if (!e || key === this.currentKey) return e?.track;
    this.history = this.history.filter((k) => k !== key);
    if (this.currentKey !== -1) this.history.push(this.currentKey);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.upcoming = this.upcoming.filter((k) => k !== key);
    this.currentKey = key;
    return e.track;
  }

  private rebuild(): void {
    this.upcoming = this.shuffleOn ? this.shuffled(this.otherKeys()) : [];
  }

  private otherKeys(): number[] {
    return this.entries.map((e) => e.key).filter((k) => k !== this.currentKey);
  }

  private shuffled(keys: number[]): number[] {
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
  }

  private entry(track: Track): Entry {
    return { key: this.nextKey++, track };
  }
}
