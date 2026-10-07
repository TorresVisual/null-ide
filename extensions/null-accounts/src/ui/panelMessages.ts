'use strict';

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'add' }
  | { type: 'remove'; id: string }
  | { type: 'editEmail'; id: string }
  | { type: 'reauth'; id: string }
  | { type: 'unbind'; key: string };

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
    case 'reauth':
      return nonEmpty(m.id) ? { type, id: m.id } : undefined;
    case 'unbind':
      return nonEmpty(m.key) ? { type, key: m.key } : undefined;
    default:
      return undefined;
  }
}
