'use strict';

import { ChangeEmitter } from './changeEmitter';
import { MetadataStore } from './accountStore';
import { Account } from './types';

export const AVATARS_KEY = 'null-accounts.avatars';
const SIZE = 64;
const MAX_BYTES = 100_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface AvatarDeps {
  meta: MetadataStore;
  accounts(): Account[];
  /** GET an https URL and parse the JSON; resolves `undefined` on any failure. */
  getJson(url: string): Promise<unknown>;
  /** GET an https URL; resolves `undefined` on any failure. */
  getImage(url: string): Promise<{ type: string; bytes: Uint8Array } | undefined>;
}

interface Entry { username: string; host: string; uri: string }

/** The real `getJson`/`getImage`: short timeout, https only, no credentials sent. */
export async function fetchAvatarJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'null-ide' }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : undefined;
  } catch { return undefined; }
}

export async function fetchAvatarImage(url: string): Promise<{ type: string; bytes: Uint8Array } | undefined> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'null-ide' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { return undefined; }
    return { type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch { return undefined; }
}

/** Profile pictures as small `data:` URIs, so the panel, the Accounts menu and the activity bar need no network and no CSP exception. */
export class AvatarCache {
  private readonly emitter = new ChangeEmitter();
  readonly onDidChange = this.emitter.event;
  private queue: Promise<void> = Promise.resolve();
  /** Accounts we already asked about this session, so an offline or avatar-less account is not retried on every change. */
  private readonly tried = new Set<string>();

  constructor(private readonly deps: AvatarDeps) {}

  get(id: string): string | undefined {
    return this.stored()[id]?.uri;
  }

  /** Fetches avatars for accounts that have none, drops those of accounts that are gone or renamed. Never rejects. */
  refresh(): Promise<void> {
    this.queue = this.queue.then(() => this.run()).catch(() => { /* an avatar is cosmetic */ });
    return this.queue;
  }

  private stored(): Record<string, Entry> {
    const raw = this.deps.meta.get<unknown>(AVATARS_KEY);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, Entry> : {};
  }

  private async run(): Promise<void> {
    const before = this.stored();
    const next: Record<string, Entry> = {};
    const missing: Account[] = [];
    for (const account of this.deps.accounts()) {
      const entry = before[account.id];
      if (entry && entry.username === account.username && entry.host === account.host) { next[account.id] = entry; }
      else if (!this.tried.has(`${account.id}|${account.username}|${account.host}`)) { missing.push(account); }
    }
    let changed = Object.keys(next).length !== Object.keys(before).length;
    await Promise.all(missing.map(async account => {
      this.tried.add(`${account.id}|${account.username}|${account.host}`);
      const uri = await this.load(account).catch(() => undefined);
      if (uri) { next[account.id] = { username: account.username, host: account.host, uri }; changed = true; }
    }));
    if (!changed) { return; }
    await this.deps.meta.update(AVATARS_KEY, next);
    this.emitter.fire();
  }

  private async load(account: Account): Promise<string | undefined> {
    const url = await this.sourceUrl(account);
    if (!url) { return undefined; }
    const image = await this.deps.getImage(url);
    if (!image || !IMAGE_TYPES.includes(image.type) || image.bytes.length === 0 || image.bytes.length > MAX_BYTES) { return undefined; }
    return `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`;
  }

  private async sourceUrl(account: Account): Promise<string | undefined> {
    const user = encodeURIComponent(account.username);
    if (account.provider === 'github') {
      return account.host === 'github.com' ? `https://github.com/${user}.png?size=${SIZE}` : undefined;
    }
    const found = await this.deps.getJson(`https://${account.host}/api/v4/users?username=${user}`);
    const avatar = Array.isArray(found) && typeof found[0]?.avatar_url === 'string' ? found[0].avatar_url as string : undefined;
    if (!avatar) { return undefined; }
    try {
      const url = new URL(avatar, `https://${account.host}`);
      if (url.protocol !== 'https:') { return undefined; }
      url.searchParams.set('width', String(SIZE)); // GitLab uploads
      url.searchParams.set('s', String(SIZE)); // Gravatar fallback
      return url.toString();
    } catch { return undefined; }
  }
}
