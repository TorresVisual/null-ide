'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJson = void 0;
/** The only network call in this extension. */
const fetchJson = async (method, url, headers, body) => {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'null-ide', ...headers },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed = text;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    }
    catch { /* keep the raw text */ }
    return { status: res.status, body: parsed };
};
exports.fetchJson = fetchJson;
//# sourceMappingURL=gistHttp.js.map