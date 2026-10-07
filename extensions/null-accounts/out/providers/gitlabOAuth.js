'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeTokens = exports.str = exports.asRecord = exports.OAuthError = exports.EXPIRY_MARGIN_MS = exports.GITLAB_SCOPES = void 0;
exports.startDeviceFlow = startDeviceFlow;
exports.pollForToken = pollForToken;
exports.refreshTokens = refreshTokens;
exports.parseTokens = parseTokens;
/** From the design spec: identity, API access for later Issues/MR features, and git over https. */
exports.GITLAB_SCOPES = 'read_user api write_repository';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** A token this close to expiry counts as expired, so it can't lapse mid-request. */
exports.EXPIRY_MARGIN_MS = 60_000;
class OAuthError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
    }
}
exports.OAuthError = OAuthError;
const asRecord = (v) => (typeof v === 'object' && v !== null ? v : {});
exports.asRecord = asRecord;
/** A non-empty string, else undefined. */
const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);
exports.str = str;
const httpsOnly = (v) => {
    const s = (0, exports.str)(v);
    return s?.startsWith('https://') ? s : undefined;
};
function describe(res) {
    const b = (0, exports.asRecord)(res.body);
    return (0, exports.str)(b.error_description) ?? (0, exports.str)(b.error) ?? `HTTP ${res.status}`;
}
function tokenSetFrom(body, now) {
    const b = (0, exports.asRecord)(body);
    const accessToken = (0, exports.str)(b.access_token);
    if (!accessToken) {
        return undefined;
    }
    return {
        accessToken,
        refreshToken: (0, exports.str)(b.refresh_token),
        expiresAt: typeof b.expires_in === 'number' ? now + b.expires_in * 1000 : undefined,
    };
}
async function startDeviceFlow(post, host, clientId) {
    const res = await post(`https://${host}/oauth/authorize_device`, { client_id: clientId, scope: exports.GITLAB_SCOPES });
    const b = (0, exports.asRecord)(res.body);
    const deviceCode = (0, exports.str)(b.device_code);
    const userCode = (0, exports.str)(b.user_code);
    // The URL is opened in the user's browser, so a server-supplied one must be https.
    const verificationUri = httpsOnly(b.verification_uri);
    if (res.status !== 200 || !deviceCode || !userCode || !verificationUri) {
        throw new OAuthError('failed', `GitLab did not start the sign-in: ${describe(res)}`);
    }
    return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: httpsOnly(b.verification_uri_complete),
        expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 300,
        interval: typeof b.interval === 'number' ? b.interval : 5,
    };
}
/** Polls until the user approves. A network failure while polling ends the flow (ponytail: no retry; the user starts over). */
async function pollForToken(post, host, clientId, code, { sleep, now, cancelled }) {
    let interval = code.interval;
    const deadline = now() + code.expiresIn * 1000;
    for (;;) {
        await sleep(interval * 1000);
        if (cancelled()) {
            throw new OAuthError('cancelled', 'Sign-in cancelled.');
        }
        if (now() >= deadline) {
            throw new OAuthError('expired', 'The sign-in code expired. Try again.');
        }
        const res = await post(`https://${host}/oauth/token`, {
            grant_type: DEVICE_GRANT, device_code: code.deviceCode, client_id: clientId,
        });
        const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
        if (tokens) {
            return tokens;
        }
        switch ((0, exports.str)((0, exports.asRecord)(res.body).error)) {
            case 'authorization_pending': break;
            case 'slow_down':
                interval += 5;
                break;
            case 'access_denied': throw new OAuthError('denied', 'Sign-in was denied.');
            case 'expired_token': throw new OAuthError('expired', 'The sign-in code expired. Try again.');
            default: throw new OAuthError('failed', `GitLab sign-in failed: ${describe(res)}`);
        }
    }
}
/** 400/401 = the server refused this refresh token ('rejected'); anything else may pass on its own ('failed'). */
async function refreshTokens(post, host, clientId, refreshToken, now) {
    const res = await post(`https://${host}/oauth/token`, {
        grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId,
    });
    const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
    if (tokens) {
        return tokens;
    }
    throw new OAuthError(res.status === 400 || res.status === 401 ? 'rejected' : 'failed', `GitLab did not refresh the sign-in: ${describe(res)}`);
}
const serializeTokens = (t) => JSON.stringify(t);
exports.serializeTokens = serializeTokens;
function parseTokens(raw) {
    if (!raw) {
        return undefined;
    }
    try {
        const b = (0, exports.asRecord)(JSON.parse(raw));
        const accessToken = (0, exports.str)(b.accessToken);
        if (!accessToken) {
            return undefined;
        }
        return {
            accessToken,
            refreshToken: (0, exports.str)(b.refreshToken),
            expiresAt: typeof b.expiresAt === 'number' ? b.expiresAt : undefined,
        };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=gitlabOAuth.js.map