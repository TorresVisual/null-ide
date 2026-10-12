'use strict';

/**
 * Activation events can embed workspace globs or paths (`workspaceContains:**\/x`, `onFileOpen:/home/me/x`).
 * Reports keep only the event type for those; ordinary events (`onLanguage:ts`, `onCommand:x.y`) stay whole.
 */
export function sanitizeEvent(event: string): string {
  const i = event.indexOf(':');
  if (i === -1) return event;
  const head = event.slice(0, i);
  const rest = event.slice(i + 1);
  return head === 'workspaceContains' || /[\\/]/.test(rest) ? head : event;
}
