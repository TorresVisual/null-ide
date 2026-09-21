'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
}
interface GithubComment { id: number; user: GithubUser; body: string; created_at: string; }

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function () {
  const vscode = acquireVsCodeApi();
  const detailEl = document.getElementById('detail') as HTMLDivElement;

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function renderDetail(issue: GithubIssue, comments: GithubComment[]): void {
    detailEl.innerHTML = `
      <h2><span class="state-badge${issue.state === 'closed' ? ' closed' : ''}">${issue.state}</span> #${issue.number} ${escapeHtml(issue.title)}</h2>
      <div class="issue-meta">
        ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
        opened by ${escapeHtml(issue.user.login)} · ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
      </div>
      <div>
        <button class="action" id="copy-btn">Copy as prompt</button>
        <button class="action" id="browser-btn">Open in browser ↗</button>
      </div>
      <div id="detail-body">${escapeHtml(issue.body || '(no description)')}</div>
      <div id="comments">
        ${comments.map(c => `
          <div class="comment">
            <span class="comment-author">${escapeHtml(c.user.login)}</span>
            <span class="issue-meta">${c.created_at.slice(0, 10)}</span>
            <div>${escapeHtml(c.body)}</div>
          </div>`).join('') || '<div class="issue-meta">No comments.</div>'}
      </div>`;
    document.getElementById('copy-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'copyAsPrompt' }));
    document.getElementById('browser-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'openInBrowser' }));
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'issueDetail':
        renderDetail(msg.issue, msg.comments);
        break;
      case 'copied': {
        const btn = detailEl.querySelector('#copy-btn');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => { if (btn) btn.textContent = 'Copy as prompt'; }, 1500);
        }
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
