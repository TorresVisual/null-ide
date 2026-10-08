'use strict';

function openPlaylist(id: string): void {
  app.detailScroll = contentEl.scrollTop;
  app.playlistId = id;
  invalidate('content');
}

function closePlaylist(): void {
  app.playlistId = null;
  app.restoreScroll = true;
  invalidate('content');
}

function playlistArt(p: WirePlaylist): string | undefined {
  const withArt = p.tracks.find((t) => !!t.artUrl);
  return withArt ? withArt.artUrl : undefined;
}

function playlistRow(p: WirePlaylist): HTMLElement {
  const row = h(
    'div',
    { class: 'np-row', role: 'option', tabindex: -1, 'data-row': true },
    cover(playlistArt(p), p.name, 'np-thumb'),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, ...markText(p.name, app.query)), h('div', { class: 'np-row-sub' }, plural(p.tracks.length, 'track', 'tracks'))),
    iconButton('close', 'Remove playlist (keeps the file)', () => send({ type: 'removePlaylist', id: p.id }), 'np-remove')
  );
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    openPlaylist(p.id);
  });
  return row;
}

function renderPlaylistsView(el: HTMLElement): void {
  if (app.playlistId) {
    const pl = app.playlists.find((p) => p.id === app.playlistId);
    if (pl) {
      renderDetailView(el, {
        title: pl.name,
        subtitle: plural(pl.tracks.length, 'track', 'tracks'),
        artUrl: playlistArt(pl),
        seed: pl.name,
        tracks: pl.tracks,
        onBack: closePlaylist,
      });
      return;
    }
    app.playlistId = null; // the open playlist was removed
  }

  if (app.playlists.length === 0) {
    el.replaceChildren(
      hasNoSources()
        ? noLibraryState()
        : emptyState('list', 'No playlists', 'Import an .m3u8 playlist and it shows up here.', [textButton('Import playlist', () => send({ type: 'importPlaylist' }), true)])
    );
    return;
  }

  const toolbar = h(
    'div',
    { class: 'np-toolbar' },
    h('span', { class: 'np-toolbar-title' }, plural(app.playlists.length, 'playlist', 'playlists')),
    textButton('Import', () => send({ type: 'importPlaylist' }))
  );
  const playlists = rankItems(app.playlists, app.query, (p) => [p.name]);
  if (playlists.length === 0) {
    el.replaceChildren(toolbar, noResultsState());
    return;
  }
  const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Playlists' });
  renderChunked(list, playlists, playlistRow);
  makeRoving(list);
  el.replaceChildren(toolbar, list);
}

tabRenderers.playlists = renderPlaylistsView;
