'use strict';

/** github.com's three issue states. Accepts REST (`closed`/`not_planned`) and GraphQL (`CLOSED`/`NOT_PLANNED`) casing. */
function issueStateKind(state: string, stateReason?: string | null): 'open' | 'completed' | 'not-planned' {
  if (state.toLowerCase() === 'open') return 'open';
  return stateReason?.toLowerCase() === 'not_planned' ? 'not-planned' : 'completed';
}

/** Colored state octicon (open / closed-completed / closed-not-planned), as in github.com's issue lists. */
function issueStateIcon(state: string, stateReason?: string | null): string {
  const kind = issueStateKind(state, stateReason);
  const icon = kind === 'open' ? 'issue-opened' : kind === 'completed' ? 'issue-closed' : 'skip';
  return octicon(icon, `state-icon state-${kind}`);
}

/** The "◉ Open" / "✓ Closed" pill from github.com's issue header. */
function issueStateBadge(state: string, stateReason?: string | null): string {
  const kind = issueStateKind(state, stateReason);
  return `<span class="state-badge state-${kind}">${issueStateIcon(state, stateReason)}${kind === 'open' ? 'Open' : 'Closed'}</span>`;
}
