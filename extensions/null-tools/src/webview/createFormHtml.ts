'use strict';

// Pure HTML for the New issue form: the template chooser and the right sidebar (see detailHtml.ts for the conventions).

/** What the form's sidebar shows. The form keeps one of these and re-renders the sidebar whenever a picker changes it. */
interface CreateSidebarState {
  assignees: GithubUser[];
  labels: GithubLabel[];
  type: { id: string; name: string } | null;
  milestone: { number: number; title: string } | null;
  parent: { number: number; title: string } | null;
}

/** One card per template, then a Blank issue card. `data-index` is the template's position, -1 for Blank. */
function templateChooserHtml(templates: IssueTemplate[]): string {
  const card = (index: number, name: string, about: string): string => `
    <button type="button" class="template-card" data-act="pick-template" data-index="${index}">
      <b>${escapeHtml(name)}</b>${about ? `<span class="muted">${escapeHtml(about)}</span>` : ''}
    </button>`;
  return `<h1 class="title">Choose a template</h1>
    <div class="template-grid">${templates.map((t, i) => card(i, t.name, t.about)).join('')}${card(-1, 'Blank issue', 'Create a new issue from scratch')}</div>`;
}

/** Assignees, Labels, Type (only for repos that have issue types), Milestone and Parent, each with an edit gear. */
function createSidebarHtml(s: CreateSidebarState, meta: DetailMetadata | null): string {
  const none = (text: string): string => `<span class="muted">${text}</span>`;
  const assignees = s.assignees.length > 0
    ? s.assignees.map(a => `<div class="sb-person">${avatarHtml(a)} ${escapeHtml(a.login)}</div>`).join('')
    : none('No one');
  const labels = s.labels.length > 0 ? eventLabelChips(s.labels) : none('None yet');
  const type = s.type ? escapeHtml(s.type.name) : none('No type');
  const milestone = s.milestone ? `<div>${octicon('milestone')} ${escapeHtml(s.milestone.title)}</div>` : none('No milestone');
  const parent = s.parent ? `<div>${octicon('issue-tracks')} #${s.parent.number} ${escapeHtml(s.parent.title)}</div>` : none('None yet');
  return sidebarSection('assignees', 'Assignees', true, assignees)
    + sidebarSection('labels', 'Labels', true, labels)
    + (meta && meta.types.length > 0 ? sidebarSection('type', 'Type', true, type) : '')
    + sidebarSection('milestone', 'Milestone', true, milestone)
    + sidebarSection('parent', 'Parent', true, parent);
}
