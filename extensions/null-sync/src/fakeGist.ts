'use strict';

import { GistIo, HttpReply } from './gistStore';

interface Record_ {
  description: string;
  owner: string;
  /** Every revision's full file set, oldest first. */
  revisions: Record<string, string>[];
}

/** An in-memory stand-in for GitHub's Gist API: just enough of it for the engine and two-device tests. */
export class FakeGist {
  /** While true every request fails like a lost connection. */
  offline = false;
  private readonly gists = new Map<string, Record_>();
  private counter = 1;

  readonly io: GistIo = {
    json: async (method, url, _headers, body) => this.handle(method, url, body),
    text: async () => ({ status: 404, body: '' }),
  };

  ids(): string[] {
    return [...this.gists.keys()];
  }
  has(id: string): boolean {
    return this.gists.has(id);
  }
  /** The newest revision's files (Gist file name → stored text). */
  files(id: string): Record<string, string> {
    const record = this.gists.get(id)!;
    return record.revisions[record.revisions.length - 1];
  }
  revisionCount(id: string): number {
    return this.gists.get(id)!.revisions.length;
  }
  delete(id: string): void {
    this.gists.delete(id);
  }
  /** Replaces one file's stored text in a new revision, to simulate corruption or tampering. */
  tamper(id: string, name: string, text: string): void {
    this.gists.get(id)!.revisions.push({ ...this.files(id), [name]: text });
  }

  private view(id: string, record: Record_, revision: Record<string, string>) {
    return {
      id,
      owner: { login: record.owner },
      files: Object.fromEntries(Object.entries(revision).map(([name, content]) => [name, { content }])),
    };
  }

  private handle(method: string, url: string, body?: Record<string, unknown>): HttpReply {
    if (this.offline) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    const parsed = new URL(url);
    const [root, id, sub] = parsed.pathname.split('/').filter(Boolean);
    const notFound: HttpReply = { status: 404, body: { message: 'Not Found' } };
    if (root !== 'gists') return notFound;

    if (id === undefined) {
      if (method === 'GET') {
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const list = [...this.gists].map(([gid, g]) => ({ id: gid, description: g.description })).reverse();
        return { status: 200, body: page === 1 ? list : [] };
      }
      const newId = `gist${this.counter++}`;
      const files = Object.fromEntries(
        Object.entries(body!.files as Record<string, { content: string }>).map(([name, f]) => [name, f.content]),
      );
      const created = { description: String(body!.description), owner: 'me', revisions: [files] };
      this.gists.set(newId, created);
      return { status: 201, body: this.view(newId, created, files) };
    }

    const record = this.gists.get(id);
    if (!record) return notFound;
    const latest = record.revisions[record.revisions.length - 1];
    if (method === 'DELETE') {
      this.gists.delete(id);
      return { status: 204, body: undefined };
    }
    if (method === 'PATCH') {
      const next = { ...latest };
      for (const [name, f] of Object.entries(body!.files as Record<string, { content: string } | null>)) {
        if (f === null) delete next[name];
        else next[name] = f.content;
      }
      record.revisions.push(next);
      return { status: 200, body: this.view(id, record, next) };
    }
    if (sub === 'commits') {
      const commits = record.revisions.map((_, i) => ({
        version: `v${i + 1}`,
        committed_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      }));
      return { status: 200, body: commits.reverse() };
    }
    if (sub !== undefined) {
      const revision = record.revisions[Number(sub.slice(1)) - 1];
      return revision ? { status: 200, body: this.view(id, record, revision) } : notFound;
    }
    return { status: 200, body: this.view(id, record, latest) };
  }
}
