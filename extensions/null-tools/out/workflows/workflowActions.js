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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAction = runAction;
exports.enable = enable;
exports.dispatch = dispatch;
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("../github/githubApi");
const githubAuth_1 = require("../github/githubAuth");
const githubSession_1 = require("../github/githubSession");
const dispatchInputs_1 = require("./dispatchInputs");
const api = __importStar(require("./workflowsApi"));
const workflowsModel_1 = require("./workflowsModel");
const MAX_WORKFLOW_BYTES = 256 * 1024;
const DISPATCH_REFRESH_MS = 3000; // GitHub does not return the new run id, so look again shortly
/** The token for a write: the one the tree has, or an interactive sign-in for this folder. */
async function writeToken(slot) {
    if (slot.token)
        return slot.token;
    const session = await (0, githubSession_1.resolveGithubSession)((0, githubAuth_1.getAccountsApi)(), slot.folder, true);
    slot.token = session?.accessToken ?? null;
    return slot.token;
}
const LABELS = {
    rerunAll: 'Re-run all jobs', rerunFailed: 'Re-run failed jobs', rerunJob: 'Re-run job', cancel: 'Cancel run',
};
const CONFIRM = { rerunAll: 'Re-run all jobs of this run?', cancel: 'Cancel this run?' };
/** Re-reads the target, refuses a stale click with the reason, confirms where the spec says so, then calls the API. */
async function runAction(tree, node, action) {
    const slot = tree.slot(node.repo.key);
    if (!slot || (node.kind !== 'run' && node.kind !== 'job'))
        return;
    const token = await writeToken(slot);
    if (!token)
        return;
    const { owner, repo } = slot;
    const id = node.kind === 'run' ? node.run.id : node.job.id;
    try {
        const fresh = node.kind === 'run' ? await api.getRun(owner, repo, id, token) : await api.getJob(owner, repo, id, token);
        const reason = (0, workflowsModel_1.refusal)(action, fresh);
        if (reason) {
            void vscode.window.showWarningMessage(`${LABELS[action]}: ${reason}`);
            await tree.reloadRuns(slot);
            return;
        }
        const question = CONFIRM[action];
        if (question && !await vscode.window.showWarningMessage(question, { modal: true }, LABELS[action]))
            return;
        switch (action) {
            case 'rerunAll':
                await api.rerunRun(owner, repo, id, token);
                break;
            case 'rerunFailed':
                await api.rerunFailedJobs(owner, repo, id, token);
                break;
            case 'rerunJob':
                await api.rerunJob(owner, repo, id, token);
                break;
            case 'cancel':
                await api.cancelRun(owner, repo, id, token);
                break;
        }
        void vscode.window.showInformationMessage(`${LABELS[action]}: requested.`);
    }
    catch (err) {
        void vscode.window.showErrorMessage(`${LABELS[action]}: ${(0, workflowsModel_1.actionFailureText)(err)}`);
    }
    slot.jobs.clear(); // a re-run starts a new attempt: reload jobs when the rows are opened again
    await tree.reloadRuns(slot);
}
async function enable(tree, node) {
    const slot = tree.slot(node.repo.key);
    if (!slot || node.kind !== 'workflow')
        return;
    const token = await writeToken(slot);
    if (!token)
        return;
    if (!await vscode.window.showWarningMessage(`Enable the workflow "${node.workflow.name}"?`, { modal: true }, 'Enable'))
        return;
    try {
        await api.enableWorkflow(slot.owner, slot.repo, node.workflow.id, token);
        void vscode.window.showInformationMessage(`${node.workflow.name} is enabled.`);
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Enable workflow: ${(0, workflowsModel_1.actionFailureText)(err)}`);
    }
    await tree.refresh();
}
/** A branch (or any typed ref), then one prompt per `workflow_dispatch` input read from the YAML at that ref. */
async function pickRef(slot, token, title) {
    const branches = await api.listBranches(slot.owner, slot.repo, token).catch(() => []);
    const choices = (0, workflowsModel_1.branchChoices)(branches, slot.branch);
    const qp = vscode.window.createQuickPick();
    qp.title = title;
    qp.placeholder = 'Branch or tag to run on (type to use any ref)';
    const base = choices.map(label => ({ label }));
    qp.items = base;
    qp.onDidChangeValue(value => {
        const typed = value.trim();
        qp.items = typed && !choices.includes(typed) && (0, workflowsModel_1.isPlausibleRef)(typed) ? [{ label: typed, description: 'use this ref' }, ...base] : base;
    });
    return new Promise(resolve => {
        qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.label); qp.hide(); });
        qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
        qp.show();
    });
}
async function askInput(workflow, input) {
    const title = `${workflow}: ${input.name}`;
    if (input.type === 'boolean' || input.type === 'choice') {
        const options = input.type === 'boolean' ? ['true', 'false'] : input.options;
        const items = options.map(label => ({ label, description: label === input.default ? 'default' : '' }));
        return (await vscode.window.showQuickPick(items, { title, placeHolder: input.description || input.name }))?.label;
    }
    return vscode.window.showInputBox({
        title, prompt: input.description || undefined, value: input.default ?? '',
        validateInput: v => (0, dispatchInputs_1.validateInput)(input, v),
    });
}
async function dispatch(tree, node) {
    const slot = tree.slot(node.repo.key);
    if (!slot || node.kind !== 'workflow')
        return;
    const token = await writeToken(slot);
    if (!token)
        return;
    const { workflow } = node;
    const ref = await pickRef(slot, token, `Run ${workflow.name}`);
    if (!ref)
        return;
    let inputs;
    try {
        const file = await (0, githubApi_1.fetchRepoFile)(slot.owner, slot.repo, ref, workflow.path, token, MAX_WORKFLOW_BYTES);
        const parsed = (0, dispatchInputs_1.parseDispatch)(file.bytes.toString('utf8'));
        if (!parsed.dispatchable) {
            void vscode.window.showWarningMessage(`${workflow.name} has no workflow_dispatch trigger at ${ref}.`);
            return;
        }
        inputs = parsed.inputs;
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Could not read ${workflow.path} at ${ref}: ${(0, workflowsModel_1.actionFailureText)(err)}`);
        return;
    }
    const values = {};
    for (const input of inputs) {
        const value = await askInput(workflow.name, input);
        if (value === undefined)
            return; // Escape anywhere cancels the whole dispatch
        if (value !== '')
            values[input.name] = value;
    }
    try {
        await api.dispatchWorkflow(slot.owner, slot.repo, workflow.id, ref, values, token);
        void vscode.window.showInformationMessage(`Started ${workflow.name} on ${ref}.`);
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Run workflow: ${(0, workflowsModel_1.actionFailureText)(err)}`);
    }
    setTimeout(() => void tree.reloadRuns(slot), DISPATCH_REFRESH_MS);
}
//# sourceMappingURL=workflowActions.js.map