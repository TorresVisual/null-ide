'use strict';

const scanPill = h('span', { class: 'np-pill', role: 'status', hidden: true });
const searchInput = h('input', { class: 'np-search', type: 'search', placeholder: 'Search  ( / )', 'aria-label': 'Search music', spellcheck: 'false' }) as HTMLInputElement;
searchInput.addEventListener('input', () => setQuery(searchInput.value));

const menuEl = h('div', { class: 'np-menu', role: 'menu', hidden: true });
const menuBtn = iconButton('more', 'More actions', () => (menuEl.hidden ? openMenu() : closeMenu()), 'np-menu-btn');
menuBtn.setAttribute('aria-haspopup', 'menu');
menuBtn.setAttribute('aria-expanded', 'false');

function menuItem(label: string, onClick: () => void): HTMLElement {
  const b = h('button', { class: 'np-menu-item', type: 'button', role: 'menuitem' }, label);
  b.addEventListener('click', () => {
    closeMenu();
    onClick();
  });
  return b;
}

menuEl.append(
  menuItem('Add folder…', () => send({ type: 'addFolder' })),
  menuItem('Import playlist…', () => send({ type: 'importPlaylist' })),
  menuItem('Manage folders', () => {
    app.detailScroll = contentEl.scrollTop;
    app.showFolders = true;
    invalidate('content');
  }),
  menuItem('Rescan', () => send({ type: 'rescan' }))
);

function openMenu(): void {
  menuEl.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  (menuEl.querySelector('button') as HTMLElement).focus();
}

function closeMenu(): void {
  menuEl.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.prototype.slice.call(menuEl.querySelectorAll('button')) as HTMLElement[];
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
});
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target as Node)) closeMenu();
});

const headerEl = h(
  'header',
  { class: 'np-header' },
  h('div', { class: 'np-header-row' }, h('div', { class: 'np-brand' }, 'Null Music'), scanPill, menuBtn),
  h('div', { class: 'np-search-row' }, searchInput),
  menuEl
);

function renderHeader(): void {
  const scanning = app.scan.total > app.scan.scanned;
  scanPill.hidden = !scanning;
  if (scanning) scanPill.textContent = 'Scanning ' + app.scan.scanned + '/' + app.scan.total;
  if (searchInput.value !== app.query) searchInput.value = app.query;
}

/** Esc: close the menu, then clear the search, then step out of folders / album / playlist detail. */
function navigateBack(): boolean {
  if (!menuEl.hidden) {
    closeMenu();
    menuBtn.focus();
    return true;
  }
  if (app.query) {
    setQuery('');
    return true;
  }
  if (app.showFolders) {
    closeFolders();
    return true;
  }
  if (app.tab === 'library' && app.libraryDetail) {
    closeLibraryDetail();
    return true;
  }
  if (app.tab === 'playlists' && app.playlistId) {
    closePlaylist();
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (navigateBack()) e.preventDefault();
    return;
  }
  const target = e.target as HTMLElement;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(target.tagName) >= 0;
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});
