'use strict';

// Pure HTML for the pull request tab (conventions in detailHtml.ts): data in, string out, no DOM. Every
// host-supplied string goes through escapeHtml except `bodyHTML`, which GitHub renders and the caller sanitizes
// first (withBodies). Reuses avatarHtml / eventLabelChips from detailHtml.ts; every name here starts with `pull`
// because all webview files share one global scope.

type PullStateKey = 'open' | 'draft' | 'merged' | 'closed';

const PULL_STATE_TEXT: Record<PullStateKey, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
const PULL_STATE_ICON: Record<PullStateKey, string> = {
  open: 'git-pull-request', draft: 'git-pull-request-draft', merged: 'git-merge', closed: 'git-pull-request-closed',
};
const PULL_STATE_TONE: Record<PullStateKey, string> = {
  open: 'state-open', draft: 'state-not-planned', merged: 'state-completed', closed: 'state-closed',
};
const PULL_REVIEW_TEXT: Record<PullVerdict, string> = {
  approved: 'approved these changes', changes: 'requested changes', commented: 'reviewed', dismissed: 'had their review dismissed',
};
const PULL_REVIEW_ICON: Record<PullVerdict, string> = { approved: 'check', changes: 'x', commented: 'comment', dismissed: 'skip' };
const PULL_VERDICT_TITLE: Record<PullVerdict | 'pending', string> = {
  approved: 'Approved', changes: 'Changes requested', commented: 'Commented', dismissed: 'Review dismissed', pending: 'Review requested',
};
const PULL_EVENT_PARTS: Record<'closed' | 'merged' | 'reopened' | 'ready' | 'draft', { icon: string; tone: string; text: string }> = {
  closed: { icon: 'git-pull-request-closed', tone: 'state-closed', text: 'closed this' },
  merged: { icon: 'git-merge', tone: 'state-completed', text: 'merged this' },
  reopened: { icon: 'issue-reopened', tone: 'state-open', text: 'reopened this' },
  ready: { icon: 'git-pull-request', tone: 'state-open', text: 'marked this as ready for review' },
  draft: { icon: 'git-pull-request-draft', tone: '', text: 'converted this to a draft' },
};
const PULL_CHECK_TEXT: Record<PullCheckState, string> = {
  failure: 'failing', pending: 'in progress', success: 'successful', neutral: 'skipped',
};

const pullAsUser = (u: PullUser): GithubUser => ({ login: u.login, avatar_url: u.avatar });
const pullPlural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function pullStateKey(p: PullPage): PullStateKey {
  return p.state === 'open' && p.draft ? 'draft' : p.state;
}

/** Review, merge, draft and close/reopen. The page only asks; the host re-checks `actions` before it writes anything. */
function pullActionsHtml(p: PullPage): string {
  const a = p.actions;
  const button = (act: string, label: string, kind = 'secondary', disabled = false): string =>
    `<button type="button" class="btn btn-${kind}" data-act="${act}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const buttons: string[] = [];
  if (a.review.available) buttons.push(button('review', a.review.pending === null ? 'Review' : `Finish review (${a.review.pending})`));
  if (p.state === 'open') buttons.push(button('merge', 'Merge', 'primary', !a.merge.enabled));
  if (a.draft) buttons.push(button(a.draft, a.draft === 'ready' ? 'Ready for review' : 'Convert to draft'));
  if (a.state) buttons.push(button(a.state, a.state === 'close' ? 'Close' : 'Reopen'));
  if (buttons.length === 0) return '';
  const hint = p.state === 'open' && a.merge.hint ? `<span class="muted">${escapeHtml(a.merge.hint)}</span>` : '';
  return `<div class="pr-actions">${buttons.join('')}${hint}</div>`;
}

function pullHeaderHtml(p: PullPage): string {
  const key = pullStateKey(p);
  const verb = p.state === 'merged' ? 'merged' : p.state === 'closed' ? 'wanted to merge' : 'wants to merge';
  return `<div class="title-row">
      <h1 class="title">${escapeHtml(p.title)} <span class="number">#${p.number}</span></h1>
      <div class="title-actions">
        <button type="button" class="btn btn-secondary" data-act="checkout">${octicon('git-branch')} Check out</button>
        <button type="button" class="btn btn-secondary" data-act="open-github">${octicon('link-external')} GitHub</button>
        <button type="button" class="icon-btn" data-act="refresh" title="Refresh" aria-label="Refresh">${octicon('sync')}</button>
      </div>
    </div>
    <div class="meta-row">
      <span class="state-badge ${PULL_STATE_TONE[key]}">${octicon(PULL_STATE_ICON[key], 'state-icon')} ${PULL_STATE_TEXT[key]}</span>
      <span><b>${escapeHtml(p.author.login)}</b> ${verb} <code>${escapeHtml(p.headRef)}</code>${p.fork ? ' (from a fork)' : ''} into <code>${escapeHtml(p.baseRef)}</code></span>
      <span>· ${pullPlural(p.changedFiles, 'file')} <span class="pr-add">+${p.additions}</span> <span class="pr-del">−${p.deletions}</span></span>
    </div>
    ${pullActionsHtml(p)}`;
}

/** A card with the author's avatar. `what` is fixed text from this file, never host data. */
function pullPostHtml(author: PullUser, what: string, at: string, bodyHTML: string, emptyHint: string): string {
  return `<div class="post"><div class="post-avatar">${avatarHtml(pullAsUser(author), true)}</div><div class="post-card">
      <div class="post-header"><b class="post-author">${escapeHtml(author.login)}</b><span class="post-when">${what} ${timeHtml(at)}</span></div>
      <div class="post-body">${bodyHTML || `<span class="muted">${emptyHint}</span>`}</div>
    </div></div>`;
}

function pullRailHtml(icon: string, tone: string, actor: string, text: string, at: string, link = ''): string {
  return `<div class="tl-event"><span class="tl-badge ${tone}">${octicon(icon)}</span>`
    + `<div class="tl-text"><b class="tl-actor">${escapeHtml(actor)}</b> ${text} ${timeHtml(at)}${link}</div></div>`;
}

function pullEntryHtml(e: PullTimelineEntry): string {
  if (e.kind === 'comment') return pullPostHtml(e.author, 'commented', e.at, e.bodyHTML, '');
  if (e.kind === 'event') {
    const parts = PULL_EVENT_PARTS[e.event];
    return pullRailHtml(parts.icon, parts.tone, e.actor, parts.text, e.at);
  }
  const inline = e.comments > 0 ? ` with ${pullPlural(e.comments, 'inline comment')}` : '';
  if (e.bodyHTML) return pullPostHtml(e.author, PULL_REVIEW_TEXT[e.verdict] + inline, e.at, e.bodyHTML, '');
  const link = e.url ? ` <a href="${escapeHtml(e.url)}">View</a>` : '';
  return pullRailHtml(PULL_REVIEW_ICON[e.verdict], `pr-${e.verdict}`, e.author.login, PULL_REVIEW_TEXT[e.verdict] + inline, e.at, link);
}

/** "2 failing, 1 in progress, 14 successful": only the groups that exist. */
function checkSummary(checks: PullCheck[]): string {
  return (['failure', 'pending', 'success', 'neutral'] as PullCheckState[])
    .map(s => ({ n: checks.filter(c => c.state === s).length, text: PULL_CHECK_TEXT[s] }))
    .filter(g => g.n > 0)
    .map(g => `${g.n} ${g.text}`)
    .join(', ');
}

function pullChecksHtml(p: PullPage): string {
  if (p.checks.length === 0) return '';
  const canRerun = p.checks.some(c => c.state === 'failure' && c.runId !== null);
  const rows = p.checks.map(c => `<div class="check-row">
      <span class="check-dot check-${c.state}" title="${PULL_CHECK_TEXT[c.state]}"></span>
      <span class="check-name">${escapeHtml(c.name)}</span>
      <span class="muted">${escapeHtml(c.description)}</span>
      ${c.url ? `<a class="check-link" href="${escapeHtml(c.url)}">Details</a>` : ''}
    </div>`).join('');
  const more = p.checksTotal > p.checks.length
    ? `<div class="muted check-more">Showing ${p.checks.length} of ${p.checksTotal} checks.</div>` : '';
  return `<section class="checks"><div class="checks-head"><b>Checks</b> <span class="muted">${checkSummary(p.checks)}</span>`
    + `${canRerun ? '<button type="button" class="btn btn-secondary" data-act="rerun">Re-run failed jobs</button>' : ''}</div>${rows}${more}</section>`;
}

function pullCommitsHtml(p: PullPage): string {
  if (p.commits.length === 0) return '';
  const rows = p.commits.map(c => `<div class="commit-row"><a href="${escapeHtml(c.url)}">${escapeHtml(c.headline)}</a>`
    + `<span class="muted">${escapeHtml(c.author)} · <code>${escapeHtml(c.short)}</code> · ${timeHtml(c.at)}</span></div>`).join('');
  const more = p.commitTotal > p.commits.length
    ? `<div class="muted check-more">Showing the first ${p.commits.length} of ${p.commitTotal} commits.</div>` : '';
  return `<details class="commits"><summary>${pullPlural(p.commitTotal, 'commit')}</summary>${rows}${more}</details>`;
}

function pullSideSection(title: string, body: string): string {
  return `<section class="sb-section"><div class="sb-head"><span>${title}</span></div><div class="sb-body">${body}</div></section>`;
}

function pullSidebarHtml(p: PullPage): string {
  const none = (text: string): string => `<span class="muted">${text}</span>`;
  const person = (u: PullUser): string => `<div class="sb-person">${avatarHtml(pullAsUser(u))} ${escapeHtml(u.login)}</div>`;
  const reviewers = p.reviewers.length > 0
    ? p.reviewers.map(r => `<div class="sb-person">${avatarHtml(pullAsUser(r))} ${escapeHtml(r.login)}`
      + `<span class="rv rv-${r.state}" title="${PULL_VERDICT_TITLE[r.state]}">`
      + `${r.state === 'pending' ? '<span class="muted">requested</span>' : octicon(PULL_REVIEW_ICON[r.state])}</span></div>`).join('')
    : none('No reviewers');
  return pullSideSection('Reviewers', reviewers)
    + pullSideSection('Assignees', p.assignees.length > 0 ? p.assignees.map(person).join('') : none('No one'))
    + pullSideSection('Labels', p.labels.length > 0 ? eventLabelChips(p.labels) : none('None yet'))
    + pullSideSection('Milestone', p.milestone ? `<div>${octicon('milestone')} ${escapeHtml(p.milestone)}</div>` : none('No milestone'));
}

/** The whole tab body. `p` must already have its bodies sanitized (see withBodies). */
function pullPageHtml(p: PullPage): string {
  const cut = p.timelineTotal > p.timeline.length
    ? `<div class="muted pr-foot">Showing the first ${p.timeline.length} of ${p.timelineTotal} events. `
      + `<button type="button" class="link-btn" data-act="open-github">See the rest on GitHub</button></div>` : '';
  return `<div id="page">${pullHeaderHtml(p)}<div id="layout"><div id="main">
      ${pullPostHtml(p.author, 'opened this', p.createdAt, p.bodyHTML, 'No description provided.')}
      ${pullChecksHtml(p)}${pullCommitsHtml(p)}${p.timeline.map(pullEntryHtml).join('')}${cut}
      <div class="muted pr-foot">Conversation comments are written on GitHub for now.
        <button type="button" class="link-btn" data-act="open-github">Open on GitHub</button></div>
    </div><aside id="sidebar">${pullSidebarHtml(p)}</aside></div></div>`;
}

/** `p` with `fn` applied to every GitHub-rendered body: the glue passes the DOMPurify + image-placeholder step. Does not mutate `p`. */
function withBodies(p: PullPage, fn: (html: string) => string): PullPage {
  return {
    ...p,
    bodyHTML: fn(p.bodyHTML),
    timeline: p.timeline.map(e => (e.kind === 'event' ? e : { ...e, bodyHTML: fn(e.bodyHTML) })),
  };
}
