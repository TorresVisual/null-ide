'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PULL_PAGE = void 0;
exports.mapTimeline = mapTimeline;
exports.mapReviewers = mapReviewers;
exports.checkRowState = checkRowState;
exports.statusContextState = statusContextState;
exports.mapChecks = mapChecks;
exports.failedRunIds = failedRunIds;
exports.mapPullPage = mapPullPage;
exports.safeExternalUrl = safeExternalUrl;
const pullActionsModel_1 = require("./pullActionsModel");
const pullModel_1 = require("./pullModel");
// ponytail: first 100 commits, 100 conversation items, 100 checks (the page says when it is cut off); add paging
// ("load more") if that turns out to be missed.
exports.PULL_PAGE = `
query PullPage($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id headRefOid mergeable mergeStateStatus viewerCanUpdate viewerDidAuthor
      pendingReview: reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
      number title url state isDraft createdAt bodyHTML headRefName baseRefName isCrossRepository additions deletions changedFiles
      author { login avatarUrl }
      labels(first: 50) { nodes { name color } }
      milestone { title }
      assignees(first: 20) { nodes { login avatarUrl } }
      reviewRequests(first: 20) { nodes { requestedReviewer {
        __typename
        ... on User { login avatarUrl }
        ... on Mannequin { login avatarUrl }
      } } }
      latestOpinionatedReviews(first: 30) { nodes { state author { login avatarUrl } } }
      commits(first: 100) { totalCount nodes { commit {
        oid abbreviatedOid messageHeadline committedDate url author { name user { login } }
      } } }
      timelineItems(first: 100, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, CLOSED_EVENT, MERGED_EVENT, REOPENED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
        totalCount
        nodes {
          __typename
          ... on IssueComment { url createdAt bodyHTML author { login avatarUrl } }
          ... on PullRequestReview { url state createdAt bodyHTML author { login avatarUrl } comments { totalCount } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on ConvertToDraftEvent { createdAt actor { login } }
        }
      }
      lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) {
        totalCount
        nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
          ... on StatusContext { context state targetUrl description }
        }
      } } } } }
    }
  }
}`;
const ghost = (u) => ({ login: u?.login ?? 'ghost', avatar: u?.avatarUrl ?? '' });
const user = (u) => ({ login: u.login, avatar: u.avatarUrl });
// Maps, not records: a type name from the wire must never hit an Object.prototype key.
const VERDICTS = new Map([
    ['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes'], ['COMMENTED', 'commented'], ['DISMISSED', 'dismissed'],
]);
const EVENTS = new Map([
    ['ClosedEvent', 'closed'], ['MergedEvent', 'merged'], ['ReopenedEvent', 'reopened'],
    ['ReadyForReviewEvent', 'ready'], ['ConvertToDraftEvent', 'draft'],
]);
/** Comments, submitted reviews and state events, oldest first. An unsent (PENDING) review and unknown types are skipped. */
function mapTimeline(nodes) {
    const items = [];
    for (const n of nodes) {
        if (!n)
            continue;
        const at = n.createdAt ?? '';
        const event = EVENTS.get(n.__typename);
        if (n.__typename === 'IssueComment') {
            items.push({ kind: 'comment', author: ghost(n.author), at, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '' });
        }
        else if (n.__typename === 'PullRequestReview') {
            const verdict = VERDICTS.get(n.state ?? '');
            if (verdict) {
                items.push({ kind: 'review', author: ghost(n.author), at, verdict, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '', comments: n.comments?.totalCount ?? 0 });
            }
        }
        else if (event) {
            items.push({ kind: 'event', at, actor: n.actor?.login ?? 'ghost', event });
        }
    }
    return items;
}
/** Latest verdict per reviewer; someone asked (again) to review shows as pending, which wins over an older verdict. */
function mapReviewers(p) {
    const rows = new Map();
    for (const r of p.latestOpinionatedReviews.nodes) {
        const verdict = r ? VERDICTS.get(r.state) : undefined;
        if (r?.author && verdict)
            rows.set(r.author.login, { login: r.author.login, avatar: r.author.avatarUrl, state: verdict });
    }
    for (const req of p.reviewRequests.nodes) {
        const who = req?.requestedReviewer;
        const login = who?.login; // a Team has no readable field without read:org (name and slug both fail the query), so team requests are skipped
        if (login)
            rows.set(login, { login, avatar: who?.avatarUrl ?? '', state: 'pending' });
    }
    return [...rows.values()];
}
function checkRowState(status, conclusion) {
    if (status !== 'COMPLETED')
        return 'pending';
    switch (conclusion) {
        case 'SUCCESS': return 'success';
        case 'FAILURE':
        case 'TIMED_OUT':
        case 'STARTUP_FAILURE': return 'failure';
        case 'ACTION_REQUIRED': return 'pending'; // needs someone, and a re-run would not help
        default: return 'neutral'; // NEUTRAL, SKIPPED, CANCELLED, STALE
    }
}
function statusContextState(state) {
    if (state === 'SUCCESS')
        return 'success';
    if (state === 'FAILURE' || state === 'ERROR')
        return 'failure';
    if (state === 'PENDING' || state === 'EXPECTED')
        return 'pending';
    return 'neutral';
}
const RANK = { failure: 0, pending: 1, success: 2, neutral: 3 };
/** Check runs and legacy commit statuses as one list: what needs attention first, then by name. */
function mapChecks(nodes) {
    const rows = [];
    for (const n of nodes) {
        if (!n)
            continue;
        if (n.__typename === 'CheckRun') {
            rows.push({
                name: n.name ?? 'check', state: checkRowState(n.status ?? '', n.conclusion ?? null), url: n.detailsUrl ?? null,
                runId: n.checkSuite?.workflowRun?.databaseId ?? null, description: '',
            });
        }
        else if (n.__typename === 'StatusContext') {
            rows.push({ name: n.context ?? 'status', state: statusContextState(n.state ?? ''), url: n.targetUrl ?? null, runId: null, description: n.description ?? '' });
        }
    }
    return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
}
/** The workflow runs worth re-running: the distinct runs of failed checks. */
function failedRunIds(checks) {
    const ids = new Set();
    for (const c of checks) {
        if (c.state === 'failure' && c.runId !== null && Number.isSafeInteger(c.runId) && c.runId > 0)
            ids.add(c.runId);
    }
    return [...ids];
}
function mapPullPage(data) {
    const repo = data.repository;
    const p = repo?.pullRequest;
    if (!repo || !p)
        throw new Error('Pull request not found.');
    const rollup = p.lastCommit.nodes[0]?.commit.statusCheckRollup ?? null;
    const unsent = p.pendingReview.nodes[0];
    return {
        number: p.number, id: p.id, headSha: p.headRefOid,
        title: p.title, url: p.url, state: (0, pullModel_1.pullStateOf)(p.state), draft: p.isDraft,
        author: ghost(p.author), createdAt: p.createdAt, bodyHTML: p.bodyHTML,
        headRef: p.headRefName, baseRef: p.baseRefName, fork: p.isCrossRepository,
        additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
        labels: p.labels.nodes.map(l => ({ name: l.name, color: l.color })),
        milestone: p.milestone?.title ?? null,
        assignees: p.assignees.nodes.map(user),
        reviewers: mapReviewers(p),
        commits: p.commits.nodes.map(({ commit: c }) => ({
            sha: c.oid, short: c.abbreviatedOid, headline: c.messageHeadline,
            author: c.author?.user?.login ?? c.author?.name ?? 'unknown', at: c.committedDate, url: c.url,
        })),
        commitTotal: p.commits.totalCount,
        timeline: mapTimeline(p.timelineItems.nodes),
        timelineTotal: p.timelineItems.totalCount,
        checkState: (0, pullModel_1.checkStateOf)(rollup?.state),
        checks: mapChecks(rollup?.contexts.nodes ?? []),
        checksTotal: rollup?.contexts.totalCount ?? 0,
        actions: (0, pullActionsModel_1.pageActions)({
            state: (0, pullModel_1.pullStateOf)(p.state), draft: p.isDraft, mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus,
            viewerCanUpdate: p.viewerCanUpdate, viewerDidAuthor: p.viewerDidAuthor, viewerPermission: repo.viewerPermission ?? '',
            mergeCommitAllowed: repo.mergeCommitAllowed, squashMergeAllowed: repo.squashMergeAllowed, rebaseMergeAllowed: repo.rebaseMergeAllowed,
            pendingComments: unsent ? unsent.comments.totalCount : null,
        }),
    };
}
/** The only links the host opens for the webview: absolute https. Everything else (javascript:, relative, http:) is dropped. */
function safeExternalUrl(raw) {
    if (typeof raw !== 'string')
        return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.href : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=pullDetailModel.js.map