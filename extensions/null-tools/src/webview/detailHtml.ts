'use strict';

// Pure HTML builders for the issue detail tab. They take data and return strings (no DOM, no state), so
// webviewShared tests can run them in a sandbox. Every user-controlled string goes through escapeHtml;
// `post.bodyHTML` is the exception: GitHub renders it, and the caller sanitizes it before calling postHtml.

const REACTION_EMOJI: Record<string, string> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};
const REACTION_NAMES: Record<string, string> = {
  THUMBS_UP: 'Thumbs up', THUMBS_DOWN: 'Thumbs down', LAUGH: 'Laugh', HOORAY: 'Hooray', CONFUSED: 'Confused',
  HEART: 'Heart', ROCKET: 'Rocket', EYES: 'Eyes',
};
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor',
};

function avatarHtml(user: GithubUser, large = false): string {
  const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
  return `<span class="avatar${large ? ' avatar-lg' : ''}" data-initials="${initials}">`
    + `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
}

/** GitHub's author-association badge. Only the four roles github.com shows; everyone else gets none. */
function roleBadgeHtml(association: string | null): string {
  const label = association ? ROLE_LABELS[association] : undefined;
  return label ? `<span class="role-badge">${label}</span>` : '';
}

/**
 * GitHub's image URLs need a token the webview doesn't have, and its CSP only allows avatars, so an <img> in
 * rendered markdown would be a broken icon. Emoji become their text; any other image becomes a labelled
 * placeholder that opens the image externally. imageResolve.ts swaps each placeholder for a real thumbnail once
 * the host has downloaded the file; `data-src` is the original URL, `data-alt` the (escaped) alt text.
 */
function neutralizeImagesHtml(html: string): string {
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const attr = (name: string): string => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '';
    // Attribute values may hold a raw < or > (only quotes are escaped inside them); this text lands in markup.
    const alt = attr('alt').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/\bclass="[^"]*\bemoji\b/i.test(tag)) return alt;
    return `<span class="img-placeholder" data-src="${attr('src')}" data-alt="${alt}" title="Open image on github.com">${octicon('image')} ${alt || 'image'}</span>`;
  });
}

/** The issue number if `href` is an issue of `repo` (`owner/name`); null for anything else, including other repos. */
function issueNumberFromLink(href: string, repo: string): number | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i.exec(href);
  return m && `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase() ? Number(m[3]) : null;
}

/** Reaction chips under a post; nothing when no one has reacted. */
function reactionsHtml(post: IssuePost): string {
  const chips = post.reactions.filter(r => r.count > 0).map(r => `
    <button type="button" class="reaction-chip${r.viewerHasReacted ? ' active' : ''}" data-act="react" data-id="${escapeHtml(post.id)}"
      data-content="${escapeHtml(r.content)}" title="${REACTION_NAMES[r.content] ?? ''}">${REACTION_EMOJI[r.content] ?? ''} ${r.count}</button>`);
  return chips.length > 0 ? `<div class="reactions">${chips.join('')}</div>` : '';
}

/** The eight reactions GitHub offers, as picker items (the viewer's own are checked). */
function reactionPickerItems(post: IssuePost): PickerItem[] {
  return Object.keys(REACTION_EMOJI).map(content => ({
    value: content,
    label: `${REACTION_EMOJI[content]} ${REACTION_NAMES[content]}`,
    selected: post.reactions.some(r => r.content === content && r.viewerHasReacted),
  }));
}

/**
 * One post: the issue body (`kind: 'body'`) or a comment. A moderator-collapsed comment is folded in a
 * <details>. `editing` swaps the rendered body for an empty slot that issueDetail.ts fills with a composer.
 */
function postHtml(post: IssuePost, kind: 'body' | 'comment', editing: boolean): string {
  const id = escapeHtml(post.id);
  const edited = post.lastEditedAt
    ? ` <span class="post-edited" title="${escapeHtml(new Date(post.lastEditedAt).toLocaleString())}">· edited</span>` : '';
  const content = editing
    ? `<div class="post-edit">
         <div class="composer-slot" data-id="${id}"></div>
         <div class="btn-row">
           <button type="button" class="btn btn-primary" data-act="save-edit" data-id="${id}">Update ${kind === 'body' ? 'description' : 'comment'}</button>
           <button type="button" class="btn btn-secondary" data-act="cancel-edit">Cancel</button>
         </div>
       </div>`
    : `<div class="post-body">${post.bodyHTML || '<span class="muted">No description provided.</span>'}</div>${reactionsHtml(post)}`;
  const html = `
    <div class="post" data-id="${id}" data-kind="${kind}">
      <div class="post-avatar">${avatarHtml(post.author, true)}</div>
      <div class="post-card">
        <div class="post-header">
          <b class="post-author">${escapeHtml(post.author.login)}</b>${roleBadgeHtml(post.authorAssociation)}
          <span class="post-when">${kind === 'body' ? 'opened this' : 'commented'} ${timeHtml(post.createdAt)}</span>${edited}
          <span class="post-actions">
            <button type="button" class="icon-btn" data-act="react-picker" data-id="${id}" title="Add reaction" aria-label="Add reaction">${octicon('smiley')}</button>
            <button type="button" class="icon-btn" data-act="post-menu" data-id="${id}" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
          </span>
        </div>
        ${content}
      </div>
    </div>`;
  return kind === 'comment' && post.minimizedReason
    ? `<details class="post-minimized"><summary>This comment was marked as ${escapeHtml(post.minimizedReason.replace(/_/g, ' '))}. Show</summary>${html}</details>`
    : html;
}

function eventLabelChips(labels: GithubLabel[]): string {
  return labels.map(l => `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`).join('');
}

function eventLink(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

const CLOSED_REASON_TEXT: Record<string, string> = { completed: ' as completed', not_planned: ' as not planned', duplicate: ' as a duplicate' };

/** The rail icon, its color class and the sentence for one event (without the leading actor and trailing time). */
function eventParts(ev: TimelineEvent): { icon: string; tone: string; text: string } {
  switch (ev.type) {
    case 'labels': {
      const noun = (n: number): string => (n === 1 ? 'label' : 'labels');
      const parts = [];
      if (ev.added.length > 0) parts.push(`added ${eventLabelChips(ev.added)} ${noun(ev.added.length)}`);
      if (ev.removed.length > 0) parts.push(`removed ${eventLabelChips(ev.removed)} ${noun(ev.removed.length)}`);
      return { icon: 'tag', tone: '', text: parts.join(' and ') };
    }
    case 'closed': {
      const unplanned = ev.reason === 'not_planned' || ev.reason === 'duplicate';
      const closer = ev.closer ? ` in ${eventLink(ev.closer.text, ev.closer.url)}` : '';
      return {
        icon: unplanned ? 'skip' : 'issue-closed', tone: unplanned ? 'state-not-planned' : 'state-completed',
        text: `closed this${CLOSED_REASON_TEXT[ev.reason ?? ''] ?? ''}${closer}`,
      };
    }
    case 'reopened': return { icon: 'issue-reopened', tone: 'state-open', text: 'reopened this' };
    case 'renamed':
      return { icon: 'pencil', tone: '', text: `changed the title <s>${escapeHtml(ev.from)}</s> ${escapeHtml(ev.to)}` };
    case 'assigned':
      return { icon: 'person', tone: '', text: ev.login === ev.actor ? 'self-assigned this' : `assigned <b>${escapeHtml(ev.login)}</b>` };
    case 'unassigned':
      return { icon: 'person', tone: '', text: ev.login === ev.actor ? 'removed their assignment' : `unassigned <b>${escapeHtml(ev.login)}</b>` };
    case 'milestoned': return { icon: 'milestone', tone: '', text: `added this to the <b>${escapeHtml(ev.title)}</b> milestone` };
    case 'demilestoned': return { icon: 'milestone', tone: '', text: `removed this from the <b>${escapeHtml(ev.title)}</b> milestone` };
    case 'cross-referenced': return { icon: 'cross-reference', tone: '', text: `mentioned this in ${eventLink(ev.text, ev.url)}` };
    case 'connected': return { icon: 'link', tone: '', text: `linked ${eventLink(ev.text, ev.url)}` };
    case 'referenced': return { icon: 'git-commit', tone: '', text: `referenced this in commit ${eventLink(ev.text, ev.url)}` };
    case 'sub-issue-added': return { icon: 'issue-tracks', tone: '', text: `added sub-issue ${eventLink(ev.text, ev.url)}` };
    case 'sub-issue-removed': return { icon: 'issue-tracks', tone: '', text: `removed sub-issue ${eventLink(ev.text, ev.url)}` };
  }
}

/** One event on the timeline rail: icon badge, "actor did something", relative time. */
function eventHtml(ev: TimelineEvent): string {
  const { icon, tone, text } = eventParts(ev);
  return `<div class="tl-event"><span class="tl-badge ${tone}">${octicon(icon)}</span>`
    + `<div class="tl-text"><b class="tl-actor">${escapeHtml(ev.actor)}</b> ${text} ${timeHtml(ev.at)}</div></div>`;
}
