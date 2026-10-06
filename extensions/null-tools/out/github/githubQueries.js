'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GHOST = exports.toUser = exports.REPO_METADATA = exports.ISSUE_COUNTS = exports.SEARCH_ISSUES = void 0;
exports.mapIssue = mapIssue;
exports.mapSearchPage = mapSearchPage;
exports.mapMetadata = mapMetadata;
const LIST_ISSUE_FIELDS = `
  number title body state stateReason url createdAt updatedAt closedAt
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl } }
  comments { totalCount }
  milestone { number title }
  issueType { name }
  subIssuesSummary { total completed }
  closedByPullRequestsReferences(first: 1) { totalCount }
`;
/** One page of the issue list plus (on the first page only) the Open/Closed tab counts. */
exports.SEARCH_ISSUES = `
query SearchIssues($q: String!, $qOpen: String!, $qClosed: String!, $first: Int!, $after: String, $withCounts: Boolean!) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on Issue { ${LIST_ISSUE_FIELDS} } }
  }
  open: search(query: $qOpen, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
  closed: search(query: $qClosed, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
}`;
/** Counts only (no nodes): the status bar's open total and how many of those are assigned to the viewer. */
exports.ISSUE_COUNTS = `
query IssueCounts($open: String!, $mine: String!) {
  open: search(query: $open, type: ISSUE, first: 0) { issueCount }
  mine: search(query: $mine, type: ISSUE, first: 0) { issueCount }
}`;
/** Everything the filter dropdowns offer. `issueTypes` is null on repos (e.g. user-owned) without issue types. */
exports.REPO_METADATA = `
query RepoMetadata($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color description } }
    assignableUsers(first: 100) { nodes { login avatarUrl } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { number title } }
    issueTypes(first: 25) { nodes { id name } }
  }
}`;
const toUser = (u) => ({ login: u.login, avatar_url: u.avatarUrl });
exports.toUser = toUser;
/** A deleted account has no author; GitHub shows "ghost", so do we. */
exports.GHOST = { login: 'ghost', avatar_url: '' };
function mapIssue(n) {
    const sub = n.subIssuesSummary;
    return {
        number: n.number,
        title: n.title,
        body: n.body ?? '',
        state: n.state === 'OPEN' ? 'open' : 'closed',
        state_reason: n.stateReason ? n.stateReason.toLowerCase() : null,
        html_url: n.url,
        labels: n.labels.nodes.map(l => ({ name: l.name, color: l.color })),
        assignees: n.assignees.nodes.map(exports.toUser),
        user: n.author ? (0, exports.toUser)(n.author) : exports.GHOST,
        comments: n.comments.totalCount,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        closed_at: n.closedAt,
        milestone: n.milestone,
        issue_type: n.issueType?.name ?? null,
        sub_issues: sub && sub.total > 0 ? { total: sub.total, completed: sub.completed } : null,
        linked_prs: n.closedByPullRequestsReferences?.totalCount ?? 0,
    };
}
function mapSearchPage(data) {
    return {
        items: data.search.nodes.filter((n) => typeof n.number === 'number').map(mapIssue),
        hasMore: data.search.pageInfo.hasNextPage,
        cursor: data.search.pageInfo.endCursor,
        openCount: data.open?.issueCount ?? null,
        closedCount: data.closed?.issueCount ?? null,
    };
}
function mapMetadata(data) {
    const repo = data.repository;
    return {
        labels: repo.labels.nodes,
        assignees: repo.assignableUsers.nodes.map(exports.toUser),
        milestones: repo.milestones.nodes,
        issueTypes: repo.issueTypes?.nodes ?? [],
        viewerLogin: data.viewer.login,
    };
}
//# sourceMappingURL=githubQueries.js.map