'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importStar(require("node:test"));
const httpStub_1 = require("./httpStub");
const pullLifecycleApi_1 = require("./pullLifecycleApi");
(0, node_test_1.afterEach)(() => node_test_1.mock.restoreAll());
(0, node_test_1.default)('mergePull sends the method and pins the head the page showed', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { data: { mergePullRequest: { pullRequest: { merged: true } } } } }]);
    await (0, pullLifecycleApi_1.mergePull)('PR_1', 'SQUASH', 'a'.repeat(40), 't');
    node_assert_1.default.match(calls[0].body.query, /mergePullRequest/);
    node_assert_1.default.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1', mergeMethod: 'SQUASH', expectedHeadOid: 'a'.repeat(40) });
});
(0, node_test_1.default)('mergePull: a head that moved, or any refusal, rejects with GitHub\'s own words', async () => {
    (0, httpStub_1.stub)([{ body: { errors: [{ message: 'Head branch was modified. Review and try the merge again.' }] } }]);
    await node_assert_1.default.rejects((0, pullLifecycleApi_1.mergePull)('PR_1', 'MERGE', 'a'.repeat(40), 't'), /Head branch was modified/);
});
(0, node_test_1.default)('setPullOpen closes or reopens', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { data: {} } }]);
    await (0, pullLifecycleApi_1.setPullOpen)('PR_1', false, 't');
    await (0, pullLifecycleApi_1.setPullOpen)('PR_1', true, 't');
    node_assert_1.default.match(calls[0].body.query, /closePullRequest/);
    node_assert_1.default.match(calls[1].body.query, /reopenPullRequest/);
    node_assert_1.default.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1' });
});
(0, node_test_1.default)('setPullDraft converts to a draft or marks ready', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { data: {} } }]);
    await (0, pullLifecycleApi_1.setPullDraft)('PR_1', true, 't');
    await (0, pullLifecycleApi_1.setPullDraft)('PR_1', false, 't');
    node_assert_1.default.match(calls[0].body.query, /convertPullRequestToDraft/);
    node_assert_1.default.match(calls[1].body.query, /markPullRequestReadyForReview/);
    node_assert_1.default.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1' });
});
//# sourceMappingURL=pullLifecycleApi.test.js.map