'use strict';

type TabId = 'queue' | 'library' | 'playlists';
type Segment = 'tracks' | 'albums' | 'artists';
type Detail = { kind: 'album' | 'artist'; id: string };

/** The webview's copy of the host snapshots, plus UI-only state. Views read this and never mutate the snapshot half. */
const app = {
  player: null as WirePlayerState | null,
  unavailable: new Set<string>(),
  unavailableKey: '',
  queue: { history: [] as WireQueueItem[], current: null as WireQueueItem | null, upcoming: [] as WireQueueItem[], reorderable: true },
  tracks: [] as WireTrack[],
  byId: new Map<string, WireTrack>(),
  folders: [] as WireFolder[],
  playlists: [] as WirePlaylist[],
  scan: { scanned: 0, total: 0 },
  extensions: [] as string[],
  liked: new Set<string>(),
  libraryLoaded: false,
  // UI-only
  tab: 'queue' as TabId,
  segment: 'tracks' as Segment,
  likedOnly: false,
  sort: 'title' as SortKey,
  query: '',
  libraryDetail: null as Detail | null,
  playlistId: null as string | null,
  showFolders: false,
  historyOpen: false,
  /** Scroll offset saved when a detail view opens, and whether the next render of the list should go back to it. */
  detailScroll: 0,
  restoreScroll: false,
};

/** Each tab's view registers itself here (at the bottom of its file); main.ts calls the active one. */
const tabRenderers: Partial<Record<TabId, (el: HTMLElement) => void>> = {};

const dirty = { player: false, header: false, content: false };
let flushQueued = false;

/** Coalesces renders into one animation frame (frames are also skipped while the view is hidden). */
function invalidate(part: 'player' | 'header' | 'content'): void {
  dirty[part] = true;
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(() => {
    flushQueued = false;
    if (dirty.player) {
      dirty.player = false;
      renderPlayer();
    }
    if (dirty.header) {
      dirty.header = false;
      renderHeader();
    }
    if (dirty.content) {
      dirty.content = false;
      renderContent();
    }
  });
}

function setQuery(query: string): void {
  app.query = query;
  invalidate('header'); // keeps the search box in sync when a view clears the query
  invalidate('content');
}

/** Jump from the player's artist/album text into the Library detail view. */
function openInLibrary(kind: 'album' | 'artist', id: string): void {
  app.query = '';
  app.libraryDetail = { kind, id };
  app.segment = kind === 'album' ? 'albums' : 'artists';
  app.showFolders = false;
  setTab('library');
}
