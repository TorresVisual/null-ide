'use strict';

function openLibraryDetail(kind: 'album' | 'artist', id: string): void {
  app.detailScroll = contentEl.scrollTop;
  app.libraryDetail = { kind, id };
  invalidate('content');
}

function closeLibraryDetail(): void {
  app.libraryDetail = null;
  app.restoreScroll = true;
  invalidate('content');
}

function albumCard(a: Album): HTMLElement {
  const card = h(
    'button',
    { class: 'np-card', type: 'button', 'data-row': true, 'aria-label': a.name + ' by ' + a.artist },
    cover(a.artUrl, a.name, 'np-card-cover'),
    h('div', { class: 'np-card-title' }, ...markText(a.name, app.query)),
    h('div', { class: 'np-card-sub' }, a.artist + (a.year ? ' · ' + a.year : ''))
  );
  card.addEventListener('click', () => openLibraryDetail('album', a.key));
  return card;
}

function albumGrid(albums: Album[]): HTMLElement {
  const grid = h('div', { class: 'np-grid' });
  renderChunked(grid, albums, albumCard);
  return grid;
}

function albumsBody(base: WireTrack[]): HTMLElement {
  const albums = rankItems(groupAlbums(base), app.query, (a) => [a.name, a.artist]);
  if (albums.length === 0) return emptyLibraryBody();
  const grid = albumGrid(albums);
  makeRoving(grid);
  return grid;
}

function plural(n: number, one: string, many: string): string {
  return n + ' ' + (n === 1 ? one : many);
}

function artistRow(a: Artist): HTMLElement {
  const row = h(
    'button',
    { class: 'np-row np-artist-row', type: 'button', 'data-row': true },
    cover(a.artUrl, a.name, 'np-avatar'),
    h(
      'div',
      { class: 'np-row-text' },
      h('div', { class: 'np-row-title' }, ...markText(a.name, app.query)),
      h('div', { class: 'np-row-sub' }, plural(a.albums.length, 'album', 'albums') + ' · ' + plural(a.tracks.length, 'track', 'tracks'))
    )
  );
  row.addEventListener('click', () => openLibraryDetail('artist', a.key));
  return row;
}

function artistsBody(base: WireTrack[]): HTMLElement {
  const artists = rankItems(groupArtists(base), app.query, (a) => [a.name]);
  if (artists.length === 0) return emptyLibraryBody();
  const list = h('div', { class: 'np-list', 'aria-label': 'Artists' });
  renderChunked(list, artists, artistRow);
  makeRoving(list);
  return list;
}

/** Renders the open album/artist; false when it no longer exists (e.g. the folder was removed). */
function renderLibraryDetail(el: HTMLElement): boolean {
  const d = app.libraryDetail;
  if (!d) return false;
  if (d.kind === 'album') {
    const album = groupAlbums(app.tracks).find((a) => a.key === d.id);
    if (!album) return false;
    renderDetailView(el, {
      title: album.name,
      subtitle: album.artist + (album.year ? ' · ' + album.year : '') + ' · ' + plural(album.tracks.length, 'track', 'tracks'),
      artUrl: album.artUrl,
      seed: album.name,
      tracks: album.tracks,
      onBack: closeLibraryDetail,
    });
    return true;
  }
  const artist = groupArtists(app.tracks).find((a) => a.key === d.id);
  if (!artist) return false;
  renderDetailView(el, {
    title: artist.name,
    subtitle: plural(artist.albums.length, 'album', 'albums') + ' · ' + plural(artist.tracks.length, 'track', 'tracks'),
    artUrl: artist.artUrl,
    seed: artist.name,
    tracks: artist.tracks,
    albums: artist.albums,
    onBack: closeLibraryDetail,
  });
  return true;
}
