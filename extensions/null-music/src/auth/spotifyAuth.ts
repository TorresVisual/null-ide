'use strict';

import * as http from 'http';
import * as url from 'url';
import { AuthStore } from './authStore';
import { generatePkcePair, generateRandomString } from './pkce';
import { MusicAuthToken } from '../types';

export const SPOTIFY_PROVIDER_ID = 'spotify';
export const DEFAULT_SPOTIFY_CLIENT_ID = 'd96205ea1fc044dd984186ea4b0ba7d6';
export const SPOTIFY_AUTH_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
].join(' ');

export interface SpotifyAuthOptions {
  authStore: AuthStore;
  getClientId: () => string;
  getClientSecret?: () => string;
  openUrl: (url: string) => Promise<boolean | void>;
  fetchFn?: typeof fetch;
}

export class SpotifyAuth {
  private readonly authStore: AuthStore;
  private readonly getClientId: () => string;
  private readonly getClientSecret?: () => string;
  private readonly openUrl: (url: string) => Promise<boolean | void>;
  private readonly fetch: typeof fetch;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(options: SpotifyAuthOptions) {
    this.authStore = options.authStore;
    this.getClientId = options.getClientId;
    this.getClientSecret = options.getClientSecret;
    this.openUrl = options.openUrl;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  public getEffectiveClientId(): string {
    const customId = this.getClientId()?.trim();
    return customId || DEFAULT_SPOTIFY_CLIENT_ID;
  }

  public async isAuthenticated(): Promise<boolean> {
    const token = await this.authStore.getToken(SPOTIFY_PROVIDER_ID);
    return token !== null && !!token.accessToken;
  }

  public async getValidAccessToken(): Promise<string | null> {
    const token = await this.authStore.getToken(SPOTIFY_PROVIDER_ID);
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

  public async refreshAccessToken(refreshToken: string): Promise<string | null> {
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

        const headers: Record<string, string> = {
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
            await this.authStore.clearToken(SPOTIFY_PROVIDER_ID);
          }
          return null;
        }

        const data = (await res.json()) as {
          access_token: string;
          token_type: string;
          scope: string;
          expires_in: number;
          refresh_token?: string;
        };

        const newToken: MusicAuthToken = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || refreshToken,
          expiresAt: Date.now() + (data.expires_in * 1000),
          tokenType: data.token_type,
          scope: data.scope,
        };

        await this.authStore.setToken(SPOTIFY_PROVIDER_ID, newToken);
        return newToken.accessToken;
      } catch (err) {
        console.error('Spotify token refresh error:', err);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  public async login(): Promise<boolean> {
    const { verifier, challenge } = generatePkcePair();
    const state = generateRandomString(32);
    const clientId = this.getEffectiveClientId();

    return new Promise<boolean>((resolve) => {
      let server: http.Server | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

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
            const queryState = reqUrl.query.state as string;
            const queryCode = reqUrl.query.code as string;
            const queryError = reqUrl.query.error as string;

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
              await this.authStore.setToken(SPOTIFY_PROVIDER_ID, token);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(this.getHtmlResult('Connected to Spotify!', 'You can now close this tab and return to Null IDE.', true));
              cleanup();
              resolve(true);
            } else {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(this.getHtmlResult('Authentication Failed', 'Could not exchange code for access token.', false));
              cleanup();
              resolve(false);
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
          }
        } catch (e) {
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
        authUrl.searchParams.set('scope', SPOTIFY_AUTH_SCOPES);

        try {
          await this.openUrl(authUrl.toString());
        } catch {
          cleanup();
          resolve(false);
        }
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port === 8888) {
          // Fallback to random available port if 8888 in use
          port = 0;
          server?.listen(0, '127.0.0.1');
        } else {
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

  public async exchangeCodeForToken(
    code: string,
    verifier: string,
    redirectUri: string
  ): Promise<MusicAuthToken | null> {
    const clientId = this.getEffectiveClientId();
    const clientSecret = this.getClientSecret?.()?.trim();

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });

    const headers: Record<string, string> = {
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

      const data = (await res.json()) as {
        access_token: string;
        token_type: string;
        scope: string;
        expires_in: number;
        refresh_token?: string;
      };

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope,
      };
    } catch (err) {
      console.error('Error exchanging Spotify auth code:', err);
      return null;
    }
  }

  public async logout(): Promise<void> {
    await this.authStore.clearToken(SPOTIFY_PROVIDER_ID);
  }

  private getHtmlResult(title: string, message: string, success: boolean): string {
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
