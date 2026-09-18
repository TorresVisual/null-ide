'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDiscordAppInfo = fetchDiscordAppInfo;
exports.resolveAssetKey = resolveAssetKey;
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
async function getJson(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}
async function fetchDiscordAppInfo(clientId, log) {
    const info = { assets: new Set(), reliable: false };
    const [rpcResult, assetResult] = await Promise.allSettled([
        getJson(`${API_BASE}/applications/${clientId}/rpc`),
        getJson(`${API_BASE}/oauth2/applications/${clientId}/assets`),
    ]);
    if (rpcResult.status === 'fulfilled') {
        const name = rpcResult.value?.name;
        if (typeof name === 'string' && name.length > 0) {
            info.name = name;
        }
    }
    else {
        log(`Could not read application metadata: ${rpcResult.reason.message}`);
    }
    if (assetResult.status === 'fulfilled' && Array.isArray(assetResult.value)) {
        for (const entry of assetResult.value) {
            if (typeof entry?.name === 'string') {
                info.assets.add(entry.name);
            }
        }
        info.reliable = true;
    }
    else if (assetResult.status === 'rejected') {
        log(`Could not read Rich Presence assets: ${assetResult.reason.message}`);
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
function resolveAssetKey(info, ...candidates) {
    const wanted = candidates.filter((c) => !!c);
    if (wanted.length === 0) {
        return undefined;
    }
    // Without a trustworthy asset list, honour the caller's first choice.
    if (!info?.reliable) {
        return wanted[0];
    }
    return wanted.find((key) => info.assets.has(key));
}
//# sourceMappingURL=discordAppInfo.js.map