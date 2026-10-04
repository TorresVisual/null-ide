'use strict';

interface GithubLabel { name: string; color: string; description?: string | null; }
interface GithubUser { login: string; avatar_url: string; }
interface ListIssue {
  number: number; title: string; state: string; state_reason?: string | null; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number;
  created_at?: string; updated_at: string; closed_at?: string | null;
  milestone?: { number: number; title: string } | null; issue_type?: string | null;
  sub_issues?: { total: number; completed: number } | null; linked_prs?: number; closedLocally?: boolean;
}
/** What the row markup depends on beyond the issue itself, so `reconcile` re-renders a row when any of it changes. */
type RowView = ListIssue & { you: boolean; clock: number };
interface QueryView { state: 'open' | 'closed' | 'all'; selected: Record<string, string[]>; sort: string | null; }
interface Metadata {
  labels: GithubLabel[]; assignees: GithubUser[]; milestones: Array<{ number: number; title: string }>;
  types: Array<{ id: string; name: string }>;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function () {
  const vscode = acquireVsCodeApi();
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  const progressEl = el('progress');
  const newIssueBtn = el('new-issue-btn');
  const refreshBtn = el('refresh-btn');
  const markReadBtn = el('mark-read-btn');
  const fullViewBtn = el('full-view-btn');
  const presetsBtn = el('presets-btn');
  const searchInput = el<HTMLInputElement>('search-input');
  const tabOpen = el('tab-open');
  const tabClosed = el('tab-closed');
  const dropdownsEl = el('dropdowns');
  const bannerEl = el('banner');
  const listEl = el('list');
  const messageEl = el('message');
  const rowsEl = el('rows');
  const toastEl = el('toast');

  const DROPDOWNS = [
    { key: 'author', title: 'Author' }, { key: 'label', title: 'Labels' }, { key: 'assignee', title: 'Assignees' },
    { key: 'milestone', title: 'Milestones' }, { key: 'type', title: 'Types' }, { key: 'sort', title: 'Sort' },
  ];
  const SORTS: Array<[string, string]> = [
    ['created-desc', 'Newest'], ['created-asc', 'Oldest'],
    ['updated-desc', 'Recently updated'], ['comments-desc', 'Most commented'],
  ];
  const PRESETS: Array<[string, string]> = [
    ['is:open', 'Open issues'], ['is:open assignee:@me', 'Assigned to me'], ['is:open author:@me', 'Created by me'],
    ['is:open mentions:@me', 'Mentioning me'], ['is:open sort:updated-desc', 'Recently updated'],
  ];

  let query = '';
  let defaultQuery = 'is:open';
  let view: QueryView = { state: 'open', selected: {}, sort: null };
  let items: ListIssue[] = [];
  let byNumber = new Map<number, ListIssue>();
  let openCount: number | null = null;
  let closedCount: number | null = null;
  let hasMore = false;
  let loading = false;
  let metadata: Metadata | null = null;
  let viewerLogin: string | null = null;
  let selectedNumber: number | null = null;
  let searchTimer: number | undefined;
  let countdownTimer: number | undefined;
  let toastTimer: number | undefined;

  newIssueBtn.innerHTML = octicon('plus');
  refreshBtn.innerHTML = octicon('sync');
  markReadBtn.innerHTML = octicon('check');
  fullViewBtn.innerHTML = octicon('screen-full');
  presetsBtn.innerHTML = `Filters ${octicon('triangle-down')}`;

  function avatarHtml(user: GithubUser): string {
    if (!user.avatar_url) return '';
    const src = `${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}s=40`;
    return `<img class="avatar" src="${escapeHtml(src)}" alt="" title="${escapeHtml(user.login)}" width="20" height="20">`;
  }

  function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function rowHtml(r: RowView): string {
    const closed = r.state === 'closed';
    const when = closed && r.closed_at ? `closed ${timeHtml(r.closed_at)}` : `opened ${timeHtml(r.created_at || r.updated_at)}`;
    const prs = r.linked_prs
      ? `<span class="count" title="${plural(r.linked_prs, 'linked pull request')}">${octicon('git-pull-request')} ${r.linked_prs}</span>` : '';
    const avatars = r.assignees.length ? `<span class="avatars">${r.assignees.map(avatarHtml).join('')}</span>` : '';
    const comments = r.comments
      ? `<span class="count" title="${plural(r.comments, 'comment')}">${octicon('comment')} ${r.comments}</span>` : '';
    const counts = prs + avatars + comments;
    const milestone = r.milestone ? ` · ${octicon('milestone')} ${escapeHtml(r.milestone.title)}` : '';
    const sub = r.sub_issues
      ? ` · <span class="sub-progress" title="${r.sub_issues.completed} of ${plural(r.sub_issues.total, 'sub-issue')} done"><span style="width:${Math.round(100 * r.sub_issues.completed / r.sub_issues.total)}%"></span></span> ${r.sub_issues.completed} of ${r.sub_issues.total}`
      : '';
    const type = r.issue_type ? ` · ${escapeHtml(r.issue_type)}` : '';
    return `
      <div class="issue-row${closed ? ' closed' : ''}${r.number === selectedNumber ? ' selected' : ''}" data-number="${r.number}">
        <span class="row-state">${issueStateIcon(r.state, r.state_reason)}</span>
        <div class="issue-main">
          <div class="row-top">
            <span class="issue-title">${escapeHtml(r.title)}</span>
            ${r.labels.map(l => `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
            ${r.you ? '<span class="you-badge">@you</span>' : ''}
            ${r.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}
          </div>
          <div class="row-sub"><span class="issue-num">#${r.number}</span> · ${escapeHtml(r.user.login)} ${when}${milestone}${sub}${type}<span class="row-inline">${counts}</span></div>
        </div>
        <div class="row-right">${counts}</div>
        <button type="button" class="row-menu-btn icon-btn" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
      </div>`;
  }

  function showMessage(html: string): void {
    messageEl.innerHTML = html;
    messageEl.classList.remove('hidden');
  }

  function clearStatus(): void {
    clearInterval(countdownTimer);
    bannerEl.classList.add('hidden');
    messageEl.classList.add('hidden');
  }

  function applyLocalFilter(): void {
    rowsEl.querySelectorAll<HTMLElement>('.issue-row').forEach(row => {
      const issue = byNumber.get(Number(row.dataset.number));
      row.classList.toggle('filtered', !!issue && !matchesLocalFilter(issue, activeLocalFilter(searchInput.value, query)));
    });
  }

  function renderRows(): void {
    byNumber = new Map(items.map(i => [i.number, i]));
    // Rows re-render when this 5-minute bucket changes, which keeps "3 minutes ago" honest without a timer.
    const clock = Math.floor(Date.now() / 300000);
    const rows: RowView[] = items.map(i => ({
      ...i, you: !!viewerLogin && i.assignees.some(a => a.login === viewerLogin), clock,
    }));
    reconcile(rowsEl, rows, r => String(r.number), r => {
      const holder = document.createElement('div');
      holder.innerHTML = rowHtml(r);
      return holder.firstElementChild as HTMLElement;
    });
    applyLocalFilter();
    if (items.length === 0) {
      showMessage('No results matched your search.<br><button type="button" class="action" id="clear-filters">Clear filters</button>');
    }
  }

  function renderTabs(): void {
    const count = (n: number | null): string => (n === null ? '' : ` <span class="tab-count">${n}</span>`);
    tabOpen.innerHTML = `${octicon('issue-opened')} Open${count(openCount)}`;
    tabClosed.innerHTML = `${octicon('issue-closed')} Closed${count(closedCount)}`;
    tabOpen.classList.toggle('active', view.state === 'open');
    tabClosed.classList.toggle('active', view.state === 'closed');
  }

  function renderDropdowns(): void {
    const shown = DROPDOWNS.filter(d => {
      if (d.key === 'milestone') return !!metadata && metadata.milestones.length > 0;
      if (d.key === 'type') return !!metadata && metadata.types.length > 0;
      return true;
    });
    dropdownsEl.innerHTML = shown.map(d => {
      const active = d.key === 'sort' ? view.sort !== null : (view.selected[d.key] || []).length > 0;
      return `<button type="button" class="gh-btn filter-btn${active ? ' active' : ''}" data-key="${d.key}">${d.title} ${octicon('triangle-down')}</button>`;
    }).join('');
  }

  function isSelected(key: string, value: string): boolean {
    if (key === 'sort') return view.sort === value;
    return (view.selected[key] || []).some(s => s.toLowerCase() === value.toLowerCase());
  }

  function dropdownItems(key: string): PickerItem[] {
    if (key === 'sort') return SORTS.map(([value, label]) => ({ value, label, selected: isSelected(key, value) }));
    if (!metadata) return [];
    switch (key) {
      case 'label':
        return metadata.labels.map(l => ({
          value: l.name, label: l.name, description: l.description || undefined, selected: isSelected(key, l.name),
          html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
        }));
      case 'author':
      case 'assignee':
        return metadata.assignees.map(u => ({
          value: u.login, label: u.login, selected: isSelected(key, u.login), html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
        }));
      case 'milestone':
        return metadata.milestones.map(m => ({ value: m.title, label: m.title, selected: isSelected(key, m.title) }));
      case 'type':
        return metadata.types.map(t => ({ value: t.name, label: t.name, selected: isSelected(key, t.name) }));
    }
    return [];
  }

  function openDropdown(key: string, anchor: HTMLElement): void {
    openPicker({
      anchor,
      title: DROPDOWNS.find(d => d.key === key)!.title,
      items: dropdownItems(key),
      multi: key === 'label',
      filterable: key !== 'sort',
      emptyText: metadata || key === 'sort' ? 'Nothing to show' : 'Loading…',
      onSelect: value => {
        if (key === 'label') vscode.postMessage({ type: 'editQuery', op: 'toggle', key, value });
        else vscode.postMessage({ type: 'editQuery', op: isSelected(key, value) ? 'remove' : 'set', key, value });
      },
    });
  }

  function select(number: number | null): void {
    selectedNumber = number;
    rowsEl.querySelectorAll<HTMLElement>('.issue-row').forEach(row => {
      const on = Number(row.dataset.number) === number;
      row.classList.toggle('selected', on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveSelection(delta: number): void {
    const rows = Array.from(rowsEl.querySelectorAll<HTMLElement>('.issue-row:not(.filtered)'));
    if (rows.length === 0) return;
    const current = rows.findIndex(r => Number(r.dataset.number) === selectedNumber);
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    select(Number(rows[next].dataset.number));
  }

  function sendQuery(): void {
    clearTimeout(searchTimer);
    if (searchInput.value.trim() !== query) vscode.postMessage({ type: 'query', text: searchInput.value });
  }

  function maybeLoadMore(): void {
    if (!hasMore || loading) return;
    if (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 300) return;
    loading = true;
    vscode.postMessage({ type: 'loadMore' });
  }

  function toast(text: string): void {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 1500);
  }

  function showRateLimit(retryAt: number, willRetry: boolean): void {
    clearInterval(countdownTimer);
    const retryButton = '<button type="button" class="link" data-act="retry">Retry now</button>';
    const tick = (): void => {
      const seconds = Math.ceil((retryAt - Date.now()) / 1000);
      const wait = seconds > 0 ? (willRetry ? `retrying in ${seconds}s` : `resets in ${seconds}s`) : 'ready to retry';
      bannerEl.innerHTML = `Rate limited · ${wait} · ${retryButton}`;
      if (seconds <= 0) clearInterval(countdownTimer);
    };
    tick();
    bannerEl.classList.remove('hidden');
    countdownTimer = window.setInterval(tick, 1000);
  }

  function onResults(msg: {
    query: string; state: QueryView['state']; selected: QueryView['selected']; sort: string | null;
    viewerLogin: string | null; items: ListIssue[]; openCount: number | null; closedCount: number | null;
    hasMore: boolean; append: boolean;
  }): void {
    clearStatus();
    query = msg.query;
    view = { state: msg.state, selected: msg.selected, sort: msg.sort };
    if (msg.viewerLogin) viewerLogin = msg.viewerLogin;
    openCount = msg.openCount;
    closedCount = msg.closedCount;
    hasMore = msg.hasMore;
    // Don't overwrite what the user is typing; the echo of their own Enter/pause carries the same text anyway.
    if (document.activeElement !== searchInput) searchInput.value = msg.query;
    items = msg.append ? items.concat(msg.items) : msg.items;
    renderTabs();
    renderDropdowns();
    renderRows();
    requestAnimationFrame(maybeLoadMore);
  }

  function onStatus(msg: { kind: string; message?: string; retryAt?: number; willRetry?: boolean }): void {
    if (msg.kind === 'offline') {
      bannerEl.innerHTML = `<span title="${escapeHtml(msg.message || '')}">Offline · showing cached results</span> · <button type="button" class="link" data-act="retry">Retry</button>`;
      bannerEl.classList.remove('hidden');
      return;
    }
    if (items.length === 0) rowsEl.replaceChildren(); // drops the loading skeleton
    if (msg.kind === 'rate-limited') {
      showRateLimit(msg.retryAt || Date.now(), !!msg.willRetry);
      return;
    }
    items = [];
    byNumber = new Map();
    rowsEl.replaceChildren();
    const texts: Record<string, string> = {
      'no-workspace': 'Open a folder to browse its GitHub issues.',
      'no-remote': 'This folder has no GitHub remote.',
      'signed-out': 'Sign in to GitHub to view issues.',
      error: msg.message || 'Failed to load issues.',
    };
    showMessage(`${escapeHtml(texts[msg.kind] || 'Failed to load issues.')}${
      msg.kind === 'signed-out' ? '<br><button type="button" class="action" id="signin-btn">Sign in</button>'
        : msg.kind === 'error' ? '<br><button type="button" class="action" id="retry-btn">Retry</button>' : ''}`);
  }

  newIssueBtn.addEventListener('click', () => vscode.postMessage({ type: 'create' }));
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  markReadBtn.addEventListener('click', () => vscode.postMessage({ type: 'markRead' }));
  fullViewBtn.addEventListener('click', () => vscode.postMessage({ type: 'openFullView' }));

  presetsBtn.addEventListener('click', () => openPicker({
    anchor: presetsBtn, title: 'Filters', filterable: false,
    items: PRESETS.map(([value, label]) => ({ value, label, selected: value === query })),
    onSelect: value => vscode.postMessage({ type: 'query', text: value }),
  }));

  tabOpen.addEventListener('click', () => vscode.postMessage({ type: 'editQuery', op: 'set', key: 'state', value: 'open' }));
  tabClosed.addEventListener('click', () => vscode.postMessage({ type: 'editQuery', op: 'set', key: 'state', value: 'closed' }));
  dropdownsEl.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
    if (button) openDropdown(button.dataset.key!, button);
  });

  searchInput.addEventListener('input', () => {
    applyLocalFilter();
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(sendQuery, 400);
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendQuery();
    else if (e.key === 'Escape') searchInput.blur();
  });

  rowsEl.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.issue-row');
    if (!row) return;
    const number = Number(row.dataset.number);
    const menuButton = target.closest<HTMLElement>('.row-menu-btn');
    if (menuButton) {
      openPicker({
        anchor: menuButton, title: `#${number}`, filterable: false,
        items: [
          { value: 'branch', label: 'Create branch' }, { value: 'worktree', label: 'Create worktree' },
          { value: 'copyPrompt', label: 'Copy as prompt' }, { value: 'browser', label: 'Open on github.com' },
        ],
        onSelect: action => vscode.postMessage({ type: 'rowAction', action, number }),
      });
      return;
    }
    select(number);
    vscode.postMessage({ type: 'open', number, newTab: e.ctrlKey || e.metaKey });
  });
  // Middle-click opens a tab of its own. Without the mousedown guard Chromium starts autoscroll instead.
  rowsEl.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  rowsEl.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.issue-row');
    if (!row || (e.target as HTMLElement).closest('.row-menu-btn')) return;
    const number = Number(row.dataset.number);
    select(number);
    vscode.postMessage({ type: 'open', number, newTab: true });
  });

  messageEl.addEventListener('click', e => {
    const id = (e.target as HTMLElement).id;
    if (id === 'signin-btn') vscode.postMessage({ type: 'signIn' });
    else if (id === 'retry-btn') vscode.postMessage({ type: 'refresh' });
    else if (id === 'clear-filters') vscode.postMessage({ type: 'query', text: defaultQuery });
  });
  bannerEl.addEventListener('click', e => {
    if ((e.target as HTMLElement).dataset.act === 'retry') vscode.postMessage({ type: 'refresh' });
  });
  listEl.addEventListener('scroll', maybeLoadMore, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey) return;
    if (document.querySelector('.picker')) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter' && selectedNumber !== null) vscode.postMessage({ type: 'open', number: selectedNumber, newTab: true });
      return;
    }
    switch (e.key) {
      case '/': e.preventDefault(); searchInput.focus(); searchInput.select(); break;
      case 'j': case 'ArrowDown': e.preventDefault(); moveSelection(1); break;
      case 'k': case 'ArrowUp': e.preventDefault(); moveSelection(-1); break;
      case 'Enter': if (selectedNumber !== null) vscode.postMessage({ type: 'open', number: selectedNumber }); break;
      case 'c': e.preventDefault(); vscode.postMessage({ type: 'create' }); break;
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        query = msg.query;
        defaultQuery = msg.defaultQuery;
        searchInput.value = msg.query;
        fullViewBtn.classList.toggle('hidden', !msg.compact);
        break;
      case 'results':
        onResults(msg);
        break;
      case 'metadata':
        metadata = { labels: msg.labels, assignees: msg.assignees, milestones: msg.milestones, types: msg.types };
        if (msg.viewerLogin) viewerLogin = msg.viewerLogin;
        renderDropdowns();
        break;
      case 'loading':
        loading = msg.on;
        progressEl.classList.toggle('hidden', !msg.on);
        if (!msg.on) maybeLoadMore();
        break;
      case 'status':
        onStatus(msg);
        break;
      case 'rowActionDone':
        if (msg.action === 'copyPrompt') toast('Copied as prompt');
        break;
    }
  });

  renderTabs();
  vscode.postMessage({ type: 'ready' });
})();
