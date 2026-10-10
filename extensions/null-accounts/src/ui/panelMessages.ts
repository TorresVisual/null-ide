'use strict';

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'add' }
  | { type: 'remove'; id: string }
  | { type: 'editEmail' | 'setGlobalIdentity'; id: string }
  | { type: 'reauth'; id: string }
  | { type: 'unbind'; key: string }
  | { type: 'generateKey' | 'attachKey' | 'copyPublicKey' | 'uploadKey' | 'testKey' | 'removeKey'; id: string }
  | { type: 'setSigning'; id: string; on: boolean };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Webview messages are untrusted: accept only the exact shapes the host handles, copying known fields only. */
export function parsePanelMessage(raw: unknown): PanelMessage | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const m = raw as Record<string, unknown>;
  const type = m.type;
  switch (type) {
    case 'ready':
    case 'add':
      return { type };
    case 'remove':
    case 'editEmail':
    case 'setGlobalIdentity':
    case 'reauth':
    case 'generateKey':
    case 'attachKey':
    case 'copyPublicKey':
    case 'uploadKey':
    case 'testKey':
    case 'removeKey':
      return nonEmpty(m.id) ? { type, id: m.id } : undefined;
    case 'setSigning':
      return nonEmpty(m.id) && typeof m.on === 'boolean' ? { type, id: m.id, on: m.on } : undefined;
    case 'unbind':
      return nonEmpty(m.key) ? { type, key: m.key } : undefined;
    default:
      return undefined;
  }
}
