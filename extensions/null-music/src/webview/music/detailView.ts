'use strict';

interface DetailSpec {
  title: string;
  subtitle: string;
  artUrl?: string;
  /** Seeds the placeholder colour when there is no art. */
  seed: string;
  tracks: WireTrack[];
  /** Artist detail: the artist's albums, shown above the full track list. */
  albums?: Album[];
  onBack: () => void;
}

function renderDetailView(el: HTMLElement, d: DetailSpec): void {
  const visible = d.tracks.filter((t) => matchesTrack(t, app.query));
  const play = (shuffle: boolean) => {
    if (visible.length > 0) send({ type: 'playTracks', ids: visible.map((t) => t.id), startId: visible[0].id, shuffle });
  };
  const playBtn = textButton('Play', () => play(false), true);
  const shuffleBtn = textButton('Shuffle', () => play(true));
  playBtn.disabled = shuffleBtn.disabled = visible.length === 0;

  const parts: HTMLElement[] = [
    h(
      'div',
      { class: 'np-detail-head' },
      iconButton('back', 'Back', d.onBack, 'np-back'),
      cover(d.artUrl, d.seed, 'np-detail-cover'),
      h('div', { class: 'np-detail-text' }, h('div', { class: 'np-detail-title' }, d.title), h('div', { class: 'np-detail-sub' }, d.subtitle))
    ),
    h('div', { class: 'np-detail-actions' }, playBtn, shuffleBtn),
  ];

  if (d.tracks.length === 0) {
    parts.push(emptyState('list', 'No tracks', ''));
  } else if (visible.length === 0) {
    parts.push(noResultsState());
  } else {
    if (d.albums && d.albums.length > 0) parts.push(sectionHeading('Albums'), albumGrid(d.albums), sectionHeading('All tracks'));
    const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': d.title });
    renderChunked(list, visible, (t) => trackRow(t, { query: app.query, onPlay: () => playTrackList(visible, t.id) }));
    makeRoving(list);
    parts.push(list);
  }
  el.replaceChildren(...parts);
}
