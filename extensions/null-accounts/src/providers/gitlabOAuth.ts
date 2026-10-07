'use strict';

/** From the design spec: identity, API access for later Issues/MR features, and git over https. */
export const GITLAB_SCOPES = 'read_user api write_repository';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** A token this close to expiry counts as expired, so it can't lapse mid-request. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface FormResponse { status: number; body: unknown }
/** POST application/x-www-form-urlencoded. Resolves any HTTP response; rejects only on a network failure. */
export type PostForm = (url: string, form: Record<string, string>) => Promise<FormResponse>;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Seconds the device code stays valid. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent means the token does not expire. */
  expiresAt?: number;
}

export type OAuthFailure = 'denied' | 'expired' | 'cancelled' | 'rejected' | 'failed';

export class OAuthError extends Error {
  constructor(readonly reason: OAuthFailure, message: string) { super(message); }
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {});
/** A non-empty string, else undefined. */
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

const httpsOnly = (v: unknown): string | undefined => {
  const s = str(v);
  return s?.startsWith('https://') ? s : undefined;
};

function describe(res: FormResponse): string {
  const b = asRecord(res.body);
  return str(b.error_description) ?? str(b.error) ?? `HTTP ${res.status}`;
}

function tokenSetFrom(body: unknown, now: number): TokenSet | undefined {
  const b = asRecord(body);
  const accessToken = str(b.access_token);
  if (!accessToken) { return undefined; }
  return {
    accessToken,
    refreshToken: str(b.refresh_token),
    expiresAt: typeof b.expires_in === 'number' ? now + b.expires_in * 1000 : undefined,
  };
}

export async function startDeviceFlow(post: PostForm, host: string, clientId: string): Promise<DeviceCode> {
  const res = await post(`https://${host}/oauth/authorize_device`, { client_id: clientId, scope: GITLAB_SCOPES });
  const b = asRecord(res.body);
  const deviceCode = str(b.device_code);
  const userCode = str(b.user_code);
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

export interface PollOptions {
  sleep(ms: number): Promise<void>;
  now(): number;
  cancelled(): boolean;
}

/** Polls until the user approves. A network failure while polling ends the flow (ponytail: no retry; the user starts over). */
export async function pollForToken(
  post: PostForm,
  host: string,
  clientId: string,
  code: DeviceCode,
  { sleep, now, cancelled }: PollOptions,
): Promise<TokenSet> {
  let interval = code.interval;
  const deadline = now() + code.expiresIn * 1000;
  for (;;) {
    await sleep(interval * 1000);
    if (cancelled()) { throw new OAuthError('cancelled', 'Sign-in cancelled.'); }
    if (now() >= deadline) { throw new OAuthError('expired', 'The sign-in code expired. Try again.'); }
    const res = await post(`https://${host}/oauth/token`, {
      grant_type: DEVICE_GRANT, device_code: code.deviceCode, client_id: clientId,
    });
    const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
    if (tokens) { return tokens; }
    switch (str(asRecord(res.body).error)) {
      case 'authorization_pending': break;
      case 'slow_down': interval += 5; break;
      case 'access_denied': throw new OAuthError('denied', 'Sign-in was denied.');
      case 'expired_token': throw new OAuthError('expired', 'The sign-in code expired. Try again.');
      default: throw new OAuthError('failed', `GitLab sign-in failed: ${describe(res)}`);
    }
  }
}

/** 400/401 = the server refused this refresh token ('rejected'); anything else may pass on its own ('failed'). */
export async function refreshTokens(
  post: PostForm,
  host: string,
  clientId: string,
  refreshToken: string,
  now: () => number,
): Promise<TokenSet> {
  const res = await post(`https://${host}/oauth/token`, {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId,
  });
  const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
  if (tokens) { return tokens; }
  throw new OAuthError(
    res.status === 400 || res.status === 401 ? 'rejected' : 'failed',
    `GitLab did not refresh the sign-in: ${describe(res)}`,
  );
}

export const serializeTokens = (t: TokenSet): string => JSON.stringify(t);

export function parseTokens(raw: string | undefined): TokenSet | undefined {
  if (!raw) { return undefined; }
  try {
    const b = asRecord(JSON.parse(raw));
    const accessToken = str(b.accessToken);
    if (!accessToken) { return undefined; }
    return {
      accessToken,
      refreshToken: str(b.refreshToken),
      expiresAt: typeof b.expiresAt === 'number' ? b.expiresAt : undefined,
    };
  } catch {
    return undefined;
  }
}
