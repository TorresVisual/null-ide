'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLL_SLOW_MS = exports.POLL_FAST_MS = exports.isDefaultFilter = exports.isWorkflowFile = exports.PAGE_SIZE = exports.DEFAULT_FILTER = exports.workflowContext = exports.stepContext = exports.jobContext = exports.runContext = exports.isFailed = exports.isActive = exports.mapWorkflow = exports.githubUrl = void 0;
exports.mapRun = mapRun;
exports.mapJob = mapJob;
exports.statusIcon = statusIcon;
exports.formatDuration = formatDuration;
exports.elapsed = elapsed;
exports.runDescription = runDescription;
exports.runActions = runActions;
exports.refusal = refusal;
exports.actionFailureText = actionFailureText;
exports.parseFilter = parseFilter;
exports.describeFilter = describeFilter;
exports.filterRows = filterRows;
exports.runsPath = runsPath;
exports.nodeId = nodeId;
exports.describeNode = describeNode;
exports.dedupeRepos = dedupeRepos;
exports.mergeRuns = mergeRuns;
exports.pollDelay = pollDelay;
exports.branchChoices = branchChoices;
exports.isPlausibleRef = isPlausibleRef;
exports.mapLimit = mapLimit;
const githubApi_1 = require("../github/githubApi");
const str = (v) => (typeof v === 'string' ? v : '');
const strOrNull = (v) => (typeof v === 'string' && v ? v : null);
/** Only github.com pages are ever opened from a payload; anything else becomes ''. */
const githubUrl = (v) => (typeof v === 'string' && v.startsWith('https://github.com/') ? v : '');
exports.githubUrl = githubUrl;
function mapRun(r) {
    return {
        id: r.id, workflowId: r.workflow_id, title: str(r.display_title) || str(r.name), status: str(r.status),
        conclusion: strOrNull(r.conclusion), branch: str(r.head_branch), sha: str(r.head_sha), event: str(r.event),
        number: r.run_number, attempt: typeof r.run_attempt === 'number' ? r.run_attempt : 1,
        startedAt: strOrNull(r.run_started_at) ?? strOrNull(r.created_at), updatedAt: str(r.updated_at),
        url: (0, exports.githubUrl)(r.html_url), actor: str(r.actor?.login),
    };
}
function mapJob(j) {
    const steps = (Array.isArray(j.steps) ? j.steps : []).filter((s) => typeof s === 'object' && s !== null).map((s) => ({
        number: s.number, name: str(s.name), status: str(s.status), conclusion: strOrNull(s.conclusion),
        startedAt: strOrNull(s.started_at), completedAt: strOrNull(s.completed_at),
    }));
    return {
        id: j.id, name: str(j.name), status: str(j.status), conclusion: strOrNull(j.conclusion),
        startedAt: strOrNull(j.started_at), completedAt: strOrNull(j.completed_at), url: (0, exports.githubUrl)(j.html_url), steps,
    };
}
const mapWorkflow = (w) => ({ id: w.id, name: str(w.name), path: str(w.path), state: str(w.state) });
exports.mapWorkflow = mapWorkflow;
// ── status ──────────────────────────────────────────────────────────────────
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const isActive = (s) => ACTIVE.has(s.status);
exports.isActive = isActive;
const isFailed = (s) => s.status === 'completed' && s.conclusion !== null && FAILED.has(s.conclusion);
exports.isFailed = isFailed;
/** The one icon function for run, job and step rows, so they always agree. */
function statusIcon(status, conclusion) {
    if (status === 'completed') {
        if (conclusion === 'success')
            return { icon: 'pass', color: 'charts.green' };
        if (conclusion !== null && FAILED.has(conclusion))
            return { icon: 'error', color: 'charts.red' };
        if (conclusion === 'cancelled')
            return { icon: 'circle-slash' };
        if (conclusion === 'action_required')
            return { icon: 'warning', color: 'charts.yellow' };
        return { icon: 'debug-step-over' }; // skipped, neutral, stale
    }
    if (status === 'in_progress')
        return { icon: 'sync~spin', color: 'charts.yellow' };
    if (ACTIVE.has(status))
        return { icon: 'clock' };
    return { icon: 'circle-outline' };
}
function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Time between two ISO timestamps (`end` null = still running, measured to `now`); '' when it cannot be told. */
function elapsed(start, end, now) {
    if (!start)
        return '';
    const from = Date.parse(start);
    const to = end ? Date.parse(end) : now;
    return Number.isNaN(from) || Number.isNaN(to) ? '' : formatDuration(to - from);
}
function runDescription(run, now) {
    const duration = elapsed(run.startedAt, (0, exports.isActive)(run) ? null : run.updatedAt, now);
    const parts = [run.branch, run.sha.slice(0, 7), run.event, duration, `#${run.number}`].filter(Boolean);
    if (run.attempt > 1)
        parts.push(`attempt ${run.attempt}`);
    return parts.join(' · ');
}
function runActions(run) {
    if ((0, exports.isActive)(run))
        return ['cancel'];
    if (run.status !== 'completed')
        return [];
    return (0, exports.isFailed)(run) ? ['rerunAll', 'rerunFailed'] : ['rerunAll'];
}
/** Why `action` cannot be done to `target` as it is *now* (the host re-reads it first), or null when it can. */
function refusal(action, target) {
    switch (action) {
        case 'cancel': return (0, exports.isActive)(target) ? null : 'It already finished.';
        case 'rerunAll':
        case 'rerunJob': return target.status === 'completed' ? null : 'It is still running.';
        case 'rerunFailed':
            if (target.status !== 'completed')
                return 'It is still running.';
            return (0, exports.isFailed)(target) ? null : 'It has no failed jobs.';
    }
}
const runContext = (run) => ['run', ...((0, exports.isFailed)(run) ? ['failed'] : []), ...runActions(run)].join(' ');
exports.runContext = runContext;
const jobContext = (job) => ['job', ...((0, exports.isFailed)(job) ? ['failed'] : []), ...(job.status === 'completed' ? ['rerunJob'] : [])].join(' ');
exports.jobContext = jobContext;
const stepContext = (step) => ((0, exports.isFailed)(step) ? 'step failed' : 'step');
exports.stepContext = stepContext;
const workflowContext = (w, dispatchable) => ['workflow', ...(w.state !== 'active' ? ['enable'] : dispatchable ? ['dispatch'] : [])].join(' ');
exports.workflowContext = workflowContext;
/** GitHub's own words, plus a hint for a plain 403 (rate limits carry `retryAt` and are not a permission problem). */
function actionFailureText(err) {
    if (err instanceof githubApi_1.ApiError) {
        if (err.status === 403 && err.retryAt === null)
            return `${err.message} — this needs write access to the repository and Actions enabled.`;
        return err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
exports.DEFAULT_FILTER = { branch: false, mine: false, failed: false, workflow: null };
exports.PAGE_SIZE = 30;
const isWorkflowFile = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}\.ya?ml$/.test(v);
exports.isWorkflowFile = isWorkflowFile;
function parseFilter(raw) {
    const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    return {
        branch: o.branch === true, mine: o.mine === true, failed: o.failed === true,
        workflow: (0, exports.isWorkflowFile)(o.workflow) ? o.workflow : null,
    };
}
const isDefaultFilter = (f) => !f.branch && !f.mine && !f.failed && f.workflow === null;
exports.isDefaultFilter = isDefaultFilter;
function describeFilter(f) {
    return [f.branch && 'Current branch', f.mine && 'My runs', f.failed && 'Failed only', f.workflow].filter(Boolean).join(' · ');
}
function filterRows(f) {
    const on = (v) => (v ? 'on' : 'off');
    return [
        { id: 'branch', label: 'Current branch', description: on(f.branch) },
        { id: 'mine', label: 'My runs', description: on(f.mine) },
        { id: 'failed', label: 'Failed only', description: on(f.failed) },
        { id: 'workflow', label: 'Workflow', description: f.workflow ?? 'any' },
    ];
}
/** REST path of one page of runs. A qualifier whose value is unknown (detached HEAD, no login) is dropped. */
function runsPath(owner, repo, f, ctx, page) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
    const head = f.workflow ? `${base}/workflows/${encodeURIComponent(f.workflow)}/runs` : `${base}/runs`;
    const q = [`per_page=${exports.PAGE_SIZE}`, `page=${page}`];
    if (f.branch && ctx.branch)
        q.push(`branch=${encodeURIComponent(ctx.branch)}`);
    if (f.mine && ctx.login)
        q.push(`actor=${encodeURIComponent(ctx.login)}`);
    if (f.failed)
        q.push('status=failure');
    return `${head}?${q.join('&')}`;
}
function nodeId(n) {
    const k = n.repo.key;
    switch (n.kind) {
        case 'repo': return `wf:${k}`;
        case 'signin': return `wf:${k}/signin`;
        case 'error': return `wf:${k}/error`;
        case 'note': return `wf:${k}/note/${n.id}`;
        case 'group': return `wf:${k}/${n.group}`;
        case 'run': return `wf:${k}/run/${n.run.id}`;
        case 'job': return `wf:${k}/run/${n.run.id}/job/${n.job.id}`;
        case 'step': return `wf:${k}/run/${n.run.id}/job/${n.job.id}/step/${n.step.number}`;
        case 'workflow': return `wf:${k}/workflow/${n.workflow.id}`;
        case 'more': return `wf:${k}/more`;
    }
}
/** View data for the rows that come straight from API payloads; the glue turns it into a TreeItem. */
function describeNode(n, ctx) {
    const id = nodeId(n);
    switch (n.kind) {
        case 'run': {
            const current = ctx.branch !== null && n.run.branch === ctx.branch;
            return {
                id, label: n.run.title, description: `${current ? '● ' : ''}${runDescription(n.run, ctx.now)}`,
                tooltip: `${n.run.title}\n#${n.run.number} by ${n.run.actor || 'unknown'}\n${n.run.conclusion ?? n.run.status}`,
                icon: statusIcon(n.run.status, n.run.conclusion), collapsible: 'collapsed', context: (0, exports.runContext)(n.run),
            };
        }
        case 'job':
            return {
                id, label: n.job.name, description: elapsed(n.job.startedAt, n.job.completedAt, ctx.now),
                icon: statusIcon(n.job.status, n.job.conclusion),
                collapsible: (0, exports.isFailed)(n.job) ? 'expanded' : 'collapsed', context: (0, exports.jobContext)(n.job),
            };
        case 'step':
            return {
                id, label: n.step.name, description: elapsed(n.step.startedAt, n.step.completedAt, ctx.now),
                icon: statusIcon(n.step.status, n.step.conclusion), collapsible: 'none', context: (0, exports.stepContext)(n.step),
            };
        case 'workflow': {
            const disabled = n.workflow.state !== 'active';
            return {
                id, label: n.workflow.name, description: disabled ? 'disabled' : n.workflow.path,
                tooltip: `${n.workflow.name}\n${n.workflow.path}${disabled ? `\n${n.workflow.state}` : ''}`,
                icon: { icon: 'file-code', color: disabled ? 'disabledForeground' : undefined }, collapsible: 'none',
                context: (0, exports.workflowContext)(n.workflow, n.dispatchable),
            };
        }
        default:
            throw new Error(`describeNode does not describe "${n.kind}" rows`);
    }
}
/** One repo per `owner/repo`, case-insensitively; the first folder wins. */
function dedupeRepos(items) {
    const seen = new Set();
    return items.filter(i => {
        const key = i.repo.key.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
/** A fresh first page over the runs already loaded: the page replaces its own rows, older pages stay. */
function mergeRuns(fresh, old) {
    const ids = new Set(fresh.map(r => r.id));
    return [...fresh, ...old.filter(r => !ids.has(r.id))];
}
// ── polling and small helpers ───────────────────────────────────────────────
exports.POLL_FAST_MS = 10_000;
exports.POLL_SLOW_MS = 30_000;
const SLOW_AFTER_MS = 10 * 60_000;
const BACKOFF = [10_000, 30_000, 60_000];
/** Delay until the next poll. `retryAt` (a rate limit) wins when it is later than the normal delay. */
function pollDelay(i) {
    const base = i.failures > 0
        ? BACKOFF[Math.min(i.failures, BACKOFF.length) - 1]
        : i.oldestActiveSince !== null && i.now - i.oldestActiveSince > SLOW_AFTER_MS ? exports.POLL_SLOW_MS : exports.POLL_FAST_MS;
    return i.retryAt !== null && i.retryAt - i.now > base ? i.retryAt - i.now : base;
}
function branchChoices(branches, current) {
    return current !== null && branches.includes(current) ? [current, ...branches.filter(b => b !== current)] : [...branches];
}
/** Loose check for a ref the user typed; GitHub gives the final verdict (422). */
function isPlausibleRef(ref) {
    return ref.length > 0 && ref.length <= 250 && !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(ref) && !ref.includes('..') && !ref.startsWith('-');
}
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}
//# sourceMappingURL=workflowsModel.js.map