'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.gistRawUrl = void 0;
exports.publishGist = publishGist;
const API = 'https://api.github.com/gists';
const DESCRIPTION = 'Null Activity badges';
const gistRawUrl = (owner, id, file) => `https://gist.githubusercontent.com/${owner}/${id}/raw/${file}`;
exports.gistRawUrl = gistRawUrl;
function serverSays(body) {
    const message = typeof body === 'string' ? body : body?.message;
    return typeof message === 'string' ? message.slice(0, 200) : '';
}
/**
 * Creates the secret gist, or updates `existingId` in place (creating a new one if it was deleted).
 * Never throws; the token only ever goes in the Authorization header.
 */
async function publishGist(http, token, existingId, files) {
    const content = Object.fromEntries(files.map((f) => [f.name, { content: f.content }]));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const create = () => http('POST', API, headers, { description: DESCRIPTION, public: false, files: content });
    let reply;
    try {
        reply = existingId
            ? await http('PATCH', `${API}/${encodeURIComponent(existingId)}`, headers, { description: DESCRIPTION, files: content })
            : await create();
        if (existingId && reply.status === 404)
            reply = await create();
    }
    catch (err) {
        return { ok: false, message: `Could not reach GitHub (${err instanceof Error ? err.message : String(err)}).` };
    }
    const said = serverSays(reply.body);
    if (reply.status === 401 || reply.status === 403) {
        return { ok: false, message: `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}` };
    }
    const body = reply.body;
    if ((reply.status === 200 || reply.status === 201) && typeof body?.id === 'string' && typeof body.owner?.login === 'string') {
        return { ok: true, id: body.id, owner: body.owner.login };
    }
    return { ok: false, message: `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}` };
}
//# sourceMappingURL=gistClient.js.map