'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIDGET_QUERY = void 0;
exports.searchStrings = searchStrings;
exports.chunkRepos = chunkRepos;
exports.mapIssues = mapIssues;
exports.mapPrs = mapPrs;
exports.rankIssues = rankIssues;
exports.rankPrs = rankPrs;
const pullModel_1 = require("../pulls/pullModel");
exports.WIDGET_QUERY = `
query WidgetItems($assigned: String!, $mentioned: String!, $authored: String!, $reviewReq: String!, $n: Int!) {
  assigned: search(query: $assigned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  mentioned: search(query: $mentioned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  authored: search(query: $authored, type: ISSUE, first: $n) { nodes { ...PrFields } }
  reviewReq: search(query: $reviewReq, type: ISSUE, first: $n) { nodes { ...PrFields } }
}
fragment IssueFields on Issue {
  number title url updatedAt repository { nameWithOwner }
  labels(first: 5) { nodes { name } } assignees(first: 1) { nodes { login } }
}
fragment PrFields on PullRequest {
  number title url updatedAt isDraft mergeable reviewDecision repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;
function searchStrings(repos) {
    const scope = repos.map(r => `repo:${r}`).join(' ');
    const q = (rest) => `${scope} ${rest} sort:updated-desc`;
    return {
        assigned: q('is:issue is:open assignee:@me'),
        mentioned: q('is:issue is:open mentions:@me'),
        authored: q('is:pr is:open author:@me'),
        reviewReq: q('is:pr is:open review-requested:@me'),
    };
}
/** GitHub rejects search queries over 256 characters; the longest suffix above is under 50, so the `repo:` scope gets 150. */
function chunkRepos(repos, maxScopeChars = 150) {
    const chunks = [];
    let cur = [], len = 0;
    for (const r of repos) {
        const add = r.length + 6; // "repo:" + space
        if (cur.length && len + add > maxScopeChars) {
            chunks.push(cur);
            cur = [];
            len = 0;
        }
        cur.push(r);
        len += add;
    }
    if (cur.length) {
        chunks.push(cur);
    }
    return chunks;
}
const isNode = (n) => typeof n.number === 'number';
const CHECKS = { success: 'passing', failure: 'failing', pending: 'pending', none: 'none' };
function mapIssues(data, local) {
    const out = new Map();
    const add = (nodes, attention) => {
        for (const raw of nodes) {
            if (!isNode(raw)) {
                continue;
            }
            const n = raw;
            const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
            if (out.has(key)) {
                continue;
            }
            out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, state: 'open',
                labels: n.labels.nodes.map(l => l.name), assignee: n.assignees.nodes[0]?.login ?? null, attention,
                localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
        }
    };
    add(data.assigned.nodes, 'assigned');
    add(data.mentioned.nodes, 'mentioned');
    return [...out.values()];
}
function mapPrs(data, local) {
    const requested = new Set();
    for (const raw of data.reviewReq.nodes) {
        if (!isNode(raw)) {
            continue;
        }
        const n = raw;
        if (!n.isDraft) {
            requested.add(`${n.repository.nameWithOwner.toLowerCase()}#${n.number}`);
        } // others' drafts are not asked of anyone yet
    }
    const out = new Map();
    const add = (nodes, ownSet) => {
        for (const raw of nodes) {
            if (!isNode(raw)) {
                continue;
            }
            const n = raw;
            const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
            if (out.has(key) || (!ownSet && n.isDraft)) {
                continue;
            }
            const decision = pullModel_1.REVIEWS[n.reviewDecision ?? ''] ?? 'none';
            out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, author: n.author?.login ?? 'ghost',
                review: requested.has(key) ? 'requested' : decision === 'required' ? 'none' : decision,
                checks: CHECKS[(0, pullModel_1.checkStateOf)(n.commits.nodes[0]?.commit.statusCheckRollup?.state)], conflict: n.mergeable === 'CONFLICTING',
                localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
        }
    };
    add(data.authored.nodes, true);
    add(data.reviewReq.nodes, false);
    return [...out.values()];
}
const newest = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
function rankIssues(rows) {
    const w = (r) => (r.attention === 'assigned' ? 0 : 1);
    return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}
function rankPrs(rows) {
    const w = (r) => r.review === 'requested' ? 0 : r.review === 'changes' ? 1 : r.checks === 'failing' ? 2 : r.conflict ? 3 : 4;
    return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}
//# sourceMappingURL=widgetQueries.js.map