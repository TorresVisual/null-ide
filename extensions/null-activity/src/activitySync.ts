'use strict';

import * as fs from 'fs';
import { blobHash, blobName, decodeMonth, encodeMonth, parseBlobName } from './activityBlob';
import { Interval } from './types';

/** What null-sync hands to one exchange: the activity blobs currently in the Gist. `version` changes whenever a blob does. */
export interface RemoteBlobs {
  names: { name: string; version: string }[];
  /** The decrypted text, or `undefined` if it is missing or cannot be decrypted. */
  read(name: string): string | undefined;
}
/** Returns the blobs to write (`null` deletes). */
export type Exchange = (remote: RemoteBlobs) => Promise<Record<string, string | null>>;
/** The part of null-sync's API used here (a separate extension, so no shared import). `false` = not available or failed. */
export interface SyncPort {
  syncActivity(exchange: Exchange): Promise<boolean>;
}

export interface LinkState {
  /** This machine's months → hash of the text last uploaded. */
  uploaded: Record<string, string>;
  /** `<machine>/<month>` → remote version last pulled. */
  pulled: Record<string, string>;
  /** Other machines' display names. */
  names: Record<string, string>;
}

export interface StorePort {
  ownMonths(): string[];
  exportOwn(month: string): Interval[];
  remoteMonths(): { machine: string; month: string }[];
  replaceRemote(machine: string, month: string, intervals: Interval[]): void;
  removeRemote(machine: string, month: string): void;
}

export interface ActivitySyncDeps {
  store: StorePort;
  machine: { id: string; name(): string };
  /** `undefined` when null-sync is missing. */
  port(): Promise<SyncPort | undefined>;
  state: { load(): LinkState; save(state: LinkState): void };
  /** Called after other machines' data changed on disk. */
  onPulled(): void;
  log(message: string): void;
}

const EMPTY: LinkState = { uploaded: {}, pulled: {}, names: {} };

export function fileState(file: string): ActivitySyncDeps['state'] {
  return {
    load() {
      try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { uploaded: { ...v.uploaded }, pulled: { ...v.pulled }, names: { ...v.names } };
      } catch {
        return { ...EMPTY };
      }
    },
    save(state) {
      try {
        fs.writeFileSync(file, JSON.stringify(state));
      } catch {
        // the next run starts from what is on disk
      }
    },
  };
}

/**
 * Uploads this machine's intervals as one blob per month and caches other machines' blobs. Each blob has exactly
 * one writer, so there is no merge and no conflict: a blob is replaced, never appended to, and a repeated run changes nothing.
 */
export class ActivitySync {
  private tail: Promise<unknown> = Promise.resolve();
  private warmed = false;

  constructor(private readonly d: ActivitySyncDeps) {}

  /** One sync. Serialised, never rejects, does nothing without null-sync. */
  run(): Promise<void> {
    const next = this.tail.then(() => this.once().catch((err) => this.d.log(`Sync failed (${err instanceof Error ? err.message : String(err)}).`)));
    this.tail = next;
    return next;
  }

  private async once(): Promise<void> {
    const { d } = this;
    const port = await d.port();
    if (!port) return;
    const state = d.state.load();
    const uploaded: Record<string, string> = {};
    const pulled = { ...state.pulled };
    const names = { ...state.names };
    let exchanged = false;
    let changed = false;
    // ponytail: after the first run of a launch only the previous and current month are re-encoded (closed months
    // rarely change); an import or delete in an older month goes up on the next launch. Hash every month if that matters.
    const recent = this.recentMonths();

    const ok = await port.syncActivity(async (remote) => {
      exchanged = true;
      const own = d.machine.id;
      const writes: Record<string, string | null> = {};
      const present = new Map(remote.names.map((n) => [n.name, n.version]));
      const months = new Set(d.store.ownMonths());

      for (const month of months) {
        const name = blobName(own, month);
        if (this.warmed && !recent.has(month) && state.uploaded[month] !== undefined && present.has(name)) {
          uploaded[month] = state.uploaded[month];
          continue;
        }
        const text = encodeMonth({ id: own, name: d.machine.name() }, d.store.exportOwn(month));
        uploaded[month] = blobHash(text);
        if (state.uploaded[month] !== uploaded[month] || !present.has(name)) writes[name] = text;
      }
      for (const { name } of remote.names) {
        const parsed = parseBlobName(name);
        if (parsed?.machine === own && !months.has(parsed.month)) writes[name] = null;
      }

      const seen = new Set<string>();
      const cached = new Set(d.store.remoteMonths().map((m) => `${m.machine}/${m.month}`));
      for (const { name, version } of remote.names) {
        const parsed = parseBlobName(name);
        if (!parsed || parsed.machine === own) continue;
        const key = `${parsed.machine}/${parsed.month}`;
        seen.add(key);
        if (pulled[key] === version && cached.has(key)) continue;
        const text = remote.read(name);
        const blob = text === undefined ? undefined : decodeMonth(text);
        if (!blob || blob.machine !== parsed.machine) {
          d.log(`Skipped ${name}: it could not be read.`);
          continue;
        }
        d.store.replaceRemote(parsed.machine, parsed.month, blob.intervals);
        pulled[key] = version;
        names[parsed.machine] = blob.name;
        changed = true;
      }
      for (const key of cached) {
        if (seen.has(key)) continue;
        const [machine, month] = key.split('/');
        d.store.removeRemote(machine, month);
        delete pulled[key];
        changed = true;
      }
      return writes;
    });

    if (exchanged) d.state.save({ uploaded: ok ? uploaded : state.uploaded, pulled, names });
    if (ok) this.warmed = true;
    if (changed) d.onPulled();
  }

  private recentMonths(): Set<string> {
    const now = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return new Set([key(now), key(new Date(now.getFullYear(), now.getMonth() - 1, 1))]);
  }
}
