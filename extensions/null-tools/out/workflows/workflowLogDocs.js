'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_SCHEME = void 0;
exports.logDocParts = logDocParts;
exports.parseLogDoc = parseLogDoc;
/** URI scheme of a job's log (or one step of it); served by `WorkflowLogProvider` from the Actions API. */
exports.WORKFLOW_SCHEME = 'null-workflows';
const NAME = /^[A-Za-z0-9._-]+$/;
const dotsOnly = (s) => /^\.+$/.test(s);
const MAX_STEP = 1000;
/** The URI parts for a log. `label` only gives the tab a readable title; it is sanitised and never read back. */
function logDocParts(ref, label) {
    const clean = label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'job';
    return {
        scheme: exports.WORKFLOW_SCHEME,
        path: `/${ref.owner}/${ref.repo}/${ref.jobId}/${clean}.log`,
        query: ref.step === null ? '' : `step=${ref.step}`,
    };
}
/** The reference a document URI encodes, or null when anything about it is off (it then never reaches the network). */
function parseLogDoc(uriPath, query) {
    const parts = uriPath.split('/');
    if (parts.length !== 5 || parts[0] !== '')
        return null;
    const [, owner, repo, id, file] = parts;
    if (!NAME.test(owner) || dotsOnly(owner) || !NAME.test(repo) || dotsOnly(repo))
        return null;
    if (!/^[1-9]\d{0,14}$/.test(id))
        return null;
    if (!/^[A-Za-z0-9._-]+\.log$/.test(file) || dotsOnly(file.slice(0, -4)))
        return null;
    let step = null;
    if (query !== '') {
        const params = new URLSearchParams(query);
        const keys = [...params.keys()];
        if (keys.length !== 1 || keys[0] !== 'step' || params.getAll('step').length !== 1)
            return null;
        const raw = params.get('step');
        if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > MAX_STEP)
            return null;
        step = Number(raw);
    }
    return { owner, repo, jobId: Number(id), step };
}
//# sourceMappingURL=workflowLogDocs.js.map