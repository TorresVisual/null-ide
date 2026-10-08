'use strict';

/** Square cover, or the ∅ placeholder tinted from `seed` when there is no art (or it fails to load). */
function cover(artUrl: string | undefined, seed: string, cls: string): HTMLElement {
  const box = h('div', { class: 'np-cover ' + cls });
  const placeholder = () => {
    box.classList.add('np-cover-ph');
    box.style.setProperty('--hue', String(placeholderHue(seed)));
    box.replaceChildren(h('span', { class: 'np-ph-mark', 'aria-hidden': 'true' }, '∅'));
  };
  if (artUrl) {
    const img = h('img', { src: artUrl, alt: '', loading: 'lazy', draggable: 'false' });
    img.addEventListener('error', placeholder);
    box.appendChild(img);
  } else {
    placeholder();
  }
  return box;
}

function likeButton(trackId: string): HTMLButtonElement {
  return iconButton('heart', 'Like', () => send({ type: 'toggleLike', trackId }), 'np-like');
}

interface RowOptions {
  /** Search text to highlight in the title/artist. */
  query?: string;
  onPlay: () => void;
  /** Queue rows: the stable entry key (also decides "playing" for that row). */
  key?: number;
  /** Extra trailing controls (e.g. the queue's remove button). */
  extra?: HTMLElement[];
}

function trackRow(t: WireTrack, o: RowOptions): HTMLElement {
  const q = o.query || '';
  const row = h(
    'div',
    {
      class: 'np-row',
      role: 'option',
      tabindex: -1,
      'data-row': true,
      'data-track-id': t.id,
      'data-key': o.key === undefined ? null : o.key,
      'data-vscode-context': trackContext(t.id),
    },
    h('div', { class: 'np-thumb-wrap' }, cover(t.artUrl, t.album || t.name, 'np-thumb'), h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, ...markText(t.name, q)), h('div', { class: 'np-row-sub' }, ...markText(t.artist || 'Unknown artist', q))),
    h('span', { class: 'np-warn', title: 'This file could not be played' }, icon('warning')),
    h('span', { class: 'np-row-time' }, formatTime(t.durationMs)),
    likeButton(t.id),
    ...(o.extra || [])
  );
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    o.onPlay();
  });
  return row;
}

function emptyState(iconName: string, title: string, body: string, actions: HTMLElement[] = []): HTMLElement {
  return h('div', { class: 'np-empty' }, icon(iconName), h('div', { class: 'np-empty-title' }, title), body ? h('div', { class: 'np-empty-body' }, body) : null, actions.length ? h('div', { class: 'np-empty-actions' }, ...actions) : null);
}

/** True until the user has added a folder or playlist (and the first library snapshot has arrived). */
function hasNoSources(): boolean {
  return app.libraryLoaded && app.folders.length === 0 && app.playlists.length === 0;
}

function noLibraryState(): HTMLElement {
  return emptyState('note', 'Add a music folder', 'Null Music plays audio files from folders on this computer, and .m3u8 playlists.', [
    textButton('Add folder', () => send({ type: 'addFolder' }), true),
    textButton('Import playlist', () => send({ type: 'importPlaylist' })),
  ]);
}

function noResultsState(): HTMLElement {
  return emptyState('search', 'No matches', 'Nothing here matches "' + app.query.trim() + '".', [textButton('Clear search', () => setQuery(''))]);
}

function sectionHeading(label: string): HTMLElement {
  return h('div', { class: 'np-section', role: 'presentation' }, label);
}

const CHUNK = 200;
const ROW_PX = 40;
/** Scroll offset the current render will be restored to; lets chunked lists render enough rows to reach it. */
let wantedScroll = 0;

/**
 * Appends `items` to `parent` CHUNK rows at a time, adding the next chunk as a sentinel scrolls near the view.
 * // ponytail: no virtualisation, so a 10k-track list ends up with 10k rows once scrolled to the bottom; add windowing if that lags.
 */
function renderChunked<T>(parent: HTMLElement, items: T[], makeRow: (item: T) => HTMLElement): void {
  let shown = 0;
  const sentinel = h('div', { class: 'np-more', 'aria-hidden': 'true' });
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) more(CHUNK);
    },
    { root: contentEl, rootMargin: '200px' }
  );
  function more(count: number): void {
    const next = items.slice(shown, shown + count);
    shown += next.length;
    const fragment = document.createDocumentFragment();
    for (const item of next) fragment.appendChild(makeRow(item));
    parent.insertBefore(fragment, sentinel);
    if (shown >= items.length) {
      observer.disconnect();
      sentinel.remove();
    } else {
      observer.unobserve(sentinel);
      observer.observe(sentinel); // re-fires while the sentinel is still on screen
    }
    updateRowFlags();
  }
  parent.appendChild(sentinel);
  more(Math.max(CHUNK, Math.ceil((wantedScroll + contentEl.clientHeight) / ROW_PX) + CHUNK / 2));
}

function textButton(label: string, onClick: () => void, primary?: boolean): HTMLButtonElement {
  const b = h('button', { class: 'np-text-btn' + (primary ? ' primary' : ''), type: 'button' }, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

/** Roving tabindex: one row is tabbable, ↑/↓ move focus, Enter activates. Alt+arrows are left for reordering. */
function makeRoving(list: HTMLElement): void {
  const rows = () => Array.prototype.slice.call(list.querySelectorAll('[data-row]')) as HTMLElement[];
  const first = rows()[0];
  if (first) first.tabIndex = 0;
  list.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute('data-row')) return;
    for (const r of rows()) r.tabIndex = r === target ? 0 : -1;
  });
  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute('data-row')) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault();
      const all = rows();
      const next = all[Math.max(0, Math.min(all.length - 1, all.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) next.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      target.click();
    }
  });
}

/** Cheap in-place refresh of "playing", "unavailable" and the like toggles after a snapshot, without re-rendering lists. */
function updateRowFlags(): void {
  const s = app.player;
  const currentId = s && s.track ? s.track.id : '';
  const currentKey = app.queue.current ? String(app.queue.current.key) : '';
  document.querySelectorAll('[data-track-id]').forEach((node) => {
    const row = node as HTMLElement;
    const id = row.getAttribute('data-track-id') || '';
    const key = row.getAttribute('data-key');
    row.classList.toggle('playing', key !== null ? key === currentKey : id === currentId);
    row.classList.toggle('unavailable', app.unavailable.has(id));
    const like = row.querySelector('.np-like');
    if (like) like.setAttribute('aria-pressed', String(app.liked.has(id)));
  });
}
