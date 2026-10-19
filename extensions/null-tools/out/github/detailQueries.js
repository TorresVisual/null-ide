'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMOVE_SUB_ISSUE = exports.ADD_SUB_ISSUE = exports.SET_ISSUE_TYPE = exports.REMOVE_REACTION = exports.ADD_REACTION = exports.DELETE_COMMENT = exports.UPDATE_COMMENT = exports.ADD_COMMENT = exports.ISSUE_TIMELINE = exports.ISSUE_DETAIL = exports.COMMENT_FIELDS = void 0;
exports.mapReactions = mapReactions;
exports.mapComment = mapComment;
exports.collapseTimeline = collapseTimeline;
exports.mapTimelinePage = mapTimelinePage;
exports.mapIssueDetail = mapIssueDetail;
const githubQueries_1 = require("./githubQueries");
const REACTIONS = 'reactionGroups { content viewerHasReacted reactors { totalCount } }';
/** Fields of one comment; shared by the timeline and the add/edit comment mutations so one mapper covers all three. */
exports.COMMENT_FIELDS = `
  id url body bodyHTML createdAt lastEditedAt authorAssociation isMinimized minimizedReason
  viewerCanUpdate viewerCanDelete
  author { login avatarUrl }
  ${REACTIONS}`;
const ISSUE_OR_PR = '__typename ... on Issue { number title url repository { nameWithOwner } } ... on PullRequest { number title url repository { nameWithOwner } }';
const PR_FIELDS = 'number title state url isDraft author { login } repository { nameWithOwner }';
const TIMELINE_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on IssueComment { ${exports.COMMENT_FIELDS} }
    ... on LabeledEvent { createdAt actor { login } label { name color } }
    ... on UnlabeledEvent { createdAt actor { login } label { name color } }
    ... on ClosedEvent {
      createdAt actor { login } stateReason
      closer { __typename ... on Commit { abbreviatedOid url } ... on PullRequest { number url } }
    }
    ... on ReopenedEvent { createdAt actor { login } }
    ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
    ... on AssignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
    ... on UnassignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
    ... on MilestonedEvent { createdAt actor { login } milestoneTitle }
    ... on DemilestonedEvent { createdAt actor { login } milestoneTitle }
    ... on CrossReferencedEvent { createdAt actor { login } source { ${ISSUE_OR_PR} } }
    ... on ConnectedEvent { createdAt actor { login } subject { ${ISSUE_OR_PR} } }
    ... on ReferencedEvent { createdAt actor { login } commit { abbreviatedOid url } }
    ... on SubIssueAddedEvent { createdAt actor { login } subIssue { number title url repository { nameWithOwner } } }
    ... on SubIssueRemovedEvent { createdAt actor { login } subIssue { number title url repository { nameWithOwner } } }
  }`;
/** One issue with everything the detail tab shows, plus the first 100 timeline items. */
exports.ISSUE_DETAIL = `
query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id number title body bodyHTML state stateReason url createdAt updatedAt closedAt lastEditedAt authorAssociation
      viewerCanUpdate
      author { login avatarUrl }
      labels(first: 100) { nodes { name color } }
      assignees(first: 20) { nodes { login avatarUrl } }
      comments { totalCount }
      milestone { number title progressPercentage }
      issueType { id name }
      subIssuesSummary { total completed }
      subIssues(first: 50) {
        nodes { id number title state stateReason url assignees(first: 3) { nodes { login avatarUrl } } }
      }
      parent { number title url }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
        totalCount
        nodes { ${PR_FIELDS} }
      }
      prMentions: timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { ${PR_FIELDS} } } } }
      }
      participants(first: 10) { nodes { login avatarUrl } }
      ${REACTIONS}
      timelineItems(first: 100) { ${TIMELINE_FIELDS} }
    }
  }
}`;
/** The next page of one issue's timeline. */
exports.ISSUE_TIMELINE = `
query IssueTimeline($owner: String!, $name: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { timelineItems(first: 100, after: $after) { ${TIMELINE_FIELDS} } }
  }
}`;
exports.ADD_COMMENT = `
mutation AddComment($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { ${exports.COMMENT_FIELDS} } } }
}`;
exports.UPDATE_COMMENT = `
mutation UpdateComment($id: ID!, $body: String!) {
  updateIssueComment(input: { id: $id, body: $body }) { issueComment { ${exports.COMMENT_FIELDS} } }
}`;
exports.DELETE_COMMENT = `
mutation DeleteComment($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }`;
exports.ADD_REACTION = `
mutation AddReaction($id: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $id, content: $content }) { subject { ${REACTIONS} } }
}`;
exports.REMOVE_REACTION = `
mutation RemoveReaction($id: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $id, content: $content }) { subject { ${REACTIONS} } }
}`;
/** `typeId: null` clears the issue's type. */
exports.SET_ISSUE_TYPE = `
mutation SetIssueType($id: ID!, $typeId: ID) {
  updateIssueIssueType(input: { issueId: $id, issueTypeId: $typeId }) { clientMutationId }
}`;
exports.ADD_SUB_ISSUE = `
mutation AddSubIssue($id: ID!, $url: String!) {
  addSubIssue(input: { issueId: $id, subIssueUrl: $url }) { clientMutationId }
}`;
exports.REMOVE_SUB_ISSUE = `
mutation RemoveSubIssue($id: ID!, $subId: ID!) {
  removeSubIssue(input: { issueId: $id, subIssueId: $subId }) { clientMutationId }
}`;
function mapReactions(groups) {
    return groups.map(g => ({ content: g.content, count: g.reactors.totalCount, viewerHasReacted: g.viewerHasReacted }));
}
/** A comment from the timeline or from the add/edit comment mutations. */
function mapComment(n) {
    return {
        id: n.id, url: n.url, author: n.author ? (0, githubQueries_1.toUser)(n.author) : githubQueries_1.GHOST, authorAssociation: n.authorAssociation,
        createdAt: n.createdAt, lastEditedAt: n.lastEditedAt, bodyHTML: n.bodyHTML, body: n.body,
        reactions: mapReactions(n.reactionGroups), viewerCanUpdate: n.viewerCanUpdate, viewerCanDelete: n.viewerCanDelete,
        minimizedReason: n.isMinimized ? (n.minimizedReason ?? 'hidden').toLowerCase() : null,
    };
}
/** `#12` inside this repo, `owner/other#12` elsewhere. */
function refText(ref, repo) {
    const name = ref.repository?.nameWithOwner;
    return `${name && name.toLowerCase() !== repo.toLowerCase() ? name : ''}#${ref.number}`;
}
function mapNode(n, repo) {
    const at = n.createdAt ?? '';
    const actor = n.actor?.login ?? 'ghost';
    const event = (body) => ({ kind: 'event', at, actor, ...body });
    const ref = (r, type) => r && typeof r.number === 'number' ? event({ type, text: `${r.title ?? ''} ${refText(r, repo)}`.trim(), url: r.url }) : null;
    switch (n.__typename) {
        case 'IssueComment': return { kind: 'comment', ...mapComment(n) };
        case 'LabeledEvent': return n.label ? event({ type: 'labels', added: [n.label], removed: [] }) : null;
        case 'UnlabeledEvent': return n.label ? event({ type: 'labels', added: [], removed: [n.label] }) : null;
        case 'ClosedEvent': {
            const reason = n.stateReason ? n.stateReason.toLowerCase() : null;
            const closer = n.closer ? { text: n.closer.abbreviatedOid ?? `#${n.closer.number}`, url: n.closer.url } : null;
            return event({ type: 'closed', reason, closer });
        }
        case 'ReopenedEvent': return event({ type: 'reopened' });
        case 'RenamedTitleEvent': return event({ type: 'renamed', from: n.previousTitle ?? '', to: n.currentTitle ?? '' });
        case 'AssignedEvent':
        case 'UnassignedEvent':
            return n.assignee?.login
                ? event({ type: n.__typename === 'AssignedEvent' ? 'assigned' : 'unassigned', login: n.assignee.login }) : null;
        case 'MilestonedEvent': return event({ type: 'milestoned', title: n.milestoneTitle ?? '' });
        case 'DemilestonedEvent': return event({ type: 'demilestoned', title: n.milestoneTitle ?? '' });
        case 'CrossReferencedEvent': return ref(n.source, 'cross-referenced');
        case 'ConnectedEvent': return ref(n.subject, 'connected');
        case 'ReferencedEvent':
            return n.commit ? event({ type: 'referenced', text: n.commit.abbreviatedOid, url: n.commit.url }) : null;
        case 'SubIssueAddedEvent': return ref(n.subIssue, 'sub-issue-added');
        case 'SubIssueRemovedEvent': return ref(n.subIssue, 'sub-issue-removed');
        default: return null; // an event type the tab doesn't show
    }
}
/** Merges consecutive label events by the same person within a minute into one "added a and b" line. */
function collapseTimeline(items) {
    const out = [];
    for (const item of items) {
        const prev = out[out.length - 1];
        if (item.kind === 'event' && item.type === 'labels' && prev?.kind === 'event' && prev.type === 'labels'
            && prev.actor === item.actor && Date.parse(item.at) - Date.parse(prev.at) <= 60_000) {
            out[out.length - 1] = { ...prev, at: item.at, added: [...prev.added, ...item.added], removed: [...prev.removed, ...item.removed] };
        }
        else {
            out.push(item);
        }
    }
    return out;
}
function mapTimelinePage(timeline, repo) {
    const items = timeline.nodes.map(n => mapNode(n, repo)).filter((i) => i !== null);
    return { items: collapseTimeline(items), hasMore: timeline.pageInfo.hasNextPage, cursor: timeline.pageInfo.endCursor };
}
const mapSubIssue = (s) => ({
    id: s.id, number: s.number, title: s.title, state: s.state === 'OPEN' ? 'open' : 'closed',
    stateReason: s.stateReason ? s.stateReason.toLowerCase() : null, url: s.url, assignees: s.assignees.nodes.map(githubQueries_1.toUser),
});
const mapLinkedPr = (p, repo) => ({
    number: p.number, title: p.title, state: p.state.toLowerCase(), isDraft: p.isDraft, url: p.url,
    author: p.author?.login ?? 'ghost', ref: refText(p, repo),
});
/** PRs that will close the issue first, then PRs that merely mention it, each PR once. */
function mapLinkedPrs(n, repo) {
    const mentions = (n.prMentions?.nodes ?? []).map(m => m.source).filter((s) => typeof s?.number === 'number');
    const seen = new Set();
    return [...(n.closedByPullRequestsReferences?.nodes ?? []), ...mentions]
        .filter(p => !seen.has(p.url) && seen.add(p.url))
        .map(p => mapLinkedPr(p, repo));
}
/** `repo` is `owner/name`; it decides whether a referenced issue is shown as `#12` or `owner/other#12`. */
function mapIssueDetail(data, repo) {
    const n = data.repository.issue;
    if (!n)
        throw new Error('Issue not found.');
    const timeline = mapTimelinePage(n.timelineItems, repo);
    return {
        id: n.id,
        issue: (0, githubQueries_1.mapIssue)(n),
        post: {
            id: n.id, url: n.url, author: n.author ? (0, githubQueries_1.toUser)(n.author) : githubQueries_1.GHOST, authorAssociation: n.authorAssociation,
            createdAt: n.createdAt, lastEditedAt: n.lastEditedAt, bodyHTML: n.bodyHTML, body: n.body ?? '',
            reactions: mapReactions(n.reactionGroups), viewerCanUpdate: n.viewerCanUpdate, viewerCanDelete: false,
            minimizedReason: null,
        },
        issueType: n.issueType,
        milestone: n.milestone
            ? { number: n.milestone.number, title: n.milestone.title, percent: Math.round(n.milestone.progressPercentage) } : null,
        parent: n.parent,
        subIssues: n.subIssues.nodes.map(mapSubIssue),
        linkedPrs: mapLinkedPrs(n, repo),
        participants: n.participants.nodes.map(githubQueries_1.toUser),
        timeline: timeline.items,
        hasMoreTimeline: timeline.hasMore,
        timelineCursor: timeline.cursor,
    };
}
//# sourceMappingURL=detailQueries.js.map