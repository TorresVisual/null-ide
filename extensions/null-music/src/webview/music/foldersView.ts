'use strict';

function closeFolders(): void {
  app.showFolders = false;
  app.restoreScroll = true;
  invalidate('content');
}

function folderPath(uri: string): string {
  try {
    return decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
  } catch {
    return uri;
  }
}

function folderRow(f: WireFolder): HTMLElement {
  const path = folderPath(f.uri);
  return h(
    'div',
    { class: 'np-row np-folder-row' },
    icon('folder'),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, f.name), h('div', { class: 'np-row-sub', title: path }, path + ' · ' + plural(f.trackCount, 'track', 'tracks'))),
    iconButton('close', 'Remove folder ' + f.name, () => send({ type: 'removeFolder', uri: f.uri }), 'np-remove')
  );
}

function renderFoldersView(el: HTMLElement): void {
  const head = h('div', { class: 'np-detail-head' }, iconButton('back', 'Back', closeFolders, 'np-back'), h('div', { class: 'np-detail-text' }, h('div', { class: 'np-detail-title' }, 'Music folders')));
  const actions = h('div', { class: 'np-detail-actions' }, textButton('Add folder', () => send({ type: 'addFolder' }), true), textButton('Rescan', () => send({ type: 'rescan' })));
  const body = app.folders.length === 0 ? emptyState('folder', 'No folders yet', 'Add a folder to scan it for music.') : h('div', { class: 'np-list' }, ...app.folders.map(folderRow));
  el.replaceChildren(head, actions, body);
}
