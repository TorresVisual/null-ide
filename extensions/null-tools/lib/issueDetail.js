'use strict';
(function () {
    const vscode = acquireVsCodeApi();
    const detailEl = document.getElementById('detail');
    let editing = false;
    let currentIssue = null;
    let lastComments = [];
    let lastTimeline = [];
    let repoLabels = [];
    let assignableUsers = [];
    let viewerLogin = null;
    let editingCommentId = null;
    function escapeHtml(s) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return s.replace(/[&<>"']/g, c => map[c]);
    }
    function labelChipStyle(hex) {
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        const luminance = (r * 299 + g * 587 + b * 114) / 1000;
        return `background:#${hex};color:${luminance > 128 ? '#111' : '#fff'}`;
    }
    function renderMarkdown(text) {
        return DOMPurify.sanitize(marked.parse(text));
    }
    const AVATAR_COLORS = ['#e57373', '#ba68c8', '#64b5f6', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae'];
    function avatarColor(login) {
        let hash = 0;
        for (let i = 0; i < login.length; i++)
            hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }
    function avatar(user) {
        const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
        return `<span class="avatar" style="background:${avatarColor(user.login)}" data-initials="${initials}">` +
            `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
    }
    function bindAvatarFallbacks() {
        detailEl.querySelectorAll('.avatar img').forEach(img => img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
    }
    function shortSha(sha) {
        return sha.slice(0, 7);
    }
    function timelineEventText(ev) {
        var _a;
        const actorName = ev.actor ? escapeHtml(ev.actor.login) : 'someone';
        switch (ev.event) {
            case 'closed':
                return `${actorName} closed this${ev.commit_id ? ` via commit <code>${shortSha(ev.commit_id)}</code>` : ''}`;
            case 'reopened':
                return `${actorName} reopened this`;
            case 'labeled':
                return ev.label
                    ? `${actorName} added the <span class="label-chip" style="${labelChipStyle(ev.label.color)}">${escapeHtml(ev.label.name)}</span> label` : null;
            case 'unlabeled':
                return ev.label
                    ? `${actorName} removed the <span class="label-chip" style="${labelChipStyle(ev.label.color)}">${escapeHtml(ev.label.name)}</span> label` : null;
            case 'assigned':
                return ev.assignee ? `${actorName} assigned ${escapeHtml(ev.assignee.login)}` : null;
            case 'unassigned':
                return ev.assignee ? `${actorName} unassigned ${escapeHtml(ev.assignee.login)}` : null;
            case 'renamed':
                return ev.rename
                    ? `${actorName} changed the title from "${escapeHtml(ev.rename.from)}" to "${escapeHtml(ev.rename.to)}"` : null;
            case 'cross-referenced':
                return ((_a = ev.source) === null || _a === void 0 ? void 0 : _a.issue)
                    ? `${actorName} referenced this in <a href="${escapeHtml(ev.source.issue.html_url)}">#${ev.source.issue.number}</a>` : null;
            case 'referenced':
                return ev.commit_id ? `${actorName} referenced this in commit <code>${shortSha(ev.commit_id)}</code>` : null;
            default:
                return null;
        }
    }
    function buildFeed(comments, timeline) {
        const items = comments.map(c => ({ kind: 'comment', created_at: c.created_at, comment: c }));
        for (const ev of timeline) {
            const text = timelineEventText(ev);
            if (text)
                items.push({ kind: 'event', created_at: ev.created_at, text });
        }
        return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    function renderDetail(issue, comments, timeline) {
        currentIssue = issue;
        editing = false;
        editingCommentId = null;
        render(issue, comments, timeline);
    }
    function renderCreateForm() {
        var _a, _b;
        currentIssue = null;
        detailEl.innerHTML = `
      <h2>New Issue</h2>
      <div class="edit-form">
        <input id="edit-title" placeholder="Title">
        <textarea id="edit-body" placeholder="Description"></textarea>
        <div class="picker-group">
          <span class="assignees-label">Labels:</span>
          <div class="chip-picker" id="label-picker">
            ${repoLabels.length === 0 ? '<span class="issue-meta">No labels in this repo.</span>' : repoLabels.map(l => `
              <label class="chip-check">
                <input type="checkbox" value="${escapeHtml(l.name)}">
                <span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="chip-picker" id="assignee-picker">
            ${assignableUsers.length === 0 ? '<span class="issue-meta">No assignable users.</span>' : assignableUsers.map(u => `
              <label class="chip-check">
                <input type="checkbox" value="${escapeHtml(u.login)}">
                ${escapeHtml(u.login)}
              </label>`).join('')}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Create</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>`;
        (_a = document.getElementById('save-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => {
            const title = document.getElementById('edit-title').value.trim();
            const body = document.getElementById('edit-body').value;
            if (!title)
                return;
            const labels = Array.from(document.querySelectorAll('#label-picker input:checked')).map(el => el.value);
            const assignees = Array.from(document.querySelectorAll('#assignee-picker input:checked')).map(el => el.value);
            vscode.postMessage({ type: 'submitCreate', title, body, labels, assignees });
        });
        (_b = document.getElementById('cancel-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'cancelCreate' }));
    }
    function render(issue, comments, timeline) {
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
        ${buildFeed(comments, timeline).map(item => item.kind === 'event' ? `
          <div class="timeline-event">${item.text} · <span class="issue-meta">${item.created_at.slice(0, 10)}</span></div>` : `
          <div class="comment">
            <span class="comment-author">${avatar(item.comment.user)} ${escapeHtml(item.comment.user.login)}</span>
            <span class="issue-meta">${item.comment.created_at.slice(0, 10)}</span>
            ${viewerLogin === item.comment.user.login && editingCommentId !== item.comment.id ? `
            <button class="btn btn-secondary comment-edit-btn" data-id="${item.comment.id}">Edit</button>
            <button class="btn btn-danger comment-delete-btn" data-id="${item.comment.id}">Delete</button>` : ''}
            ${editingCommentId === item.comment.id ? `
            <div class="edit-form">
              <textarea class="comment-edit-input">${escapeHtml(item.comment.body)}</textarea>
              <div class="btn-row">
                <button class="btn btn-primary comment-save-btn" data-id="${item.comment.id}">Save</button>
                <button class="btn btn-secondary comment-cancel-btn" data-id="${item.comment.id}">Cancel</button>
              </div>
            </div>` : `<div class="comment-body">${renderMarkdown(item.comment.body)}</div>`}
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
    function bindEvents(issue) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        (_a = document.getElementById('copy-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => vscode.postMessage({ type: 'copyAsPrompt' }));
        (_b = document.getElementById('browser-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
        (_c = document.getElementById('branch-btn')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => vscode.postMessage({ type: 'createBranch' }));
        (_d = document.getElementById('state-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', () => vscode.postMessage({ type: 'setState', state: issue.state === 'closed' ? 'open' : 'closed' }));
        (_e = document.getElementById('edit-btn')) === null || _e === void 0 ? void 0 : _e.addEventListener('click', () => {
            editing = true;
            if (currentIssue)
                render(currentIssue, lastComments, lastTimeline);
        });
        (_f = document.getElementById('cancel-btn')) === null || _f === void 0 ? void 0 : _f.addEventListener('click', () => {
            editing = false;
            if (currentIssue)
                render(currentIssue, lastComments, lastTimeline);
        });
        (_g = document.getElementById('save-btn')) === null || _g === void 0 ? void 0 : _g.addEventListener('click', () => {
            const title = document.getElementById('edit-title').value.trim();
            const body = document.getElementById('edit-body').value;
            if (!title)
                return;
            const labels = Array.from(document.querySelectorAll('#label-picker input:checked')).map(el => el.value);
            const assignees = Array.from(document.querySelectorAll('#assignee-picker input:checked')).map(el => el.value);
            vscode.postMessage({ type: 'saveEdit', title, body, labels, assignees });
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
        (_h = document.getElementById('comments')) === null || _h === void 0 ? void 0 : _h.addEventListener('click', e => {
            var _a;
            const target = e.target;
            const id = Number(target.dataset.id);
            if (target.classList.contains('comment-edit-btn')) {
                editingCommentId = id;
                if (currentIssue)
                    render(currentIssue, lastComments, lastTimeline);
            }
            else if (target.classList.contains('comment-cancel-btn')) {
                editingCommentId = null;
                if (currentIssue)
                    render(currentIssue, lastComments, lastTimeline);
            }
            else if (target.classList.contains('comment-save-btn')) {
                const textarea = (_a = target.closest('.comment')) === null || _a === void 0 ? void 0 : _a.querySelector('.comment-edit-input');
                const body = textarea.value.trim();
                if (!body)
                    return;
                vscode.postMessage({ type: 'editComment', commentId: id, body });
            }
            else if (target.classList.contains('comment-delete-btn')) {
                if (confirm('Delete this comment?'))
                    vscode.postMessage({ type: 'deleteComment', commentId: id });
            }
        });
    }
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'issueDetail':
                lastComments = msg.comments;
                lastTimeline = msg.timeline;
                repoLabels = msg.repoLabels;
                assignableUsers = msg.assignableUsers;
                viewerLogin = msg.viewerLogin;
                if (msg.issue)
                    renderDetail(msg.issue, msg.comments, msg.timeline);
                else
                    renderCreateForm();
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
