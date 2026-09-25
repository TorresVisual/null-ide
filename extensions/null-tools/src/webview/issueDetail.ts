'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; avatar_url: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  closedLocally?: boolean;
}
interface GithubComment { id: number; user: GithubUser; body: string; created_at: string; }
interface IssueTemplate { name: string; title: string; body: string; labels: string[]; }
interface GithubTimelineEvent {
  event: string; actor: GithubUser | null; created_at: string; commit_id?: string | null;
  label?: { name: string; color: string }; assignee?: GithubUser; rename?: { from: string; to: string };
  source?: { issue?: { number: number; title: string; html_url: string } };
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const marked: { parse(src: string): string };
declare const DOMPurify: { sanitize(html: string): string };

(function () {
  const vscode = acquireVsCodeApi();
  const detailEl = document.getElementById('detail') as HTMLDivElement;
  const lightbox = document.getElementById('lightbox') as HTMLDivElement;
  const lightboxImg = document.getElementById('lightbox-img') as HTMLImageElement;
  lightbox?.addEventListener('click', () => lightbox.classList.add('hidden'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !lightbox?.classList.contains('hidden')) lightbox.classList.add('hidden');
  });
  detailEl.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && target.closest('.body-card, .comment-body')) {
      lightboxImg.src = (target as HTMLImageElement).src;
      lightbox.classList.remove('hidden');
    }
  });

  let editing = false;
  let currentIssue: GithubIssue | null = null;
  let lastComments: GithubComment[] = [];
  let lastTimeline: GithubTimelineEvent[] = [];
  let repoLabels: GithubLabel[] = [];
  let assignableUsers: GithubUser[] = [];
  let issueTemplates: IssueTemplate[] = [];
  let viewerLogin: string | null = null;
  let editingCommentId: number | null = null;
  let labelOpen = false;
  let assigneeOpen = false;
  let refreshLabelPicker: (() => void) | null = null;
  let refreshAssigneePicker: (() => void) | null = null;
  let editFormSelectedLabels: Set<string> | null = null;
  let editFormSelectedAssignees: Set<string> | null = null;

  document.addEventListener('click', e => {
    if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container'))) return;
    if (!labelOpen && !assigneeOpen) return;
    labelOpen = false;
    assigneeOpen = false;
    refreshLabelPicker?.();
    refreshAssigneePicker?.();
  });

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function renderMarkdown(text: string): string {
    return DOMPurify.sanitize(marked.parse(text));
  }

  interface PickerItem { value: string; label: string; color?: string; }

  function renderPicker(
    containerId: string, items: PickerItem[], selected: Set<string>,
    isOpen: () => boolean, toggleOpen: () => void, placeholder: string,
  ): () => void {
    const refresh = () => {
      const container = document.getElementById(containerId) as HTMLDivElement | null;
      if (!container) return;
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
      container.querySelector('.dropdown-trigger')?.addEventListener('click', () => {
        toggleOpen();
        refresh();
      });
      container.querySelectorAll<HTMLElement>('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
        e.preventDefault();
        selected.delete(el.dataset.value!);
        refresh();
      }));
      container.querySelectorAll<HTMLElement>('.dropdown-item').forEach(el => el.addEventListener('click', () => {
        const v = el.dataset.value!;
        if (selected.has(v)) selected.delete(v); else selected.add(v);
        refresh();
      }));
    };
    refresh();
    return refresh;
  }

  function avatar(user: GithubUser): string {
    const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
    return `<span class="avatar" data-initials="${initials}">` +
      `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
  }

  function bindAvatarFallbacks(): void {
    detailEl.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function bindTaskCheckboxes(): void {
    const boxes = detailEl.querySelectorAll<HTMLInputElement>('.body-card input[type=checkbox]');
    boxes.forEach((box, index) => {
      box.disabled = false;
      box.addEventListener('change', () =>
        vscode.postMessage({ type: 'toggleTask', index, checked: box.checked }));
    });
  }

  function shortSha(sha: string): string {
    return sha.slice(0, 7);
  }

  function timelineEventText(ev: GithubTimelineEvent): string | null {
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
        return ev.source?.issue
          ? `${actorName} referenced this in <a href="${escapeHtml(ev.source.issue.html_url)}">#${ev.source.issue.number}</a>` : null;
      case 'referenced':
        return ev.commit_id ? `${actorName} referenced this in commit <code>${shortSha(ev.commit_id)}</code>` : null;
      default:
        return null;
    }
  }

  type FeedItem =
    | { kind: 'comment'; created_at: string; comment: GithubComment }
    | { kind: 'event'; created_at: string; text: string };

  function buildFeed(comments: GithubComment[], timeline: GithubTimelineEvent[]): FeedItem[] {
    const items: FeedItem[] = comments.map(c => ({ kind: 'comment', created_at: c.created_at, comment: c }));
    for (const ev of timeline) {
      const text = timelineEventText(ev);
      if (text) items.push({ kind: 'event', created_at: ev.created_at, text });
    }
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  function renderDetail(issue: GithubIssue, comments: GithubComment[], timeline: GithubTimelineEvent[]): void {
    currentIssue = issue;
    editing = false;
    editingCommentId = null;
    render(issue, comments, timeline);
  }

  function renderCreateForm(): void {
    currentIssue = null;
    labelOpen = false;
    assigneeOpen = false;
    const selectedLabels = new Set<string>();
    const selectedAssignees = new Set<string>();
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
    refreshLabelPicker = renderPicker(
      'label-picker', repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), selectedLabels,
      () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…',
    );
    refreshAssigneePicker = renderPicker(
      'assignee-picker', assignableUsers.map(u => ({ value: u.login, label: u.login })), selectedAssignees,
      () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…',
    );
    document.getElementById('template-picker')?.addEventListener('change', e => {
      const index = (e.target as HTMLSelectElement).value;
      const template = index ? issueTemplates[Number(index)] : null;
      (document.getElementById('edit-title') as HTMLInputElement).value = template?.title ?? '';
      (document.getElementById('edit-body') as HTMLTextAreaElement).value = template?.body ?? '';
      selectedLabels.clear();
      template?.labels.forEach(l => {
        const match = repoLabels.find(rl => rl.name.toLowerCase() === l.toLowerCase());
        if (match) selectedLabels.add(match.name);
      });
      refreshLabelPicker?.();
    });
    document.getElementById('save-btn')?.addEventListener('click', () => {
      const title = (document.getElementById('edit-title') as HTMLInputElement).value.trim();
      const body = (document.getElementById('edit-body') as HTMLTextAreaElement).value;
      if (!title) return;
      vscode.postMessage({
        type: 'submitCreate', title, body,
        labels: Array.from(selectedLabels), assignees: Array.from(selectedAssignees),
      });
    });
    document.getElementById('cancel-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'cancelCreate' }));
  }

  function render(issue: GithubIssue, comments: GithubComment[], timeline: GithubTimelineEvent[]): void {
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
        <button class="btn btn-ghost" id="browser-btn">Browser ↗</button>
        <button class="btn btn-ghost" id="copy-btn">Copy as prompt</button>
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
      refreshLabelPicker = renderPicker(
        'label-picker', repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), editFormSelectedLabels,
        () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…',
      );
      refreshAssigneePicker = renderPicker(
        'assignee-picker', assignableUsers.map(u => ({ value: u.login, label: u.login })), editFormSelectedAssignees,
        () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…',
      );
    } else {
      refreshLabelPicker = null;
      refreshAssigneePicker = null;
      editFormSelectedLabels = null;
      editFormSelectedAssignees = null;
    }
    bindEvents(issue);
    bindAvatarFallbacks();
    if (!editing) bindTaskCheckboxes();
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
      if (currentIssue) render(currentIssue, lastComments, lastTimeline);
    });
    document.getElementById('cancel-btn')?.addEventListener('click', () => {
      editing = false;
      if (currentIssue) render(currentIssue, lastComments, lastTimeline);
    });
    document.getElementById('save-btn')?.addEventListener('click', () => {
      const title = (document.getElementById('edit-title') as HTMLInputElement).value.trim();
      const body = (document.getElementById('edit-body') as HTMLTextAreaElement).value;
      if (!title) return;
      const labels = Array.from(editFormSelectedLabels ?? []);
      const assignees = Array.from(editFormSelectedAssignees ?? []);
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
        if (currentIssue) render(currentIssue, lastComments, lastTimeline);
      } else if (target.classList.contains('comment-cancel-btn')) {
        editingCommentId = null;
        if (currentIssue) render(currentIssue, lastComments, lastTimeline);
      } else if (target.classList.contains('comment-save-btn')) {
        const textarea = target.closest('.comment')?.querySelector('.comment-edit-input') as HTMLTextAreaElement;
        const body = textarea.value.trim();
        if (!body) return;
        vscode.postMessage({ type: 'editComment', commentId: id, body });
      } else if (target.classList.contains('comment-delete-btn')) {
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
        issueTemplates = msg.templates ?? [];
        viewerLogin = msg.viewerLogin;
        if (msg.issue) renderDetail(msg.issue, msg.comments, msg.timeline);
        else renderCreateForm();
        break;
      case 'issueDetailError':
        detailEl.innerHTML = `<div id="empty">Failed to load issue: ${escapeHtml(msg.message)}</div>`;
        break;
      case 'commentPostFailed': {
        const btn = detailEl.querySelector<HTMLButtonElement>('#comment-btn');
        if (btn) btn.disabled = false;
        break;
      }
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
