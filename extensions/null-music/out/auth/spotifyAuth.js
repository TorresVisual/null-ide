'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyAuth = exports.SPOTIFY_AUTH_SCOPES = exports.DEFAULT_SPOTIFY_CLIENT_ID = exports.SPOTIFY_PROVIDER_ID = void 0;
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const pkce_1 = require("./pkce");
exports.SPOTIFY_PROVIDER_ID = 'spotify';
exports.DEFAULT_SPOTIFY_CLIENT_ID = 'd96205ea1fc044dd984186ea4b0ba7d6';
exports.SPOTIFY_AUTH_SCOPES = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',
    'user-library-modify',
].join(' ');
class SpotifyAuth {
    authStore;
    getClientId;
    getClientSecret;
    openUrl;
    fetch;
    refreshPromise = null;
    constructor(options) {
        this.authStore = options.authStore;
        this.getClientId = options.getClientId;
        this.getClientSecret = options.getClientSecret;
        this.openUrl = options.openUrl;
        this.fetch = options.fetchFn ?? globalThis.fetch;
    }
    getEffectiveClientId() {
        const customId = this.getClientId()?.trim();
        return customId || exports.DEFAULT_SPOTIFY_CLIENT_ID;
    }
    async isAuthenticated() {
        const token = await this.authStore.getToken(exports.SPOTIFY_PROVIDER_ID);
        return token !== null && !!token.accessToken;
    }
    async getValidAccessToken() {
        const token = await this.authStore.getToken(exports.SPOTIFY_PROVIDER_ID);
        if (!token) {
            return null;
        }
        // If token still valid for at least 45 seconds, return it
        if (Date.now() < token.expiresAt - 45000) {
            return token.accessToken;
        }
        // Otherwise refresh if we have a refresh token
        if (token.refreshToken) {
            return this.refreshAccessToken(token.refreshToken);
        }
        return null;
    }
    async refreshAccessToken(refreshToken) {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = (async () => {
            try {
                const clientId = this.getEffectiveClientId();
                const clientSecret = this.getClientSecret?.()?.trim();
                const bodyParams = new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: clientId,
                });
                const headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                };
                if (clientSecret) {
                    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
                    headers['Authorization'] = `Basic ${authHeader}`;
                }
                const res = await this.fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers,
                    body: bodyParams.toString(),
                });
                if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    console.error(`Failed to refresh Spotify token (${res.status}): ${errText}`);
                    if (res.status === 400 || res.status === 401) {
                        // Refresh token revoked or invalid
                        await this.authStore.clearToken(exports.SPOTIFY_PROVIDER_ID);
                    }
                    return null;
                }
                const data = (await res.json());
                const newToken = {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token || refreshToken,
                    expiresAt: Date.now() + (data.expires_in * 1000),
                    tokenType: data.token_type,
                    scope: data.scope,
                };
                await this.authStore.setToken(exports.SPOTIFY_PROVIDER_ID, newToken);
                return newToken.accessToken;
            }
            catch (err) {
                console.error('Spotify token refresh error:', err);
                return null;
            }
            finally {
                this.refreshPromise = null;
            }
        })();
        return this.refreshPromise;
    }
    async login() {
        const { verifier, challenge } = (0, pkce_1.generatePkcePair)();
        const state = (0, pkce_1.generateRandomString)(32);
        const clientId = this.getEffectiveClientId();
        return new Promise((resolve) => {
            let server = null;
            let timeoutId = null;
            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (server) {
                    server.close();
                    server = null;
                }
            };
            server = http.createServer(async (req, res) => {
                try {
                    const reqUrl = url.parse(req.url || '', true);
                    if (reqUrl.pathname === '/callback') {
                        const queryState = reqUrl.query.state;
                        const queryCode = reqUrl.query.code;
                        const queryError = reqUrl.query.error;
                        if (queryError) {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(this.getHtmlResult('Authentication Failed', `Spotify error: ${queryError}`, false));
                            cleanup();
                            resolve(false);
                            return;
                        }
                        if (queryState !== state || !queryCode) {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(this.getHtmlResult('Authentication Failed', 'State mismatch or missing authorization code.', false));
                            cleanup();
                            resolve(false);
                            return;
                        }
                        // Exchange code for token
                        const redirectUri = `http://127.0.0.1:${port}/callback`;
                        const token = await this.exchangeCodeForToken(queryCode, verifier, redirectUri);
                        if (token) {
                            await this.authStore.setToken(exports.SPOTIFY_PROVIDER_ID, token);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(this.getHtmlResult('Connected to Spotify!', 'You can now close this tab and return to Null IDE.', true));
                            cleanup();
                            resolve(true);
                        }
                        else {
                            res.writeHead(500, { 'Content-Type': 'text/html' });
                            res.end(this.getHtmlResult('Authentication Failed', 'Could not exchange code for access token.', false));
                            cleanup();
                            resolve(false);
                        }
                    }
                    else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not found');
                    }
                }
                catch (e) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Server error during auth');
                    cleanup();
                    resolve(false);
                }
            });
            let port = 8888;
            server.listen(port, '127.0.0.1', async () => {
                const redirectUri = `http://127.0.0.1:${port}/callback`;
                const authUrl = new URL('https://accounts.spotify.com/authorize');
                authUrl.searchParams.set('client_id', clientId);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('redirect_uri', redirectUri);
                authUrl.searchParams.set('code_challenge_method', 'S256');
                authUrl.searchParams.set('code_challenge', challenge);
                authUrl.searchParams.set('state', state);
                authUrl.searchParams.set('scope', exports.SPOTIFY_AUTH_SCOPES);
                try {
                    await this.openUrl(authUrl.toString());
                }
                catch {
                    cleanup();
                    resolve(false);
                }
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE' && port === 8888) {
                    // Fallback to random available port if 8888 in use
                    port = 0;
                    server?.listen(0, '127.0.0.1');
                }
                else {
                    cleanup();
                    resolve(false);
                }
            });
            // 5-minute timeout
            timeoutId = setTimeout(() => {
                cleanup();
                resolve(false);
            }, 5 * 60 * 1000);
        });
    }
    async exchangeCodeForToken(code, verifier, redirectUri) {
        const clientId = this.getEffectiveClientId();
        const clientSecret = this.getClientSecret?.()?.trim();
        const bodyParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
        });
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (clientSecret) {
            const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            headers['Authorization'] = `Basic ${authHeader}`;
        }
        try {
            const res = await this.fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers,
                body: bodyParams.toString(),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error(`Token exchange failed (${res.status}): ${text}`);
                return null;
            }
            const data = (await res.json());
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: Date.now() + (data.expires_in * 1000),
                tokenType: data.token_type,
                scope: data.scope,
            };
        }
        catch (err) {
            console.error('Error exchanging Spotify auth code:', err);
            return null;
        }
    }
    async logout() {
        await this.authStore.clearToken(exports.SPOTIFY_PROVIDER_ID);
    }
    getHtmlResult(title, message, success) {
        const statusColor = success ? '#10b981' : '#ef4444';
        const icon = success ? '&#10004;' : '&#10008;';
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Null IDE - Spotify Authentication</title>
  <style>
    body {
      background-color: #0d0d1a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background-color: #1a1a2e;
      border: 1px solid #282845;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 48px;
      color: ${statusColor};
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 12px 0;
      color: #ffffff;
    }
    p {
      color: #9ca3af;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .brand {
      font-size: 12px;
      color: #00b4d8;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="brand">Null IDE Music</div>
  </div>
</body>
</html>`;
    }
}
exports.SpotifyAuth = SpotifyAuth;
//# sourceMappingURL=spotifyAuth.js.map