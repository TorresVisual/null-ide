'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESCRIPTION = void 0;
exports.createGistStore = createGistStore;
exports.DESCRIPTION = 'Null IDE settings sync';
const API = 'https://api.github.com/gists';
const RAW_HOST = /^https:\/\/gist\.githubusercontent\.com\//;
const PAGES = 3;
const failure = (kind, message) => ({ ok: false, kind, message });
const messageOf = (err) => (err instanceof Error ? err.message : String(err));
/** Only a JSON `message`; a non-JSON body (an HTML error page from an outage or proxy) is never echoed. */
function serverSays(body) {
    const message = typeof body === 'object' && body ? body.message : undefined;
    return typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, 200) : '';
}
const toApiFiles = (files) => Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }]));
/** Every method resolves; none throws. The token only ever goes in the `Authorization` header of a GitHub API call. */
function createGistStore(io, token) {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    async function call(method, url, body) {
        let reply;
        try {
            reply = await io.json(method, url, headers, body);
        }
        catch (err) {
            return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
        }
        const said = serverSays(reply.body);
        if (reply.status === 401 || reply.status === 403) {
            return failure('auth', `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}`);
        }
        if (reply.status === 404)
            return failure('notFound', 'The sync Gist no longer exists.');
        if (reply.status < 200 || reply.status >= 300) {
            return failure('error', `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}`);
        }
        return { ok: true, value: reply.body };
    }
    async function snapshotOf(body) {
        const gist = body;
        if (typeof gist?.id !== 'string' || typeof gist.owner?.login !== 'string' || !gist.files) {
            return failure('error', 'GitHub returned an unexpected Gist.');
        }
        const files = {};
        for (const [name, file] of Object.entries(gist.files)) {
            if (!file)
                continue;
            if (file.truncated === true) {
                const url = typeof file.raw_url === 'string' ? file.raw_url : '';
                if (!RAW_HOST.test(url))
                    return failure('error', `GitHub returned an unexpected location for ${name}.`);
                try {
                    const raw = await io.text(url, {});
                    if (raw.status !== 200)
                        return failure('error', `GitHub answered HTTP ${raw.status} for ${name}.`);
                    files[name] = raw.body;
                }
                catch (err) {
                    return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
                }
            }
            else if (typeof file.content === 'string') {
                files[name] = file.content;
            }
        }
        return { ok: true, value: { id: gist.id, owner: gist.owner.login, files } };
    }
    return {
        /** The id of this user's sync Gist (matched by description), or `undefined` if there is none. */
        async find() {
            for (let page = 1; page <= PAGES; page++) {
                const r = await call('GET', `${API}?per_page=100&page=${page}`);
                if (!r.ok)
                    return r;
                const list = Array.isArray(r.value) ? r.value : [];
                const hit = list.find((g) => g.description === exports.DESCRIPTION && typeof g.id === 'string');
                if (hit)
                    return { ok: true, value: hit.id };
                if (list.length < 100)
                    break;
            }
            return { ok: true, value: undefined };
        },
        async read(id) {
            const r = await call('GET', `${API}/${encodeURIComponent(id)}`);
            return r.ok ? snapshotOf(r.value) : r;
        },
        async create(files) {
            const r = await call('POST', API, { description: exports.DESCRIPTION, public: false, files: toApiFiles(files) });
            return r.ok ? snapshotOf(r.value) : r;
        },
        /** One PATCH; a `null` content deletes the file. */
        async update(id, changes) {
            const files = Object.fromEntries(Object.entries(changes).map(([name, content]) => [name, content === null ? null : { content }]));
            const r = await call('PATCH', `${API}/${encodeURIComponent(id)}`, { files });
            return r.ok ? { ok: true, value: undefined } : r;
        },
        async remove(id) {
            const r = await call('DELETE', `${API}/${encodeURIComponent(id)}`);
            return r.ok ? { ok: true, value: undefined } : r;
        },
        /** Newest first. */
        async revisions(id) {
            const r = await call('GET', `${API}/${encodeURIComponent(id)}/commits`);
            if (!r.ok)
                return r;
            const list = Array.isArray(r.value) ? r.value : [];
            return {
                ok: true,
                value: list.flatMap((c) => typeof c.version === 'string' && typeof c.committed_at === 'string' ? [{ sha: c.version, date: c.committed_at }] : []),
            };
        },
        async readRevision(id, sha) {
            const r = await call('GET', `${API}/${encodeURIComponent(id)}/${encodeURIComponent(sha)}`);
            return r.ok ? snapshotOf(r.value) : r;
        },
    };
}
//# sourceMappingURL=gistStore.js.map