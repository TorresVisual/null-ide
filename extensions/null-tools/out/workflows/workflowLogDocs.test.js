'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const workflowLogDocs_1 = require("./workflowLogDocs");
(0, node_test_1.default)('a job and a step round-trip, and the label only decorates the tab title', () => {
    const job = (0, workflowLogDocs_1.logDocParts)({ owner: 'o', repo: 'r', jobId: 5, step: null }, 'build / x 86');
    node_assert_1.default.strictEqual(job.scheme, workflowLogDocs_1.WORKFLOW_SCHEME);
    node_assert_1.default.strictEqual(job.path, '/o/r/5/build-x-86.log');
    node_assert_1.default.strictEqual(job.query, '');
    node_assert_1.default.deepStrictEqual((0, workflowLogDocs_1.parseLogDoc)(job.path, job.query), { owner: 'o', repo: 'r', jobId: 5, step: null });
    const step = (0, workflowLogDocs_1.logDocParts)({ owner: 'o', repo: 'r', jobId: 5, step: 3 }, 'build: Run tests');
    node_assert_1.default.strictEqual(step.query, 'step=3');
    node_assert_1.default.deepStrictEqual((0, workflowLogDocs_1.parseLogDoc)(step.path, step.query), { owner: 'o', repo: 'r', jobId: 5, step: 3 });
});
(0, node_test_1.default)('the label is sanitised and never empty', () => {
    node_assert_1.default.strictEqual((0, workflowLogDocs_1.logDocParts)({ owner: 'o', repo: 'r', jobId: 1, step: null }, '../../etc').path, '/o/r/1/etc.log');
    node_assert_1.default.strictEqual((0, workflowLogDocs_1.logDocParts)({ owner: 'o', repo: 'r', jobId: 1, step: null }, '///').path, '/o/r/1/job.log');
    node_assert_1.default.ok((0, workflowLogDocs_1.logDocParts)({ owner: 'o', repo: 'r', jobId: 1, step: null }, 'x'.repeat(500)).path.length < 100);
});
(0, node_test_1.default)('parseLogDoc rejects anything that is not exactly /owner/repo/jobId/label.log', () => {
    const bad = [
        ['/../../etc/passwd', ''],
        ['/o/r/5', ''],
        ['/o/r/5/x.log/extra', ''],
        ['/o/r/abc/x.log', ''],
        ['/o/r/-1/x.log', ''],
        ['/o/r/0/x.log', ''],
        ['/o/r/5.5/x.log', ''],
        ['/o/r/99999999999999999999/x.log', ''],
        ['/../r/5/x.log', ''],
        ['/./r/5/x.log', ''],
        ['/o/../5/x.log', ''],
        ['/o/r r/5/x.log', ''],
        ['/o%2Fx/r/5/x.log', ''],
        ['/o/r/5/x.txt', ''],
        ['/o/r/5/../x.log', ''],
        ['/o/r/5/x.log', 'step=abc'],
        ['/o/r/5/x.log', 'step=0'],
        ['/o/r/5/x.log', 'step=1&step=2'],
        ['/o/r/5/x.log', 'step=1&evil=1'],
        ['/o/r/5/x.log', 'evil=1'],
        ['', ''],
    ];
    for (const [p, q] of bad)
        node_assert_1.default.strictEqual((0, workflowLogDocs_1.parseLogDoc)(p, q), null, `${p}?${q}`);
});
//# sourceMappingURL=workflowLogDocs.test.js.map