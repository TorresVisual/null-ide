'use strict';

/**
 * Reads the public metadata Discord exposes for an application, so the
 * extension can explain misconfiguration instead of silently rendering the
 * wrong thing.
 *
 * Both endpoints are unauthenticated and only expose data that is already
 * public for any Rich Presence application.
 */

const API_BASE = 'https://discord.com/api/v9';
const FETCH_TIMEOUT_MS = 6_000;

export interface DiscordAppInfo {
  /** Application name from the Developer Portal — this is what Discord shows as "Playing …". */
  name?: string;
  /** Rich Presence asset keys that actually exist on the application. */
  assets: Set<string>;
  /**
   * False when a lookup failed. Callers must then treat `assets` as unknown
   * and send their preferred keys unchanged rather than filtering them away.
   */
  reliable: boolean;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchDiscordAppInfo(
  clientId: string,
  log: (message: string) => void,
): Promise<DiscordAppInfo> {
  const info: DiscordAppInfo = { assets: new Set(), reliable: false };

  const [rpcResult, assetResult] = await Promise.allSettled([
    getJson(`${API_BASE}/applications/${clientId}/rpc`),
    getJson(`${API_BASE}/oauth2/applications/${clientId}/assets`),
  ]);

  if (rpcResult.status === 'fulfilled') {
    const name = (rpcResult.value as { name?: unknown })?.name;
    if (typeof name === 'string' && name.length > 0) {
      info.name = name;
    }
  } else {
    log(`Could not read application metadata: ${(rpcResult.reason as Error).message}`);
  }

  if (assetResult.status === 'fulfilled' && Array.isArray(assetResult.value)) {
    for (const entry of assetResult.value as Array<{ name?: unknown }>) {
      if (typeof entry?.name === 'string') {
        info.assets.add(entry.name);
      }
    }
    info.reliable = true;
  } else if (assetResult.status === 'rejected') {
    log(`Could not read Rich Presence assets: ${(assetResult.reason as Error).message}`);
  }

  return info;
}

/**
 * Picks the first key that the application actually has an asset for.
 *
 * Sending a key with no matching asset is not a no-op: Discord drops the image
 * entirely, and if the *large* image drops while a small one remains, it
 * promotes the small image into the large slot — which is why a missing app
 * icon shows the language logo at full size.
 */
export function resolveAssetKey(
  info: DiscordAppInfo | undefined,
  ...candidates: Array<string | undefined>
): string | undefined {
  const wanted = candidates.filter((c): c is string => !!c);
  if (wanted.length === 0) { return undefined; }
  // Without a trustworthy asset list, honour the caller's first choice.
  if (!info?.reliable) { return wanted[0]; }
  return wanted.find((key) => info.assets.has(key));
}
