'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; avatar_url: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  closedLocally?: boolean;
}
interface GithubComment { id: number; user: GithubUser; body: string; created_at: string; }

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const marked: { parse(src: string): string };
declare const DOMPurify: { sanitize(html: string): string };

(function () {
  const vscode = acquireVsCodeApi();
  const detailEl = document.getElementById('detail') as HTMLDivElement;

  let editing = false;
  let currentIssue: GithubIssue | null = null;
  let lastComments: GithubComment[] = [];
  let repoLabels: GithubLabel[] = [];
  let assignableUsers: GithubUser[] = [];
  let viewerLogin: string | null = null;
  let editingCommentId: number | null = null;

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function labelChipStyle(hex: string): string {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return `background:#${hex};color:${luminance > 128 ? '#111' : '#fff'}`;
  }

  function renderMarkdown(text: string): string {
    return DOMPurify.sanitize(marked.parse(text));
  }

  const AVATAR_COLORS = ['#e57373', '#ba68c8', '#64b5f6', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae'];
  function avatarColor(login: string): string {
    let hash = 0;
    for (let i = 0; i < login.length; i++) hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }
  function avatar(user: GithubUser): string {
    const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
    return `<span class="avatar" style="background:${avatarColor(user.login)}" data-initials="${initials}">` +
      `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
  }

  function bindAvatarFallbacks(): void {
    detailEl.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function renderDetail(issue: GithubIssue, comments: GithubComment[]): void {
    currentIssue = issue;
    editing = false;
    editingCommentId = null;
    render(issue, comments);
  }

  function render(issue: GithubIssue, comments: GithubComment[]): void {
    const closed = issue.state === 'closed';
    detailEl.innerHTML = `
      <h2><span class="state-badge${closed ? ' closed' : ''}">${issue.state}</span>${issue.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''} #${issue.number} ${editing ? '' : escapeHtml(issue.title)}</h2>
      <div class="meta-row">
        ${issue.labels.map(l => `<span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
        ${avatar(issue.user)} opened by ${escapeHtml(issue.user.login)} · ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
      </div>
      ${issue.assignees.length > 0 ? `
      <div class="assignees-row">
        <span class="assignees-label">Assignees:</span>
        ${issue.assignees.map(a => `<span class="assignee-chip">${avatar(a)} ${escapeHtml(a.login)}</span>`).join('')}
      </div>` : ''}
      ${editing ? `
      <div class="edit-form">
        <input id="edit-title" value="${escapeHtml(issue.title)}">
        <textarea id="edit-body">${escapeHtml(issue.body || '')}</textarea>
        <div class="picker-group">
          <span class="assignees-label">Labels:</span>
          <div class="chip-picker" id="label-picker">
            ${repoLabels.length === 0 ? '<span class="issue-meta">No labels in this repo.</span>' : repoLabels.map(l => `
              <label class="chip-check">
                <input type="checkbox" value="${escapeHtml(l.name)}" ${issue.labels.some(il => il.name === l.name) ? 'checked' : ''}>
                <span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="chip-picker" id="assignee-picker">
            ${assignableUsers.length === 0 ? '<span class="issue-meta">No assignable users.</span>' : assignableUsers.map(u => `
              <label class="chip-check">
                <input type="checkbox" value="${escapeHtml(u.login)}" ${issue.assignees.some(a => a.login === u.login) ? 'checked' : ''}>
                ${escapeHtml(u.login)}
              </label>`).join('')}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Save</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>` : `
      <div class="btn-row">
        <button class="btn btn-primary" id="edit-btn">Edit</button>
        <button class="btn btn-secondary" id="branch-btn">Branch</button>
        <button class="btn btn-secondary" id="browser-btn">Browser ↗</button>
        <button class="btn btn-secondary" id="copy-btn">Copy as prompt</button>
        <button class="btn btn-danger" id="state-btn">${closed ? 'Reopen' : 'Close'}</button>
      </div>
      <div class="body-card">${issue.body ? renderMarkdown(issue.body) : '(no description)'}</div>`}
      <h3>Comments (${comments.length})</h3>
      <div id="comments">
        ${comments.map(c => `
          <div class="comment">
            <span class="comment-author">${avatar(c.user)} ${escapeHtml(c.user.login)}</span>
            <span class="issue-meta">${c.created_at.slice(0, 10)}</span>
            ${viewerLogin === c.user.login && editingCommentId !== c.id ? `
            <button class="btn btn-secondary comment-edit-btn" data-id="${c.id}">Edit</button>
            <button class="btn btn-danger comment-delete-btn" data-id="${c.id}">Delete</button>` : ''}
            ${editingCommentId === c.id ? `
            <div class="edit-form">
              <textarea class="comment-edit-input">${escapeHtml(c.body)}</textarea>
              <div class="btn-row">
                <button class="btn btn-primary comment-save-btn" data-id="${c.id}">Save</button>
                <button class="btn btn-secondary comment-cancel-btn" data-id="${c.id}">Cancel</button>
              </div>
            </div>` : `<div class="comment-body">${renderMarkdown(c.body)}</div>`}
          </div>`).join('') || '<div class="issue-meta">No comments yet.</div>'}
      </div>
      <div id="composer">
        <textarea id="comment-input" placeholder="Write a comment…"></textarea>
        <div class="btn-row">
          <button class="btn btn-primary" id="comment-btn" disabled>Comment</button>
        </div>
      </div>`;
    bindEvents(issue);
    bindAvatarFallbacks();
  }

  function bindEvents(issue: GithubIssue): void {
    document.getElementById('copy-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'copyAsPrompt' }));
    document.getElementById('browser-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'openInBrowser' }));
    document.getElementById('branch-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'createBranch' }));
    document.getElementById('state-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'setState', state: issue.state === 'closed' ? 'open' : 'closed' }));
    document.getElementById('edit-btn')?.addEventListener('click', () => {
      editing = true;
      if (currentIssue) render(currentIssue, lastComments);
    });
    document.getElementById('cancel-btn')?.addEventListener('click', () => {
      editing = false;
      if (currentIssue) render(currentIssue, lastComments);
    });
    document.getElementById('save-btn')?.addEventListener('click', () => {
      const title = (document.getElementById('edit-title') as HTMLInputElement).value.trim();
      const body = (document.getElementById('edit-body') as HTMLTextAreaElement).value;
      if (!title) return;
      const labels = Array.from(
        document.querySelectorAll<HTMLInputElement>('#label-picker input:checked'),
      ).map(el => el.value);
      const assignees = Array.from(
        document.querySelectorAll<HTMLInputElement>('#assignee-picker input:checked'),
      ).map(el => el.value);
      vscode.postMessage({ type: 'saveEdit', title, body, labels, assignees });
    });
    const commentInput = document.getElementById('comment-input') as HTMLTextAreaElement;
    const commentBtn = document.getElementById('comment-btn') as HTMLButtonElement;
    commentInput?.addEventListener('input', () => {
      commentBtn.disabled = commentInput.value.trim().length === 0;
    });
    commentBtn?.addEventListener('click', () => {
      const body = commentInput.value.trim();
      if (!body) return;
      commentBtn.disabled = true;
      vscode.postMessage({ type: 'postComment', body });
    });
    document.getElementById('comments')?.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const id = Number(target.dataset.id);
      if (target.classList.contains('comment-edit-btn')) {
        editingCommentId = id;
        if (currentIssue) render(currentIssue, lastComments);
      } else if (target.classList.contains('comment-cancel-btn')) {
        editingCommentId = null;
        if (currentIssue) render(currentIssue, lastComments);
      } else if (target.classList.contains('comment-save-btn')) {
        const textarea = target.closest('.comment')?.querySelector('.comment-edit-input') as HTMLTextAreaElement;
        const body = textarea.value.trim();
        if (!body) return;
        vscode.postMessage({ type: 'editComment', commentId: id, body });
      } else if (target.classList.contains('comment-delete-btn')) {
        if (confirm('Delete this comment?')) vscode.postMessage({ type: 'deleteComment', commentId: id });
      }
    });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'issueDetail':
        lastComments = msg.comments;
        repoLabels = msg.repoLabels;
        assignableUsers = msg.assignableUsers;
        viewerLogin = msg.viewerLogin;
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
