'use strict';

export interface HttpReply {
  status: number;
  body: unknown;
}

/** Resolves any HTTP response; rejects only on a network failure. */
export type HttpJson = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
) => Promise<HttpReply>;

export type HttpText = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

export interface GistIo {
  json: HttpJson;
  text: HttpText;
}

export interface Failure {
  ok: false;
  kind: 'offline' | 'auth' | 'notFound' | 'error';
  message: string;
}
export type Res<T> = { ok: true; value: T } | Failure;

export interface Snapshot {
  id: string;
  owner: string;
  /** Gist file name → content */
  files: Record<string, string>;
}

export interface Revision {
  sha: string;
  date: string;
}

export const DESCRIPTION = 'Null IDE settings sync';
const API = 'https://api.github.com/gists';
const RAW_HOST = /^https:\/\/gist\.githubusercontent\.com\//;
const PAGES = 3;

const failure = (kind: Failure['kind'], message: string): Failure => ({ ok: false, kind, message });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Only a JSON `message`; a non-JSON body (an HTML error page from an outage or proxy) is never echoed. */
function serverSays(body: unknown): string {
  const message = typeof body === 'object' && body ? (body as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, 200) : '';
}

const toApiFiles = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }]));

export type GistStore = ReturnType<typeof createGistStore>;

/** Every method resolves; none throws. The token only ever goes in the `Authorization` header of a GitHub API call. */
export function createGistStore(io: GistIo, token: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: Record<string, unknown>): Promise<Res<unknown>> {
    let reply: HttpReply;
    try {
      reply = await io.json(method, url, headers, body);
    } catch (err) {
      return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
    }
    const said = serverSays(reply.body);
    if (reply.status === 401 || reply.status === 403) {
      return failure('auth', `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}`);
    }
    if (reply.status === 404) return failure('notFound', 'The sync Gist no longer exists.');
    if (reply.status < 200 || reply.status >= 300) {
      return failure('error', `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}`);
    }
    return { ok: true, value: reply.body };
  }

  async function snapshotOf(body: unknown): Promise<Res<Snapshot>> {
    const gist = body as
      | {
          id?: unknown;
          owner?: { login?: unknown };
          files?: Record<string, { content?: unknown; truncated?: unknown; raw_url?: unknown } | null>;
        }
      | undefined;
    if (typeof gist?.id !== 'string' || typeof gist.owner?.login !== 'string' || !gist.files) {
      return failure('error', 'GitHub returned an unexpected Gist.');
    }
    const files: Record<string, string> = {};
    for (const [name, file] of Object.entries(gist.files)) {
      if (!file) continue;
      if (file.truncated === true) {
        const url = typeof file.raw_url === 'string' ? file.raw_url : '';
        if (!RAW_HOST.test(url)) return failure('error', `GitHub returned an unexpected location for ${name}.`);
        try {
          const raw = await io.text(url, {});
          if (raw.status !== 200) return failure('error', `GitHub answered HTTP ${raw.status} for ${name}.`);
          files[name] = raw.body;
        } catch (err) {
          return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
        }
      } else if (typeof file.content === 'string') {
        files[name] = file.content;
      }
    }
    return { ok: true, value: { id: gist.id, owner: gist.owner.login, files } };
  }

  return {
    /** The id of this user's sync Gist (matched by description), or `undefined` if there is none. */
    async find(): Promise<Res<string | undefined>> {
      for (let page = 1; page <= PAGES; page++) {
        const r = await call('GET', `${API}?per_page=100&page=${page}`);
        if (!r.ok) return r;
        const list = Array.isArray(r.value) ? (r.value as { id?: unknown; description?: unknown }[]) : [];
        const hit = list.find((g) => g.description === DESCRIPTION && typeof g.id === 'string');
        if (hit) return { ok: true, value: hit.id as string };
        if (list.length < 100) break;
      }
      return { ok: true, value: undefined };
    },

    async read(id: string): Promise<Res<Snapshot>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}`);
      return r.ok ? snapshotOf(r.value) : r;
    },

    async create(files: Record<string, string>): Promise<Res<Snapshot>> {
      const r = await call('POST', API, { description: DESCRIPTION, public: false, files: toApiFiles(files) });
      return r.ok ? snapshotOf(r.value) : r;
    },

    /** One PATCH; a `null` content deletes the file. */
    async update(id: string, changes: Record<string, string | null>): Promise<Res<void>> {
      const files = Object.fromEntries(Object.entries(changes).map(([name, content]) => [name, content === null ? null : { content }]));
      const r = await call('PATCH', `${API}/${encodeURIComponent(id)}`, { files });
      return r.ok ? { ok: true, value: undefined } : r;
    },

    async remove(id: string): Promise<Res<void>> {
      const r = await call('DELETE', `${API}/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, value: undefined } : r;
    },

    /** Newest first. */
    async revisions(id: string): Promise<Res<Revision[]>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}/commits`);
      if (!r.ok) return r;
      const list = Array.isArray(r.value) ? (r.value as { version?: unknown; committed_at?: unknown }[]) : [];
      return {
        ok: true,
        value: list.flatMap((c) =>
          typeof c.version === 'string' && typeof c.committed_at === 'string' ? [{ sha: c.version, date: c.committed_at }] : [],
        ),
      };
    },

    async readRevision(id: string, sha: string): Promise<Res<Snapshot>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}/${encodeURIComponent(sha)}`);
      return r.ok ? snapshotOf(r.value) : r;
    },
  };
}
