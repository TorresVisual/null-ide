'use strict';
function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}
/** Picks whichever of black/white text has the higher WCAG contrast ratio against a GitHub label hex color. */
function labelChipStyle(hex) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const bgLuminance = relativeLuminance(r, g, b);
    const color = contrastRatio(bgLuminance, 1) > contrastRatio(bgLuminance, 0) ? '#fff' : '#111';
    return `background:#${hex};color:${color}`;
}
(function () {
    const vscode = acquireVsCodeApi();
    const detailEl = document.getElementById('detail');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    lightbox === null || lightbox === void 0 ? void 0 : lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !(lightbox === null || lightbox === void 0 ? void 0 : lightbox.classList.contains('hidden')))
            lightbox.classList.add('hidden');
    });
    detailEl.addEventListener('click', e => {
        const target = e.target;
        if (target.tagName === 'IMG' && target.closest('.body-card, .comment-body')) {
            lightboxImg.src = target.src;
            lightbox.classList.remove('hidden');
        }
    });
    let editing = false;
    let currentIssue = null;
    let lastComments = [];
    let lastTimeline = [];
    let repoLabels = [];
    let assignableUsers = [];
    let issueTemplates = [];
    let viewerLogin = null;
    let editingCommentId = null;
    let labelOpen = false;
    let assigneeOpen = false;
    let refreshLabelPicker = null;
    let refreshAssigneePicker = null;
    let editFormSelectedLabels = null;
    let editFormSelectedAssignees = null;
    document.addEventListener('click', e => {
        if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container')))
            return;
        if (!labelOpen && !assigneeOpen)
            return;
        labelOpen = false;
        assigneeOpen = false;
        refreshLabelPicker === null || refreshLabelPicker === void 0 ? void 0 : refreshLabelPicker();
        refreshAssigneePicker === null || refreshAssigneePicker === void 0 ? void 0 : refreshAssigneePicker();
    });
    function escapeHtml(s) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return s.replace(/[&<>"']/g, c => map[c]);
    }
    function renderMarkdown(text) {
        return DOMPurify.sanitize(marked.parse(text));
    }
    function renderPicker(containerId, items, selected, isOpen, toggleOpen, placeholder) {
        const refresh = () => {
            var _a;
            const container = document.getElementById(containerId);
            if (!container)
                return;
            const open = isOpen();
            const selectedItems = items.filter(i => selected.has(i.value));
            container.innerHTML = `
        <button type="button" class="dropdown-trigger">
          ${selectedItems.length > 0 ? `<span class="selected-tags">${selectedItems.map(i => `
            <span class="tag"${i.color ? ` style="${labelChipStyle(i.color)}"` : ''}>${escapeHtml(i.label)}<span class="tag-remove" data-value="${escapeHtml(i.value)}">&times;</span></span>`).join('')}</span>`
                : `<span class="dropdown-placeholder">${escapeHtml(placeholder)}</span>`}
          <span class="dropdown-arrow">${open ? '▲' : '▼'}</span>
        </button>
        <div class="dropdown-list${open ? '' : ' hidden'}">
          ${items.length === 0 ? '<span class="issue-meta">None available.</span>' : items.map(i => `
            <button type="button" class="dropdown-item${selected.has(i.value) ? ' selected' : ''}" data-value="${escapeHtml(i.value)}">
              <span class="checkbox">${selected.has(i.value) ? '☑' : '☐'}</span>
              ${i.color ? `<span class="color-dot" style="background:#${i.color}"></span>` : ''}
              ${escapeHtml(i.label)}
            </button>`).join('')}
        </div>`;
            (_a = container.querySelector('.dropdown-trigger')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => {
                toggleOpen();
                refresh();
            });
            container.querySelectorAll('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
                e.preventDefault();
                selected.delete(el.dataset.value);
                refresh();
            }));
            container.querySelectorAll('.dropdown-item').forEach(el => el.addEventListener('click', () => {
                const v = el.dataset.value;
                if (selected.has(v))
                    selected.delete(v);
                else
                    selected.add(v);
                refresh();
            }));
        };
        refresh();
        return refresh;
    }
    function avatar(user) {
        const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
        return `<span class="avatar" data-initials="${initials}">` +
            `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
    }
    function bindAvatarFallbacks() {
        detailEl.querySelectorAll('.avatar img').forEach(img => img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
    }
    function bindTaskCheckboxes() {
        const boxes = detailEl.querySelectorAll('.body-card input[type=checkbox]');
        boxes.forEach((box, index) => {
            box.disabled = false;
            box.addEventListener('change', () => vscode.postMessage({ type: 'toggleTask', index, checked: box.checked }));
        });
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
        var _a, _b, _c;
        currentIssue = null;
        labelOpen = false;
        assigneeOpen = false;
        const selectedLabels = new Set();
        const selectedAssignees = new Set();
        detailEl.innerHTML = `
      <h2>New Issue</h2>
      <div class="edit-form">
        ${issueTemplates.length > 0 ? `
        <select id="template-picker">
          <option value="">Blank issue</option>
          ${issueTemplates.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
        </select>` : ''}
        <input id="edit-title" placeholder="Title">
        <textarea id="edit-body" placeholder="Description"></textarea>
        <div class="picker-group">
          <span class="assignees-label">Labels:</span>
          <div class="dropdown-container" id="label-picker"></div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="dropdown-container" id="assignee-picker"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Create</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>`;
        refreshLabelPicker = renderPicker('label-picker', repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), selectedLabels, () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…');
        refreshAssigneePicker = renderPicker('assignee-picker', assignableUsers.map(u => ({ value: u.login, label: u.login })), selectedAssignees, () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…');
        (_a = document.getElementById('template-picker')) === null || _a === void 0 ? void 0 : _a.addEventListener('change', e => {
            var _a, _b;
            const index = e.target.value;
            const template = index ? issueTemplates[Number(index)] : null;
            document.getElementById('edit-title').value = (_a = template === null || template === void 0 ? void 0 : template.title) !== null && _a !== void 0 ? _a : '';
            document.getElementById('edit-body').value = (_b = template === null || template === void 0 ? void 0 : template.body) !== null && _b !== void 0 ? _b : '';
            selectedLabels.clear();
            template === null || template === void 0 ? void 0 : template.labels.forEach(l => {
                const match = repoLabels.find(rl => rl.name.toLowerCase() === l.toLowerCase());
                if (match)
                    selectedLabels.add(match.name);
            });
            refreshLabelPicker === null || refreshLabelPicker === void 0 ? void 0 : refreshLabelPicker();
        });
        (_b = document.getElementById('save-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => {
            const title = document.getElementById('edit-title').value.trim();
            const body = document.getElementById('edit-body').value;
            if (!title)
                return;
            vscode.postMessage({
                type: 'submitCreate', title, body,
                labels: Array.from(selectedLabels), assignees: Array.from(selectedAssignees),
            });
        });
        (_c = document.getElementById('cancel-btn')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => vscode.postMessage({ type: 'cancelCreate' }));
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
          <div class="dropdown-container" id="label-picker"></div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="dropdown-container" id="assignee-picker"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Save</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>` : `
      <div class="btn-row">
        <button class="btn btn-primary" id="edit-btn">Edit</button>
        <button class="btn ${closed ? 'btn-reopen' : 'btn-close'}" id="state-btn">${closed ? 'Reopen' : 'Close'}</button>
        <div class="btn-row-divider"></div>
        <button class="btn btn-ghost" id="branch-btn">Branch</button>
        <button class="btn btn-ghost" id="worktree-btn">Worktree</button>
        <button class="btn btn-ghost" id="browser-btn">Browser ↗</button>
        <button class="btn btn-ghost" id="copy-btn">Copy as prompt</button>
        <button class="btn btn-ghost" id="refresh-btn" title="Reload this issue from GitHub">Refresh</button>
      </div>
      <div class="body-card">${issue.body ? renderMarkdown(issue.body) : '(no description)'}</div>`}
      <h3>Comments (${comments.length})</h3>
      <div id="comments">
        ${buildFeed(comments, timeline).map(item => item.kind === 'event' ? `
          <div class="timeline-event">${item.text} · <span class="issue-meta">${item.created_at.slice(0, 10)}</span></div>` : `
          <div class="comment">
            <div class="comment-header">
              <span class="comment-author-group">${avatar(item.comment.user)} <span class="comment-author">${escapeHtml(item.comment.user.login)}</span></span>
              <span class="comment-actions">
                <span class="issue-meta">${item.comment.created_at.slice(0, 10)}</span>
                ${viewerLogin === item.comment.user.login && editingCommentId !== item.comment.id ? `
                <button class="comment-link-btn comment-edit-btn" data-id="${item.comment.id}">Edit</button>
                <button class="comment-link-btn danger comment-delete-btn" data-id="${item.comment.id}">Delete</button>` : ''}
              </span>
            </div>
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
        if (editing) {
            editFormSelectedLabels = new Set(issue.labels.map(l => l.name));
            editFormSelectedAssignees = new Set(issue.assignees.map(a => a.login));
            refreshLabelPicker = renderPicker('label-picker', repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), editFormSelectedLabels, () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…');
            refreshAssigneePicker = renderPicker('assignee-picker', assignableUsers.map(u => ({ value: u.login, label: u.login })), editFormSelectedAssignees, () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…');
        }
        else {
            refreshLabelPicker = null;
            refreshAssigneePicker = null;
            editFormSelectedLabels = null;
            editFormSelectedAssignees = null;
        }
        bindEvents(issue);
        bindAvatarFallbacks();
        if (!editing)
            bindTaskCheckboxes();
    }
    function bindEvents(issue) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        (_a = document.getElementById('copy-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => vscode.postMessage({ type: 'copyAsPrompt' }));
        (_b = document.getElementById('refresh-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        (_c = document.getElementById('browser-btn')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
        (_d = document.getElementById('branch-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', () => vscode.postMessage({ type: 'createBranch' }));
        (_e = document.getElementById('worktree-btn')) === null || _e === void 0 ? void 0 : _e.addEventListener('click', () => vscode.postMessage({ type: 'createWorktree' }));
        (_f = document.getElementById('state-btn')) === null || _f === void 0 ? void 0 : _f.addEventListener('click', () => vscode.postMessage({ type: 'setState', state: issue.state === 'closed' ? 'open' : 'closed' }));
        (_g = document.getElementById('edit-btn')) === null || _g === void 0 ? void 0 : _g.addEventListener('click', () => {
            editing = true;
            if (currentIssue)
                render(currentIssue, lastComments, lastTimeline);
        });
        (_h = document.getElementById('cancel-btn')) === null || _h === void 0 ? void 0 : _h.addEventListener('click', () => {
            editing = false;
            if (currentIssue)
                render(currentIssue, lastComments, lastTimeline);
        });
        (_j = document.getElementById('save-btn')) === null || _j === void 0 ? void 0 : _j.addEventListener('click', () => {
            const title = document.getElementById('edit-title').value.trim();
            const body = document.getElementById('edit-body').value;
            if (!title)
                return;
            const labels = Array.from(editFormSelectedLabels !== null && editFormSelectedLabels !== void 0 ? editFormSelectedLabels : []);
            const assignees = Array.from(editFormSelectedAssignees !== null && editFormSelectedAssignees !== void 0 ? editFormSelectedAssignees : []);
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
        (_k = document.getElementById('comments')) === null || _k === void 0 ? void 0 : _k.addEventListener('click', e => {
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
                vscode.postMessage({ type: 'deleteComment', commentId: id });
            }
        });
    }
    window.addEventListener('message', event => {
        var _a;
        const msg = event.data;
        switch (msg.type) {
            case 'issueDetail':
                lastComments = msg.comments;
                lastTimeline = msg.timeline;
                repoLabels = msg.repoLabels;
                assignableUsers = msg.assignableUsers;
                issueTemplates = (_a = msg.templates) !== null && _a !== void 0 ? _a : [];
                viewerLogin = msg.viewerLogin;
                if (msg.issue)
                    renderDetail(msg.issue, msg.comments, msg.timeline);
                else
                    renderCreateForm();
                break;
            case 'issueDetailError':
                detailEl.innerHTML = `<div id="empty">Failed to load issue: ${escapeHtml(msg.message)}</div>`;
                break;
            case 'commentPostFailed': {
                const btn = detailEl.querySelector('#comment-btn');
                if (btn)
                    btn.disabled = false;
                break;
            }
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
