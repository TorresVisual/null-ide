'use strict';

const contentEl = h('main', { class: 'np-content', id: 'np-content', role: 'tabpanel', tabindex: -1 });
const TABS: Array<[TabId, string]> = [
  ['queue', 'Queue'],
  ['library', 'Library'],
  ['playlists', 'Playlists'],
];
const tabButtons: { [id: string]: HTMLElement } = {};
const tabsEl = h('nav', { class: 'np-tabs', role: 'tablist', 'aria-label': 'Music sections' });
for (const [id, label] of TABS) {
  const b = h('button', { class: 'np-tab', type: 'button', role: 'tab', id: 'np-tab-' + id }, label);
  b.addEventListener('click', () => setTab(id));
  tabButtons[id] = b;
  tabsEl.appendChild(b);
}
tabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const at = TABS.findIndex((t) => t[0] === app.tab);
  const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
  e.preventDefault();
  setTab(next);
  tabButtons[next].focus();
});

function setTab(tab: TabId): void {
  app.showFolders = false;
  app.tab = tab;
  for (const [id] of TABS) {
    const selected = id === tab;
    tabButtons[id].setAttribute('aria-selected', String(selected));
    tabButtons[id].tabIndex = selected ? 0 : -1;
  }
  contentEl.setAttribute('aria-labelledby', 'np-tab-' + tab);
  invalidate('content');
}

let lastViewKey = '';

function viewKey(): string {
  const detail = app.libraryDetail ? app.libraryDetail.kind + ':' + app.libraryDetail.id : '';
  return [app.tab, app.segment, detail, app.playlistId || '', app.showFolders ? 'folders' : ''].join('|');
}

/** Re-renders the active view, keeping the scroll position when it is the same view (or restoring it after "back"). */
function renderContent(): void {
  const key = viewKey();
  wantedScroll = key === lastViewKey ? contentEl.scrollTop : app.restoreScroll ? app.detailScroll : 0;
  lastViewKey = key;
  app.restoreScroll = false;
  const render = app.showFolders ? renderFoldersView : tabRenderers[app.tab];
  if (render) render(contentEl);
  contentEl.scrollTop = wantedScroll;
  updateRowFlags();
}

function trackIdOf(s: WirePlayerState | null): string {
  return s && s.track ? s.track.id : '';
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToWebview;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'player': {
      const previous = app.player;
      const unavailableKey = msg.unavailable.join(',');
      const flagsChanged = trackIdOf(previous) !== trackIdOf(msg.state) || unavailableKey !== app.unavailableKey;
      app.player = msg.state;
      app.unavailable = new Set(msg.unavailable);
      app.unavailableKey = unavailableKey;
      invalidate('player');
      if (flagsChanged) updateRowFlags();
      break;
    }
    case 'queue':
      app.queue = { history: msg.history, current: msg.current, upcoming: msg.upcoming, reorderable: msg.reorderable };
      if (app.tab === 'queue') invalidate('content');
      break;
    case 'library':
      app.tracks = msg.tracks;
      app.byId = new Map(msg.tracks.map((t): [string, WireTrack] => [t.id, t]));
      app.folders = msg.folders;
      app.playlists = msg.playlists;
      app.scan = msg.scan;
      app.extensions = msg.extensions;
      app.libraryLoaded = true;
      invalidate('player');
      invalidate('header');
      // The Queue view only reads the library for its empty state; don't rebuild it (and lose clicks/drags) on every scan tick.
      if (app.tab !== 'queue' || !app.queue.current) invalidate('content');
      break;
    case 'liked':
      app.liked = new Set(msg.ids);
      updateRowFlags();
      if (app.likedOnly) invalidate('content');
      break;
    default:
      handleAudioMessage(msg);
  }
});

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  const role = target.getAttribute('role');
  const interactive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].indexOf(target.tagName) >= 0 || role === 'slider' || role === 'tab';
  if (e.code === 'Space' && !interactive && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    send({ type: 'playPause' });
  }
});

const appRoot = document.getElementById('app') as HTMLElement;
appRoot.append(headerEl, playerEl, tabsEl, contentEl, bannerEl, autoplayEl, audio);
initAudio();
setTab('queue');
send({ type: 'ready' });
