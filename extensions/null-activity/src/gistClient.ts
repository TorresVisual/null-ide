'use strict';

export interface HttpReply {
  status: number;
  body: unknown;
}

/** Resolves any HTTP response; rejects only on a network failure. */
export type HttpJson = (
  method: 'POST' | 'PATCH',
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) => Promise<HttpReply>;

export interface GistFile {
  name: string;
  content: string;
}

export type PublishResult = { ok: true; id: string; owner: string } | { ok: false; message: string };

const API = 'https://api.github.com/gists';
const DESCRIPTION = 'Null Activity badges';

export const gistRawUrl = (owner: string, id: string, file: string): string =>
  `https://gist.githubusercontent.com/${owner}/${id}/raw/${file}`;

function serverSays(body: unknown): string {
  const message = typeof body === 'string' ? body : (body as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message.slice(0, 200) : '';
}

/**
 * Creates the secret gist, or updates `existingId` in place (creating a new one if it was deleted).
 * Never throws; the token only ever goes in the Authorization header.
 */
export async function publishGist(
  http: HttpJson,
  token: string,
  existingId: string | undefined,
  files: GistFile[],
): Promise<PublishResult> {
  const content = Object.fromEntries(files.map((f) => [f.name, { content: f.content }]));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const create = () => http('POST', API, headers, { description: DESCRIPTION, public: false, files: content });

  let reply: HttpReply;
  try {
    reply = existingId
      ? await http('PATCH', `${API}/${encodeURIComponent(existingId)}`, headers, { description: DESCRIPTION, files: content })
      : await create();
    if (existingId && reply.status === 404) reply = await create();
  } catch (err) {
    return { ok: false, message: `Could not reach GitHub (${err instanceof Error ? err.message : String(err)}).` };
  }

  const said = serverSays(reply.body);
  if (reply.status === 401 || reply.status === 403) {
    return { ok: false, message: `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}` };
  }
  const body = reply.body as { id?: unknown; owner?: { login?: unknown } } | undefined;
  if ((reply.status === 200 || reply.status === 201) && typeof body?.id === 'string' && typeof body.owner?.login === 'string') {
    return { ok: true, id: body.id, owner: body.owner.login };
  }
  return { ok: false, message: `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}` };
}
