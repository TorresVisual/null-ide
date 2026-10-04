'use strict';

// Pure HTML for the detail tab's right sidebar and the sub-issue block (see detailHtml.ts for the conventions).

function sidebarSection(key: string, title: string, canEdit: boolean, body: string): string {
  const edit = canEdit
    ? `<button type="button" class="icon-btn" data-act="pick-${key}" title="Edit ${title.toLowerCase()}" aria-label="Edit ${title.toLowerCase()}">${octicon('gear')}</button>`
    : '';
  return `<section class="sb-section" data-sec="${key}"><div class="sb-head"><span>${title}</span>${edit}</div><div class="sb-body">${body}</div></section>`;
}

function pullRequestIcon(pr: LinkedPr): string {
  if (pr.state === 'merged') return octicon('git-merge', 'pr-icon pr-merged');
  if (pr.state === 'closed') return octicon('git-pull-request-closed', 'pr-icon pr-closed');
  return pr.isDraft ? octicon('git-pull-request-draft', 'pr-icon pr-draft') : octicon('git-pull-request', 'pr-icon pr-open');
}

/** Assignees, Labels, Type (only for repos that have issue types), Milestone, Development, Participants. */
function sidebarHtml(d: IssueDetail, meta: DetailMetadata | null, viewer: string | null): string {
  const canEdit = d.post.viewerCanUpdate;
  const none = (text: string): string => `<span class="muted">${text}</span>`;

  const assignees = d.issue.assignees.length > 0
    ? d.issue.assignees.map(a => `<div class="sb-person">${avatarHtml(a)} ${escapeHtml(a.login)}</div>`).join('')
    : none('No one')
      + (canEdit && viewer ? ` <button type="button" class="link-btn" data-act="assign-me">assign yourself</button>` : '');
  const labels = d.issue.labels.length > 0 ? eventLabelChips(d.issue.labels) : none('None yet');
  const type = d.issueType ? escapeHtml(d.issueType.name) : none('No type');
  const milestone = d.milestone
    ? `<div>${octicon('milestone')} ${escapeHtml(d.milestone.title)}</div>`
      + `<div class="progress" title="${d.milestone.percent}% complete"><span style="width:${d.milestone.percent}%"></span></div>`
    : none('No milestone');
  const prs = d.linkedPrs.map(pr =>
    `<div class="sb-pr"><a href="${escapeHtml(pr.url)}">${pullRequestIcon(pr)} ${escapeHtml(pr.title)} <span class="muted">#${pr.number}</span></a></div>`).join('');
  const development = prs
    + `<div class="sb-dev-actions"><button type="button" class="link-btn" data-act="branch">${octicon('git-branch')} Create a branch</button>`
    + `<button type="button" class="link-btn" data-act="worktree">${octicon('git-branch')} Create a worktree</button></div>`;
  const participants = d.participants.map(p => `<span title="${escapeHtml(p.login)}">${avatarHtml(p)}</span>`).join('');

  return sidebarSection('assignees', 'Assignees', canEdit, assignees)
    + sidebarSection('labels', 'Labels', canEdit, labels)
    + (d.issueType || (meta && meta.types.length > 0) ? sidebarSection('type', 'Type', canEdit, type) : '')
    + sidebarSection('milestone', 'Milestone', canEdit, milestone)
    + sidebarSection('development', 'Development', false, development)
    + (participants ? sidebarSection('participants', 'Participants', false, `<div class="sb-avatars">${participants}</div>`) : '');
}

/** The sub-issue list under the issue body: progress, one row per child, and (when editable) add / remove. */
function subIssuesHtml(d: IssueDetail): string {
  if (d.subIssues.length === 0) return '';
  const canEdit = d.post.viewerCanUpdate;
  const done = d.subIssues.filter(s => s.state === 'closed').length;
  const percent = Math.round((done / d.subIssues.length) * 100);
  const rows = d.subIssues.map(s => `
    <div class="sub-row">
      ${issueStateIcon(s.state, s.stateReason)}
      <button type="button" class="sub-title" data-act="open-issue" data-number="${s.number}">${escapeHtml(s.title)}</button>
      <span class="muted">#${s.number}</span>
      <span class="sub-people">${s.assignees.map(a => avatarHtml(a)).join('')}</span>
      ${canEdit ? `<button type="button" class="icon-btn" data-act="sub-menu" data-id="${escapeHtml(s.id)}" data-number="${s.number}" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>` : ''}
    </div>`).join('');
  return `<section class="subissues">
    <div class="sub-head"><b>Sub-issues</b> <span class="muted">${done} of ${d.subIssues.length}</span>
      <div class="progress"><span style="width:${percent}%"></span></div>
      ${canEdit ? `<button type="button" class="btn btn-ghost btn-small" data-act="add-sub">Add sub-issue</button>` : ''}
    </div>${rows}
  </section>`;
}
