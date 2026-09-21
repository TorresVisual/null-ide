'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function () {
  const vscode = acquireVsCodeApi();

  const stateSelect      = document.getElementById('state-select') as HTMLSelectElement;
  const assigneeMe       = document.getElementById('assignee-me') as HTMLButtonElement;
  const assigneeEveryone = document.getElementById('assignee-everyone') as HTMLButtonElement;
  const labelInput       = document.getElementById('label-input') as HTMLInputElement;
  const searchInput      = document.getElementById('search-input') as HTMLInputElement;
  const listEl           = document.getElementById('list') as HTMLDivElement;

  let assignee: 'me' | 'everyone' = 'everyone';
  let selectedNumber: number | null = null;
  let viewerLogin: string | null = null;

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function sendFilters(): void {
    vscode.postMessage({
      type: 'setFilters',
      labels: labelInput.value.split(',').map(s => s.trim()).filter(Boolean),
      assignee,
      query: searchInput.value,
    });
  }

  stateSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'setState', state: stateSelect.value });
  });
  labelInput.addEventListener('input', sendFilters);
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
          <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span>${you ? '<span class="you-badge">@you</span>' : ''}</div>
          <div class="issue-meta">
            ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
            ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
          </div>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll<HTMLDivElement>('.issue-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedNumber = Number(row.dataset.number);
        vscode.postMessage({ type: 'selectIssue', number: selectedNumber });
        listEl.querySelectorAll('.issue-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
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
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
