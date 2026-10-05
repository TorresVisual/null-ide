'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const DOMPurify: { sanitize(html: string): string };

/** What a close / reopen button asks for; the host maps it to REST `state` + `state_reason`. */
type StateTarget = 'completed' | 'not_planned' | 'reopen';

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('detail') as HTMLDivElement;
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.className = 'hidden';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);

  let detail: IssueDetail | null = null;
  let metadata: DetailMetadata | null = null;
  let viewer: string | null = null;
  let repoName = '';
  let closedLocally = false;
  let hasMoreTimeline = false;
  /** Id of the post whose edit form is open (the issue's own id for the body). */
  let editingId: string | null = null;
  /** What the open edit form holds. The timeline is rebuilt around the form on every render, so the form is re-created from this. */
  let editDraft = '';
  let editComposer: Composer | null = null;
  let commentComposer: Composer | null = null;
  /** Unsent new-comment text queued for the host, and the timer that sends it. */
  let pendingDraft: { number: number; body: string } | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let editingTitle = false;
  let commentBusy = false;
  /** Writes the host hasn't answered yet. While any are in flight, a refresh must not overwrite the optimistic state. */
  let pending = 0;
  /** `detail` as it was before the oldest unanswered write, to restore if that write fails. */
  let rollback: IssueDetail | null = null;
  let pageMounted = false;
  let composerFor = 0;
  let candidateAnchor: HTMLElement | null = null;
  let createForm: CreateForm | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (message: unknown): void => vscode.postMessage(message);
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

  const mentionUsers = (): GithubUser[] => [...(metadata?.assignees ?? []), ...(detail?.participants ?? [])];

  /** The unsent comment text is stored by the host 500 ms after the last keystroke, so it survives switching issues and closing the tab. */
  function saveDraftSoon(number: number, body: string): void {
    pendingDraft = { number, body };
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 500);
  }

  /** Sends a queued draft now. It carries the issue number it was typed for, so a late flush can't land under another issue. */
  function flushDraft(): void {
    clearTimeout(draftTimer);
    if (pendingDraft) post({ type: 'saveDraft', ...pendingDraft });
    pendingDraft = null;
  }

  function dropDraft(): void {
    clearTimeout(draftTimer);
    pendingDraft = null;
  }
  document.addEventListener('visibilitychange', flushDraft);

  function startEditing(target: IssuePost): void {
    editingId = target.id;
    editDraft = target.body;
    renderTimeline();
    editComposer?.focus();
  }

  function stopEditing(): void {
    editingId = null;
    editDraft = '';
    editComposer = null;
  }

  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 5000);
  }

  const createIo: CreateIo = { post, toast, saveDraftSoon: body => saveDraftSoon(0, body), dropDraft };

  // ---- rendering ----------------------------------------------------------------------------------------------

  /** Server-rendered markdown, minus images the webview can't load, sanitized once more before it touches the DOM. */
  const prepared = (p: IssuePost): IssuePost => ({ ...p, bodyHTML: DOMPurify.sanitize(neutralizeImagesHtml(p.bodyHTML)) });

  function bindAvatarFallbacks(): void {
    root.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function mountPage(): void {
    root.innerHTML = `
      <div id="sticky" class="hidden"></div>
      <div id="page">
        <header id="header"></header>
        <div id="layout">
          <main id="main"><div id="timeline"></div><div id="composer"></div></main>
          <aside id="sidebar"></aside>
        </div>
      </div>`;
    new IntersectionObserver(([entry]) => $('sticky').classList.toggle('hidden', entry.isIntersecting))
      .observe($('header'));
    pageMounted = true;
    composerFor = 0;
  }

  function renderHeader(): void {
    if (!detail) return;
    const { issue } = detail;
    const title = editingTitle
      ? `<div class="title-edit"><input id="title-input" value="${escapeHtml(issue.title)}" aria-label="Title">
           <button type="button" class="btn btn-primary" data-act="save-title">Save</button>
           <button type="button" class="btn btn-secondary" data-act="cancel-title">Cancel</button></div>`
      : `<h1 class="title">${escapeHtml(issue.title)} <span class="number">#${issue.number}</span></h1>
         <div class="title-actions">
           ${detail.post.viewerCanUpdate ? '<button type="button" class="btn btn-ghost" data-act="edit-title">Edit</button>' : ''}
           <button type="button" class="icon-btn" data-act="header-menu" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
         </div>`;
    const parent = detail.parent
      ? ` · sub-issue of <button type="button" class="link-btn" data-act="open-issue" data-number="${detail.parent.number}">#${detail.parent.number} ${escapeHtml(detail.parent.title)}</button>` : '';
    $('header').innerHTML = `
      <div class="title-row">${title}</div>
      <div class="meta-row">
        ${issueStateBadge(issue.state, issue.state_reason)}
        ${closedLocally && issue.state === 'open' ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}
        <span><b>${escapeHtml(issue.user.login)}</b> opened this ${timeHtml(issue.created_at ?? detail.post.createdAt)} · ${plural(issue.comments, 'comment')}${parent}</span>
      </div>`;
    $('sticky').innerHTML = `${issueStateIcon(issue.state, issue.state_reason)} <b>${escapeHtml(issue.title)}</b> <span class="muted">#${issue.number}</span>`;
    bindAvatarFallbacks();
  }

  function renderSidebar(): void {
    if (!detail) return;
    $('sidebar').innerHTML = sidebarHtml(detail, metadata, viewer);
    bindAvatarFallbacks();
  }

  function renderTimeline(): void {
    if (!detail) return;
    const d = detail;
    // The timeline is rebuilt below; if the user was typing in the edit form, put the caret back afterwards.
    const refocus = editComposer !== null && editComposer.el.contains(document.activeElement);
    const parts = [postHtml(prepared(d.post), 'body', editingId === d.post.id), subIssuesHtml(d)];
    for (const item of d.timeline) {
      parts.push(item.kind === 'comment' ? postHtml(prepared(item), 'comment', editingId === item.id) : eventHtml(item));
    }
    if (hasMoreTimeline) parts.push('<button type="button" class="btn btn-ghost load-more" data-act="load-more">Load more</button>');
    $('timeline').innerHTML = parts.join('');
    mountEditComposer();
    resolveImagesIn($('timeline'), post);
    if (refocus) editComposer?.focus();
    // GitHub's rendered task items are disabled checkboxes; make them live for people who can edit the body.
    $('timeline').querySelectorAll<HTMLInputElement>('.post[data-kind="body"] .post-body input[type=checkbox]')
      .forEach((box, index) => {
        box.disabled = !d.post.viewerCanUpdate;
        box.addEventListener('change', () => {
          beginWrite(() => undefined);
          post({ type: 'toggleTask', index, checked: box.checked });
        });
      });
    bindAvatarFallbacks();
  }

  /** Puts a composer in the open edit form's slot. It is re-created on every render, from `editDraft`. */
  function mountEditComposer(): void {
    editComposer = null;
    const slot = root.querySelector<HTMLElement>('.composer-slot');
    if (!slot || editingId === null || !detail) return;
    const id = editingId;
    editComposer = createComposer({
      value: editDraft,
      pristine: findPost(id)?.body ?? '',
      label: id === detail.post.id ? 'Edit description' : 'Edit comment',
      placeholder: '',
      post,
      users: mentionUsers,
      onChange: v => { editDraft = v; },
      onSubmit: () => saveEdit(id),
      onCancel: () => { stopEditing(); renderTimeline(); },
    });
    slot.replaceWith(editComposer.el);
  }

  function renderAll(): void {
    renderHeader();
    renderSidebar();
    renderTimeline();
    updateComposer();
  }

  function mountComposer(draft: string): void {
    $('composer').innerHTML = `
      <div class="composer-card">
        <div id="comment-slot"></div>
        <div class="composer-actions">
          <span class="split">
            <button type="button" class="btn btn-ghost" id="close-main" data-act="close-main"></button>
            <button type="button" class="btn btn-ghost split-caret" id="close-caret" data-act="close-menu" aria-label="Close options">${octicon('triangle-down')}</button>
          </span>
          <button type="button" class="btn btn-primary" id="comment-btn" data-act="comment">Comment</button>
        </div>
      </div>`;
    commentComposer = createComposer({
      value: draft,
      label: 'Comment',
      placeholder: 'Leave a comment',
      post,
      users: mentionUsers,
      onChange: v => { updateComposer(); saveDraftSoon(composerFor, v); },
      onSubmit: () => submitComment(),
    });
    $('comment-slot').replaceWith(commentComposer.el);
    commentBusy = false;
  }

  /** Close/Reopen wording follows the issue's state and whether a comment is typed, like github.com. */
  function updateComposer(): void {
    if (!commentComposer || !detail) return;
    const hasText = commentComposer.getValue().trim().length > 0;
    const closed = detail.issue.state === 'closed';
    $('close-main').textContent = closed ? (hasText ? 'Reopen with comment' : 'Reopen issue') : (hasText ? 'Close with comment' : 'Close issue');
    $('close-caret').classList.toggle('hidden', closed);
    $<HTMLButtonElement>('close-main').disabled = commentBusy;
    $<HTMLButtonElement>('close-caret').disabled = commentBusy;
    $<HTMLButtonElement>('comment-btn').disabled = commentBusy || !hasText;
  }

  // ---- writes -------------------------------------------------------------------------------------------------

  /** Applies a change locally right away and counts it as unanswered until the host's `detail` or `failed` arrives. */
  function beginWrite(change: (d: IssueDetail) => void): void {
    if (!detail) return;
    if (pending === 0) rollback = clone(detail);
    pending++;
    change(detail);
    renderAll();
  }

  function applyState(to: StateTarget): void {
    beginWrite(d => {
      d.issue.state = to === 'reopen' ? 'open' : 'closed';
      d.issue.state_reason = to === 'reopen' ? 'reopened' : to;
    });
  }

  function submitComment(then?: StateTarget): void {
    const body = commentComposer ? commentComposer.getValue().trim() : '';
    if (commentBusy || (!body && !then)) return;
    if (commentComposer?.uploading()) {
      toast('Wait for the image to finish uploading.');
      return;
    }
    if (then) applyState(then);
    if (!body) {
      post({ type: 'setState', to: then });
      return;
    }
    commentBusy = true;
    updateComposer();
    post({ type: 'postComment', body, then });
  }

  function saveEdit(id: string): void {
    if (!editComposer || root.querySelector<HTMLButtonElement>('[data-act="save-edit"]')?.disabled) return;
    if (editComposer.uploading()) {
      toast('Wait for the image to finish uploading.');
      return;
    }
    const body = editComposer.getValue();
    const isBody = detail?.post.id === id;
    if (!isBody && !body.trim()) {
      toast('A comment can\'t be empty.');
      return;
    }
    if (isBody) beginWrite(() => undefined); // re-renders the form, so the button is looked up afterwards
    const button = root.querySelector<HTMLButtonElement>('[data-act="save-edit"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    post({ type: 'editPost', kind: isBody ? 'body' : 'comment', id, body });
  }

  /** The target a Close / Reopen click means for the issue's current state. */
  const closeTarget = (): StateTarget => (detail?.issue.state === 'closed' ? 'reopen' : 'completed');

  // ---- pickers ------------------------------------------------------------------------------------------------

  function pickAssignees(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issue.assignees;
    const known = [...(metadata?.assignees ?? [])];
    for (const a of current) if (!known.some(k => k.login === a.login)) known.push(a);
    const items = known.map(u => ({
      value: u.login, label: u.login, html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
      selected: current.some(a => a.login === u.login),
    }));
    pickMany(anchor, 'Assign up to 10 people', items, chosen => {
      const logins = [...chosen];
      beginWrite(d => { d.issue.assignees = logins.map(l => known.find(k => k.login === l)!); });
      post({ type: 'setAssignees', logins });
    });
  }

  function pickLabels(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issue.labels;
    const known = [...(metadata?.labels ?? [])];
    for (const l of current) if (!known.some(k => k.name === l.name)) known.push(l);
    const items = known.map(l => ({
      value: l.name, label: l.name, html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
      description: l.description ?? undefined, selected: current.some(c => c.name === l.name),
    }));
    pickMany(anchor, 'Apply labels', items, chosen => {
      const names = [...chosen];
      beginWrite(d => { d.issue.labels = names.map(n => known.find(k => k.name === n)!); });
      post({ type: 'setLabels', names });
    });
  }

  function pickMilestone(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.milestone?.number ?? null;
    const items: PickerItem[] = [{ value: '', label: 'No milestone', selected: current === null }]
      .concat((metadata?.milestones ?? []).map(m => ({ value: String(m.number), label: m.title, selected: m.number === current })));
    openPicker({
      anchor, title: 'Set milestone', items, filterable: items.length > 8,
      onSelect: v => {
        const number = v === '' ? null : Number(v);
        if (number === current) return;
        const found = (metadata?.milestones ?? []).find(m => m.number === number);
        beginWrite(d => { d.milestone = found ? { number: found.number, title: found.title, percent: 0 } : null; });
        post({ type: 'setMilestone', number });
      },
    });
  }

  function pickType(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issueType?.id ?? null;
    const items: PickerItem[] = [{ value: '', label: 'No type', selected: current === null }]
      .concat((metadata?.types ?? []).map(t => ({ value: t.id, label: t.name, selected: t.id === current })));
    openPicker({
      anchor, title: 'Set issue type', items, filterable: false,
      onSelect: v => {
        const id = v === '' ? null : v;
        if (id === current) return;
        const found = (metadata?.types ?? []).find(t => t.id === id);
        beginWrite(d => { d.issueType = found ? { id: found.id, name: found.name } : null; });
        post({ type: 'setType', id });
      },
    });
  }

  function findPost(id: string): IssuePost | undefined {
    if (!detail) return undefined;
    if (detail.post.id === id) return detail.post;
    return detail.timeline.find((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment' && i.id === id);
  }

  function reactionPicker(anchor: HTMLElement, id: string): void {
    const target = findPost(id);
    if (!target) return;
    openPicker({
      anchor, title: 'Pick your reaction', items: reactionPickerItems(target), multi: true, filterable: false,
      onSelect: content => {
        const has = target.reactions.some(r => r.content === content && r.viewerHasReacted);
        post({ type: 'toggleReaction', subjectId: id, content, add: !has });
      },
    });
  }

  function quoteReply(target: IssuePost): void {
    const postEl = root.querySelector(`.post[data-id="${CSS.escape(target.id)}"]`);
    const selection = window.getSelection();
    const selected = selection && postEl && postEl.contains(selection.anchorNode) ? selection.toString().trim() : '';
    commentComposer?.insertBlock(quoteMarkdown(selected || target.body));
  }

  function postMenu(anchor: HTMLElement, id: string): void {
    const target = findPost(id);
    if (!target || !detail) return;
    const isBody = target.id === detail.post.id;
    const items: PickerItem[] = [{ value: 'link', label: 'Copy link' }, { value: 'quote', label: 'Quote reply' }];
    if (target.viewerCanUpdate) items.push({ value: 'edit', label: 'Edit' });
    if (!isBody && target.viewerCanDelete) items.push({ value: 'delete', label: 'Delete' });
    openPicker({
      anchor, title: 'Actions', items, filterable: false,
      onSelect: action => {
        if (action === 'link') post({ type: 'copyText', text: target.url });
        else if (action === 'quote') quoteReply(target);
        else if (action === 'edit') startEditing(target);
        else if (action === 'delete') post({ type: 'deletePost', id: target.id });
      },
    });
  }

  function headerMenu(anchor: HTMLElement): void {
    const items: PickerItem[] = [
      { value: 'prompt', label: 'Copy as prompt' }, { value: 'browser', label: 'Open on github.com' },
      { value: 'refresh', label: 'Refresh' },
    ];
    if (detail?.post.viewerCanUpdate) {
      items.push({ value: 'sub', label: 'Add existing sub-issue…' }, { value: 'create-sub', label: 'Create sub-issue…' });
    }
    openPicker({
      anchor, title: 'Actions', items, filterable: false,
      onSelect: action => {
        if (action === 'prompt') post({ type: 'copyAsPrompt' });
        else if (action === 'browser') post({ type: 'openInBrowser' });
        else if (action === 'refresh') post({ type: 'refresh' });
        else if (action === 'sub') requestCandidates(anchor);
        else if (action === 'create-sub') post({ type: 'createSubIssue' });
      },
    });
  }

  function requestCandidates(anchor: HTMLElement): void {
    candidateAnchor = anchor;
    post({ type: 'requestCandidates' });
  }

  function candidatePicker(candidates: Array<{ number: number; title: string }>): void {
    if (!detail) return;
    const taken = new Set<number>([detail.issue.number, ...detail.subIssues.map(s => s.number)]);
    if (detail.parent) taken.add(detail.parent.number);
    const items = candidates.filter(c => !taken.has(c.number)).map(c => ({ value: String(c.number), label: `#${c.number} ${c.title}` }));
    const anchor = candidateAnchor && candidateAnchor.isConnected ? candidateAnchor : root;
    openPicker({
      anchor, title: 'Add sub-issue', items, emptyText: 'No other open issues',
      onSelect: v => {
        const number = Number(v);
        const picked = candidates.find(c => c.number === number);
        beginWrite(d => d.subIssues.push({
          id: '', number, title: picked?.title ?? `#${number}`, state: 'open', stateReason: null, url: '', assignees: [],
        }));
        post({ type: 'addSubIssue', number });
      },
    });
  }

  function subMenu(anchor: HTMLElement, id: string, number: number): void {
    openPicker({
      anchor, title: 'Sub-issue', filterable: false,
      items: [{ value: 'open', label: 'Open' }, { value: 'remove', label: 'Remove sub-issue' }],
      onSelect: action => {
        if (action === 'open') post({ type: 'openIssue', number, newTab: false });
        else {
          beginWrite(d => { d.subIssues = d.subIssues.filter(s => s.id !== id); });
          post({ type: 'removeSubIssue', id });
        }
      },
    });
  }

  // ---- events -------------------------------------------------------------------------------------------------

  function handleAction(act: string, el: HTMLElement, e: MouseEvent): void {
    const id = el.dataset.id ?? '';
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    switch (act) {
      case 'edit-title':
        editingTitle = true;
        renderHeader();
        $<HTMLInputElement>('title-input').focus();
        break;
      case 'save-title': {
        const title = $<HTMLInputElement>('title-input').value.trim();
        editingTitle = false;
        if (title && detail && title !== detail.issue.title) {
          beginWrite(d => { d.issue.title = title; });
          post({ type: 'setTitle', title });
        } else renderHeader();
        break;
      }
      case 'cancel-title': editingTitle = false; renderHeader(); break;
      case 'header-menu': headerMenu(el); break;
      case 'react': {
        const content = el.dataset.content!;
        const has = findPost(id)?.reactions.some(r => r.content === content && r.viewerHasReacted) ?? false;
        post({ type: 'toggleReaction', subjectId: id, content, add: !has });
        break;
      }
      case 'react-picker': reactionPicker(el, id); break;
      case 'post-menu': postMenu(el, id); break;
      case 'save-edit': saveEdit(id); break;
      case 'cancel-edit': stopEditing(); renderTimeline(); break;
      case 'open-issue': post({ type: 'openIssue', number: Number(el.dataset.number), newTab }); break;
      case 'add-sub': requestCandidates(el); break;
      case 'create-sub': post({ type: 'createSubIssue' }); break;
      case 'sub-menu': subMenu(el, id, Number(el.dataset.number)); break;
      case 'load-more':
        (el as HTMLButtonElement).disabled = true;
        post({ type: 'loadMoreTimeline' });
        break;
      case 'pick-assignees': pickAssignees(el); break;
      case 'pick-labels': pickLabels(el); break;
      case 'pick-type': pickType(el); break;
      case 'pick-milestone': pickMilestone(el); break;
      case 'assign-me':
        if (viewer) {
          const me = (metadata?.assignees ?? []).find(a => a.login === viewer) ?? { login: viewer, avatar_url: '' };
          beginWrite(d => { d.issue.assignees = [me]; });
          post({ type: 'setAssignees', logins: [viewer] });
        }
        break;
      case 'branch': post({ type: 'createBranch' }); break;
      case 'worktree': post({ type: 'createWorktree' }); break;
      case 'comment': submitComment(); break;
      case 'close-main': submitComment(closeTarget()); break;
      case 'close-menu':
        openPicker({
          anchor: el, title: 'Close issue', filterable: false,
          items: [{ value: 'completed', label: 'Close as completed' }, { value: 'not_planned', label: 'Close as not planned' }],
          onSelect: v => submitComment(v as StateTarget),
        });
        break;
      case 'retry': post({ type: 'refresh' }); break;
    }
  }

  /** Links inside GitHub-rendered markdown: this repo's issues open in a tab, anything else leaves for the browser. */
  function handleLink(a: HTMLAnchorElement, e: MouseEvent): void {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) return; // footnote jumps stay in the page
    e.preventDefault();
    const number = issueNumberFromLink(href, repoName);
    if (number !== null) post({ type: 'openIssue', number, newTab: e.ctrlKey || e.metaKey || e.button === 1 });
    else post({ type: 'openExternal', url: href });
  }

  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const actEl = target.closest<HTMLElement>('[data-act]');
    if (actEl) {
      if (!createForm) handleAction(actEl.dataset.act!, actEl, e);
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link && link.closest('.post-body, .tl-text, .sb-pr')) {
      handleLink(link, e);
      return;
    }
    const placeholder = target.closest<HTMLElement>('.img-placeholder');
    if (placeholder && !placeholder.closest('a')) post({ type: 'openExternal', url: placeholder.dataset.src ?? '' });
  }

  root.addEventListener('click', onClick);
  root.addEventListener('auxclick', e => {
    const target = e.target as HTMLElement;
    if (e.button === 1 && (target.closest('a[href]') || target.closest('[data-act="open-issue"]'))) onClick(e);
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'detail': {
        createForm = null;
        if (!msg.afterWrite) retryFailedImages();
        if (!detail || detail.issue.number !== msg.detail.issue.number) {
          // A different issue (this tab was reused, or the create form just became an issue): nothing in flight applies.
          pending = 0;
          rollback = null;
        } else if (msg.afterWrite) {
          pending = Math.max(0, pending - 1);
        }
        if (pending > 0) break; // newer local edits are still in flight; the last answer is the one to show
        rollback = null;
        detail = msg.detail;
        viewer = msg.viewer;
        repoName = msg.repo;
        closedLocally = msg.closedLocally;
        hasMoreTimeline = msg.detail.hasMoreTimeline;
        if (!pageMounted) mountPage();
        if (composerFor !== msg.detail.issue.number) {
          flushDraft(); // whatever was typed for the previous issue belongs to it
          composerFor = msg.detail.issue.number;
          stopEditing();
          editingTitle = false;
          mountComposer(msg.draft ?? '');
        }
        if (msg.afterWrite) { stopEditing(); editingTitle = false; }
        renderAll();
        break;
      }
      case 'metadata':
        metadata = { labels: msg.labels, assignees: msg.assignees, milestones: msg.milestones, types: msg.types };
        renderSidebar();
        break;
      case 'timelinePage': {
        if (!detail) break;
        const have = new Set(detail.timeline.filter((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment').map(c => c.id));
        detail.timeline.push(...(msg.items as TimelineItem[]).filter(i => i.kind !== 'comment' || !have.has(i.id)));
        hasMoreTimeline = msg.hasMore;
        renderTimeline();
        break;
      }
      case 'commentAdded': {
        if (!detail) break;
        const item = msg.item as IssuePost;
        if (!findPost(item.id)) detail.timeline.push({ kind: 'comment', ...item });
        detail.issue.comments++;
        commentComposer?.setValue('');
        commentBusy = false;
        renderHeader();
        renderTimeline();
        updateComposer();
        $('timeline').lastElementChild?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'postUpdated': {
        const item = msg.item as IssuePost;
        const at = detail ? detail.timeline.findIndex(i => i.kind === 'comment' && i.id === item.id) : -1;
        if (detail && at >= 0) detail.timeline[at] = { kind: 'comment', ...item };
        stopEditing();
        renderTimeline();
        break;
      }
      case 'postDeleted':
        if (detail) {
          detail.timeline = detail.timeline.filter(i => i.kind !== 'comment' || i.id !== msg.id);
          detail.issue.comments = Math.max(0, detail.issue.comments - 1);
          renderHeader();
          renderTimeline();
        }
        break;
      case 'reactions': {
        const target = findPost(msg.id);
        if (target) {
          target.reactions = msg.groups;
          renderTimeline();
        }
        break;
      }
      case 'previewResult':
      case 'suggestions':
      case 'uploadResult':
        composerReceive(msg);
        break;
      case 'imageResolved': imageResolved(msg.url, msg.src); break;
      case 'imageFailed': imageFailed(msg.url, msg.message); break;
      case 'candidates':
        if (createForm) createForm.candidates(msg.items); else candidatePicker(msg.items);
        break;
      case 'setParent': createForm?.setParent(msg.parent); break;
      case 'failed':
        toast(msg.message);
        if (msg.what === 'write' || msg.what === 'refresh') pending = Math.max(0, pending - 1);
        if (msg.what === 'write' && pending === 0 && rollback) {
          detail = rollback;
          rollback = null;
          stopEditing();
          renderAll();
        }
        if (msg.what === 'write' || msg.what === 'comment') { commentBusy = false; updateComposer(); }
        if (msg.what === 'edit' || msg.what === 'timeline') renderTimeline();
        break;
      case 'error':
        createForm = null;
        pageMounted = false;
        root.innerHTML = `<div id="empty">Failed to load issue: ${escapeHtml(msg.message)}
          <div><button type="button" class="btn btn-secondary" data-act="retry">Retry</button></div></div>`;
        break;
      case 'copied': toast('Copied'); break;
      case 'createInit':
        pageMounted = false;
        detail = null;
        pending = 0;
        rollback = null;
        createForm = renderCreateForm(root, msg, createIo);
        break;
      case 'createFailed': createForm?.failed(); break;
      case 'created': createForm?.created(msg.number); break;
    }
  });

  post({ type: 'ready' });
})();
