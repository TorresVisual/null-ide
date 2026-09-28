'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; state_reason?: string | null; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  closedLocally?: boolean;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const COPY_ICON = octicon('copy');
const OPEN_ICON = octicon('link-external');
const CHECK_ICON = octicon('check');
const BRANCH_ICON = octicon('git-branch');
const WORKTREE_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/><path d="M4.5 7v3a1 1 0 001 1h3" stroke-linecap="round"/></svg>';

(function () {
  const vscode = acquireVsCodeApi();

  const stateSelect      = document.getElementById('state-select') as HTMLSelectElement;
  const assigneeMe       = document.getElementById('assignee-me') as HTMLButtonElement;
  const assigneeEveryone = document.getElementById('assignee-everyone') as HTMLButtonElement;
  const labelPicker      = document.getElementById('label-picker') as HTMLDivElement;
  const searchInput      = document.getElementById('search-input') as HTMLInputElement;
  const listEl           = document.getElementById('list') as HTMLDivElement;
  const newIssueBtn      = document.getElementById('new-issue-btn') as HTMLButtonElement;
  const refreshBtn       = document.getElementById('refresh-btn') as HTMLButtonElement;
  const markReadBtn      = document.getElementById('mark-read-btn') as HTMLButtonElement;
  const searchToggleBtn  = document.getElementById('search-toggle-btn') as HTMLButtonElement;
  const filterToggleBtn  = document.getElementById('filter-toggle-btn') as HTMLButtonElement;
  const searchBar        = document.getElementById('search-bar') as HTMLDivElement;
  const filterPopover    = document.getElementById('filter-popover') as HTMLDivElement;

  newIssueBtn.addEventListener('click', () => vscode.postMessage({ type: 'createIssue' }));
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  markReadBtn.addEventListener('click', () => vscode.postMessage({ type: 'markRead' }));
  searchToggleBtn.addEventListener('click', () => {
    searchBar.classList.toggle('hidden');
    searchToggleBtn.classList.toggle('active');
    if (!searchBar.classList.contains('hidden')) searchInput.focus();
  });
  filterToggleBtn.addEventListener('click', () => {
    filterPopover.classList.toggle('hidden');
    filterToggleBtn.classList.toggle('active');
  });

  let assignee: 'me' | 'everyone' = 'everyone';
  let selectedNumber: number | null = null;
  let viewerLogin: string | null = null;
  const selectedLabels = new Set<string>();
  let labelDropdownOpen = false;
  let lastRepoLabels: GithubLabel[] = [];

  document.addEventListener('click', e => {
    if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container'))) return;
    if (!labelDropdownOpen) return;
    labelDropdownOpen = false;
    renderLabelPicker(lastRepoLabels);
  });

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function sendFilters(): void {
    vscode.postMessage({
      type: 'setFilters',
      labels: Array.from(selectedLabels),
      assignee,
      query: searchInput.value,
    });
  }

  function renderLabelPicker(labels: GithubLabel[]): void {
    lastRepoLabels = labels;
    if (labels.length === 0) {
      labelPicker.innerHTML = '<span class="issue-meta">No labels in this repo.</span>';
      return;
    }
    const selected = labels.filter(l => selectedLabels.has(l.name));
    labelPicker.innerHTML = `
      <button type="button" class="dropdown-trigger">
        ${selected.length > 0 ? `<span class="selected-tags">${selected.map(l => `
          <span class="tag gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}<span class="tag-remove" data-value="${escapeHtml(l.name)}">&times;</span></span>`).join('')}</span>`
          : '<span class="dropdown-placeholder">Filter by label…</span>'}
        <span class="dropdown-arrow">${labelDropdownOpen ? '▲' : '▼'}</span>
      </button>
      <div class="dropdown-list${labelDropdownOpen ? '' : ' hidden'}">
        ${labels.map(l => `
          <button type="button" class="dropdown-item${selectedLabels.has(l.name) ? ' selected' : ''}" data-value="${escapeHtml(l.name)}">
            <span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>
          </button>`).join('')}
      </div>`;
    labelPicker.querySelector('.dropdown-trigger')?.addEventListener('click', () => {
      labelDropdownOpen = !labelDropdownOpen;
      renderLabelPicker(labels);
    });
    labelPicker.querySelectorAll<HTMLElement>('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
      e.preventDefault();
      selectedLabels.delete(el.dataset.value!);
      renderLabelPicker(labels);
      sendFilters();
    }));
    labelPicker.querySelectorAll<HTMLElement>('.dropdown-item').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.value!;
      if (selectedLabels.has(v)) selectedLabels.delete(v); else selectedLabels.add(v);
      renderLabelPicker(labels);
      sendFilters();
    }));
  }

  stateSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'setState', state: stateSelect.value });
  });
  searchInput.addEventListener('input', sendFilters);
  assigneeMe.addEventListener('click', () => {
    assignee = 'me';
    assigneeMe.classList.add('active');
    assigneeEveryone.classList.remove('active');
    sendFilters();
  });
  assigneeEveryone.addEventListener('click', () => {
    assignee = 'everyone';
    assigneeEveryone.classList.add('active');
    assigneeMe.classList.remove('active');
    sendFilters();
  });

  function renderList(issues: GithubIssue[]): void {
    if (issues.length === 0) {
      listEl.innerHTML = '<div id="empty">No issues match.</div>';
      return;
    }
    listEl.innerHTML = issues.map(issue => {
      const you = viewerLogin && issue.assignees.some(a => a.login === viewerLogin);
      return `
      <div class="issue-row${issue.state === 'closed' ? ' closed' : ''}${issue.number === selectedNumber ? ' selected' : ''}" data-number="${issue.number}">
        <span class="row-state">${issueStateIcon(issue.state, issue.state_reason)}</span>
        <div class="issue-main">
          <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span>${you ? '<span class="you-badge">@you</span>' : ''}${issue.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}</div>
          <div class="issue-meta">
            ${issue.labels.map(l => `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
            ${octicon('comment')} ${issue.comments} · updated ${timeHtml(issue.updated_at)}
          </div>
          <div class="row-actions">
            <button class="branch-btn" title="Create branch for this issue">${BRANCH_ICON}</button>
            <button class="worktree-btn" title="Create worktree for this issue">${WORKTREE_ICON}</button>
            <button class="copy-btn" title="Copy as prompt">${COPY_ICON}</button>
            <button class="browser-btn" title="Open in browser">${OPEN_ICON}</button>
          </div>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll<HTMLDivElement>('.issue-row').forEach(row => {
      const number = Number(row.dataset.number);
      row.addEventListener('click', () => {
        selectedNumber = number;
        vscode.postMessage({ type: 'selectIssue', number });
        listEl.querySelectorAll('.issue-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      });
      row.querySelector('.copy-btn')?.addEventListener('click', ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'copyAsPromptForIssue', number });
      });
      row.querySelector('.browser-btn')?.addEventListener('click', ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'openIssueInBrowser', number });
      });
      row.querySelector('.branch-btn')?.addEventListener('click', ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'createBranchForIssue', number });
      });
      row.querySelector('.worktree-btn')?.addEventListener('click', ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'createWorktreeForIssue', number });
      });
    });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        stateSelect.value = msg.state;
        break;
      case 'issues':
        if (msg.status === 'ok') {
          viewerLogin = msg.viewerLogin ?? viewerLogin;
          if (msg.repoLabels) renderLabelPicker(msg.repoLabels);
          renderList(msg.issues);
        } else {
          const messages: Record<string, string> = {
            'no-workspace': 'Open a folder to browse its GitHub issues.',
            'no-remote': 'This folder has no GitHub remote.',
            'signed-out': 'Sign in to GitHub to view issues.',
            'error': msg.message || 'Failed to load issues.',
          };
          const text = messages[msg.status] || 'Failed to load issues.';
          listEl.innerHTML = `<div id="empty">${escapeHtml(text)}${
            msg.status === 'signed-out' ? '<br><button class="action" id="signin-btn">Sign in</button>' : ''
          }</div>`;
          document.getElementById('signin-btn')?.addEventListener('click', () =>
            vscode.postMessage({ type: 'signIn' }));
        }
        break;
      case 'copiedIssue': {
        const btn = listEl.querySelector<HTMLButtonElement>(`.issue-row[data-number="${msg.number}"] .copy-btn`);
        if (btn) {
          btn.innerHTML = CHECK_ICON;
          setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1200);
        }
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
