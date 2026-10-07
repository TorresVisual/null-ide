'use strict';

import { MetadataStore, SecretVault } from './accountStore';
import type { PostForm } from './providers/gitlabOAuth';

/** In-memory stand-in for vscode.Memento, shared by the unit tests. */
export class FakeMeta implements MetadataStore {
  data = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.data.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
}

/** In-memory stand-in for vscode.SecretStorage, shared by the unit tests. */
export class FakeVault implements SecretVault {
  data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

export interface Reply { status?: number; body: unknown }

/** A `PostForm` that answers from a queue (status defaults to 200) and records what it was asked. */
export function fakePost(...replies: Reply[]): {
  post: PostForm;
  calls: Array<{ url: string; form: Record<string, string> }>;
} {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const post: PostForm = async (url, form) => {
    calls.push({ url, form });
    const next = replies.shift();
    if (!next) { throw new Error('unexpected extra request'); }
    return { status: next.status ?? 200, body: next.body };
  };
  return { post, calls };
}

/** A clock whose `sleep` just advances time, so polling tests run instantly. */
export function fakeClock(): { now(): number; sleep(ms: number): Promise<void>; slept: number[] } {
  let t = 1_000_000;
  const slept: number[] = [];
  return { slept, now: () => t, sleep: async ms => { slept.push(ms); t += ms; } };
}
