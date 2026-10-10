'use strict';

/** "7 commits · 12 files +512 −120", with the line counts coloured. */
function renderGitLine(t: GitTotals): HTMLElement {
  const f = formatGit(t);
  return h('span', { class: 'git' }, `${f.text} `, h('span', { class: 'add' }, f.added), ' ', h('span', { class: 'del' }, f.removed));
}

/** Under a project name: its git numbers, "—" when it has none, nothing when it has no commits in the range. */
function projectGitCell(share: Share, git: DashboardGit): HTMLElement | null {
  if (share.key === undefined) return null;
  if (!Object.prototype.hasOwnProperty.call(git.byProject, share.key)) {
    return h('span', { class: 'git', title: 'No git data for this project (not open, or git unavailable)' }, '—');
  }
  const totals = git.byProject[share.key];
  return totals.commits > 0 ? renderGitLine(totals) : null;
}

/** One card: a ranked list of name, proportional bar (relative to the largest row), duration and percent. `git` adds a line under project names. */
function renderBreakdown(title: string, shares: Share[], git?: DashboardGit): HTMLElement {
  const widths = barScale(shares.map((share) => share.ms), 100, 0);
  const rows = shares.map((share, i) => {
    const fillBar = h('div', { class: 'fill' });
    fillBar.style.setProperty('width', `${widths[i]}%`);
    const name = h('span', { class: 'name', title: share.name }, share.name);
    const gitCell = git ? projectGitCell(share, git) : null;
    return h(
      'li',
      { class: 'row' },
      gitCell ? h('div', { class: 'namecell' }, name, gitCell) : name,
      h('div', { class: 'track' }, fillBar),
      h('span', { class: 'dur' }, formatDuration(share.ms)),
      h('span', { class: 'pct' }, formatPercent(share.percent, share.ms)),
    );
  });
  return h('section', { class: 'card' }, h('h2', null, title), h('ul', { class: 'rows' }, ...rows));
}
