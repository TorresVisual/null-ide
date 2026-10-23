// Pure rules for the launcher page. A plain script (no import/export): index.html loads it, and
// launcher/ui-tests/launcher-model.test.mjs loads it through node:vm. Top-level `function` declarations only, no DOM.

/** `rows` in display order (pinned first). Empty groups are left out; `start` is the flat index of a group's first row. */
function groupRows(rows) {
  const pinned = rows.filter((r) => r.pinned);
  const recent = rows.filter((r) => !r.pinned);
  const groups = [];
  if (pinned.length) groups.push({ title: 'Pinned', start: 0, rows: pinned });
  if (recent.length) groups.push({ title: 'Recent', start: pinned.length, rows: recent });
  return groups;
}

function moveSelection(selected, delta, count) {
  return count === 0 ? 0 : (((selected + delta) % count) + count) % count;
}

/** What a key press means for the selected `row` (undefined when the list is empty), or null to leave it to the search box. */
function keyAction({ key, ctrlKey }, row) {
  if (key === 'Escape') return { type: 'close', preventDefault: false };
  if (key === 'ArrowDown') return { type: 'move', delta: 1, preventDefault: true };
  if (key === 'ArrowUp') return { type: 'move', delta: -1, preventDefault: true };
  // preventDefault: the webview would open its print dialog.
  if (ctrlKey && key.toLowerCase() === 'p') return { type: 'pin', preventDefault: true };
  if (key === 'Enter' && row && !row.missing) return { type: 'open', preventDefault: false };
  if (key === 'Delete' && row && !row.pinned) return { type: 'remove', preventDefault: false };
  return null;
}

/** Windows may refuse a fresh window its first focus and report a blur before there ever was a focus; that must not close it. */
function shouldCloseOnBlur(everFocused) {
  return everFocused;
}

function formatAge(timestampMs, nowMs) {
  const s = Math.max(0, (nowMs - timestampMs) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 172800) return 'yesterday';
  const days = Math.floor(s / 86400);
  return days < 30 ? days + 'd ago' : Math.floor(days / 30) + 'mo ago';
}
