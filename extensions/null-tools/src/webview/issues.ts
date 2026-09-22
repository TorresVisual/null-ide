'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  closedLocally?: boolean;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

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
  const searchToggleBtn  = document.getElementById('search-toggle-btn') as HTMLButtonElement;
  const filterToggleBtn  = document.getElementById('filter-toggle-btn') as HTMLButtonElement;
  const searchBar        = document.getElementById('search-bar') as HTMLDivElement;
  const filterPopover    = document.getElementById('filter-popover') as HTMLDivElement;

  newIssueBtn.addEventListener('click', () => vscode.postMessage({ type: 'createIssue' }));
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
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

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function labelChipStyle(hex: string): string {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return `background:#${hex};color:${luminance > 128 ? '#111' : '#fff'}`;
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
    if (labels.length === 0) {
      labelPicker.innerHTML = '<span class="issue-meta">No labels in this repo.</span>';
      return;
    }
    labelPicker.innerHTML = labels.map(l => `
      <label class="chip-check">
        <input type="checkbox" value="${escapeHtml(l.name)}" ${selectedLabels.has(l.name) ? 'checked' : ''}>
        <span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>
      </label>`).join('');
    labelPicker.querySelectorAll<HTMLInputElement>('input').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedLabels.add(cb.value);
        else selectedLabels.delete(cb.value);
        sendFilters();
      });
    });
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
        <span class="state-dot" title="${issue.state}"></span>
        <div class="issue-main">
          <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span>${you ? '<span class="you-badge">@you</span>' : ''}${issue.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}</div>
          <div class="issue-meta">
            ${issue.labels.map(l => `<span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
            ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
          </div>
        </div>
        <div class="row-actions">
          <button class="copy-btn" title="Copy as prompt">📋</button>
          <button class="browser-btn" title="Open in browser">↗</button>
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
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1200);
        }
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
