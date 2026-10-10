'use strict';

const SESSION_FILES_SHOWN = 20;

/** Table of start, duration, projects, languages and file count; hovering a row lists its files. */
function renderSessions(rows: SessionRow[]): HTMLElement {
  const head = ['Start', 'Duration', 'Projects', 'Languages', 'Files'].map((title) => h('th', { scope: 'col' }, title));
  const body = rows.map((row) =>
    h(
      'tr',
      { title: filesTitle(row.files, SESSION_FILES_SHOWN) },
      h('td', null, formatDateTime(row.start)),
      h('td', null, formatDuration(row.ms)),
      h('td', null, row.projects.join(', ')),
      h('td', null, row.languages.join(', ')),
      h('td', { class: 'num' }, String(row.files.length)),
    ),
  );
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Sessions'),
    h('table', { class: 'sessions' }, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body)),
  );
}
