'use strict';

/** Escapes text for element content. Null/undefined become "". */
function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a value for a double-quoted attribute. Same set as escapeHtml; the name documents the call site. */
function escapeAttr(s: unknown): string {
  return escapeHtml(s);
}
