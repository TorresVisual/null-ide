'use strict';

const SEGMENTS: Array<[Segment, string]> = [
  ['tracks', 'Tracks'],
  ['albums', 'Albums'],
  ['artists', 'Artists'],
];
const SORTS: Array<[SortKey, string]> = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['duration', 'Duration'],
];

/** Replaces the queue with `list` and starts at `startId`. */
function playTrackList(list: WireTrack[], startId: string): void {
  send({ type: 'playTracks', ids: list.map((t) => t.id), startId });
}

function libraryToolbar(): HTMLElement {
  const segments = h('div', { class: 'np-seg', role: 'group', 'aria-label': 'Browse by' });
  for (const [id, label] of SEGMENTS) {
    const b = h('button', { class: 'np-seg-btn', type: 'button', 'aria-pressed': String(app.segment === id) }, label);
    b.addEventListener('click', () => {
      app.segment = id;
      app.libraryDetail = null;
      invalidate('content');
    });
    segments.appendChild(b);
  }

  const liked = h('button', { class: 'np-chip', type: 'button', 'aria-pressed': String(app.likedOnly) }, icon('heart'), 'Liked');
  liked.addEventListener('click', () => {
    app.likedOnly = !app.likedOnly;
    invalidate('content');
  });

  const sort = h('select', { class: 'np-select', 'aria-label': 'Sort by', disabled: app.query.trim() !== '' || app.segment !== 'tracks' }) as HTMLSelectElement;
  for (const [id, label] of SORTS) sort.appendChild(h('option', { value: id, selected: app.sort === id }, label));
  sort.addEventListener('change', () => {
    app.sort = sort.value as SortKey;
    invalidate('content');
  });

  return h('div', { class: 'np-toolbar np-lib-toolbar' }, segments, liked, sort);
}

/** What the active filters leave of the library (the Liked chip applies to every segment). */
function libraryBase(): WireTrack[] {
  return app.likedOnly ? app.tracks.filter((t) => app.liked.has(t.id)) : app.tracks;
}

function emptyLibraryBody(): HTMLElement {
  if (app.query.trim()) return noResultsState();
  if (app.likedOnly) return emptyState('heart', 'No liked tracks yet', 'Use the heart on a track to keep it here.');
  if (isScanning() || !app.libraryLoaded) return skeletonRows();
  if (app.folders.length > 0) {
    const where = app.folders.map((f) => f.name).join(', ');
    return emptyState('folder', 'No audio files found', 'Looked in ' + where + '. Supported: ' + app.extensions.join(' ') + '.', [
      textButton('Rescan', () => send({ type: 'rescan' }), true),
      textButton('Add folder', () => send({ type: 'addFolder' })),
    ]);
  }
  return emptyState('note', 'No tracks', '');
}

function tracksBody(base: WireTrack[]): HTMLElement {
  const list = app.query.trim() ? rankTracks(base, app.query) : sortTracks(base, app.sort);
  if (list.length === 0) return emptyLibraryBody();
  const body = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Tracks' });
  renderChunked(body, list, (t) => trackRow(t, { query: app.query, onPlay: () => playTrackList(list, t.id) }));
  makeRoving(body);
  return body;
}

function renderLibraryView(el: HTMLElement): void {
  if (hasNoSources()) {
    el.replaceChildren(noLibraryState());
    return;
  }
  if (app.libraryDetail && renderLibraryDetail(el)) return;
  app.libraryDetail = null; // the open album/artist is gone
  const base = libraryBase();
  const body = app.segment === 'albums' ? albumsBody(base) : app.segment === 'artists' ? artistsBody(base) : tracksBody(base);
  el.replaceChildren(libraryToolbar(), body);
}

tabRenderers.library = renderLibraryView;
