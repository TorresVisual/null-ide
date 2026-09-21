'use strict';
(function () {
    const vscode = acquireVsCodeApi();
    const detailEl = document.getElementById('detail');
    let editing = false;
    let currentIssue = null;
    let lastComments = [];
    function escapeHtml(s) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return s.replace(/[&<>"']/g, c => map[c]);
    }
    const AVATAR_COLORS = ['#e57373', '#ba68c8', '#64b5f6', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae'];
    function avatarColor(login) {
        let hash = 0;
        for (let i = 0; i < login.length; i++)
            hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }
    function avatar(login) {
        const initials = escapeHtml(login.slice(0, 2).toUpperCase());
        return `<span class="avatar" style="background:${avatarColor(login)}">${initials}</span>`;
    }
    function renderDetail(issue, comments) {
        currentIssue = issue;
        editing = false;
        render(issue, comments);
    }
    function render(issue, comments) {
        const closed = issue.state === 'closed';
        detailEl.innerHTML = `
      <h2><span class="state-badge${closed ? ' closed' : ''}">${issue.state}</span> #${issue.number} ${editing ? '' : escapeHtml(issue.title)}</h2>
      <div class="meta-row">
        ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
        ${avatar(issue.user.login)} opened by ${escapeHtml(issue.user.login)} · ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
      </div>
      ${issue.assignees.length > 0 ? `
      <div class="assignees-row">
        <span class="assignees-label">Assignees:</span>
        ${issue.assignees.map(a => `<span class="assignee-chip">${avatar(a.login)} ${escapeHtml(a.login)}</span>`).join('')}
      </div>` : ''}
      ${editing ? `
      <div class="edit-form">
        <input id="edit-title" value="${escapeHtml(issue.title)}">
        <textarea id="edit-body">${escapeHtml(issue.body || '')}</textarea>
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
      <div class="body-card">${escapeHtml(issue.body || '(no description)')}</div>`}
      <h3>Comments (${comments.length})</h3>
      <div id="comments">
        ${comments.map(c => `
          <div class="comment">
            <span class="comment-author">${avatar(c.user.login)} ${escapeHtml(c.user.login)}</span>
            <span class="issue-meta">${c.created_at.slice(0, 10)}</span>
            <div>${escapeHtml(c.body)}</div>
          </div>`).join('') || '<div class="issue-meta">No comments yet.</div>'}
      </div>
      <div id="composer">
        <textarea id="comment-input" placeholder="Write a comment…"></textarea>
        <div class="btn-row">
          <button class="btn btn-primary" id="comment-btn" disabled>Comment</button>
        </div>
      </div>`;
        bindEvents(issue);
    }
    function bindEvents(issue) {
        var _a, _b, _c, _d, _e, _f, _g;
        (_a = document.getElementById('copy-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => vscode.postMessage({ type: 'copyAsPrompt' }));
        (_b = document.getElementById('browser-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
        (_c = document.getElementById('branch-btn')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => vscode.postMessage({ type: 'createBranch' }));
        (_d = document.getElementById('state-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', () => vscode.postMessage({ type: 'setState', state: issue.state === 'closed' ? 'open' : 'closed' }));
        (_e = document.getElementById('edit-btn')) === null || _e === void 0 ? void 0 : _e.addEventListener('click', () => {
            editing = true;
            if (currentIssue)
                render(currentIssue, lastComments);
        });
        (_f = document.getElementById('cancel-btn')) === null || _f === void 0 ? void 0 : _f.addEventListener('click', () => {
            editing = false;
            if (currentIssue)
                render(currentIssue, lastComments);
        });
        (_g = document.getElementById('save-btn')) === null || _g === void 0 ? void 0 : _g.addEventListener('click', () => {
            const title = document.getElementById('edit-title').value.trim();
            const body = document.getElementById('edit-body').value;
            if (!title)
                return;
            vscode.postMessage({ type: 'saveEdit', title, body });
        });
        const commentInput = document.getElementById('comment-input');
        const commentBtn = document.getElementById('comment-btn');
        commentInput === null || commentInput === void 0 ? void 0 : commentInput.addEventListener('input', () => {
            commentBtn.disabled = commentInput.value.trim().length === 0;
        });
        commentBtn === null || commentBtn === void 0 ? void 0 : commentBtn.addEventListener('click', () => {
            const body = commentInput.value.trim();
            if (!body)
                return;
            commentBtn.disabled = true;
            vscode.postMessage({ type: 'postComment', body });
        });
    }
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'issueDetail':
                lastComments = msg.comments;
                renderDetail(msg.issue, msg.comments);
                break;
            case 'copied': {
                const btn = detailEl.querySelector('#copy-btn');
                if (btn) {
                    btn.textContent = 'Copied!';
                    setTimeout(() => { if (btn)
                        btn.textContent = 'Copy as prompt'; }, 1500);
                }
                break;
            }
        }
    });
    vscode.postMessage({ type: 'ready' });
})();
