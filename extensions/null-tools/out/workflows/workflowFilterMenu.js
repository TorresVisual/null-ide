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
exports.editFilter = editFilter;
const vscode = __importStar(require("vscode"));
const workflowsModel_1 = require("./workflowsModel");
const APPLY = '$(check) Apply';
const RESET = '$(discard) Reset';
/** One menu: toggle a facet and it comes back; Apply returns the draft, Escape returns undefined (no change). */
async function editFilter(current, workflowFiles) {
    let draft = { ...current };
    for (;;) {
        const rows = (0, workflowsModel_1.filterRows)(draft).map(r => ({ label: r.label, description: r.description, id: r.id }));
        const picked = await vscode.window.showQuickPick([...rows, { label: RESET, description: '', id: 'reset' }, { label: APPLY, description: '', id: 'apply' }], { title: 'Filter GitHub Actions runs', placeHolder: 'Pick a facet to change, then Apply' });
        if (!picked)
            return undefined;
        switch (picked.id) {
            case 'apply': return draft;
            case 'reset':
                draft = { ...workflowsModel_1.DEFAULT_FILTER };
                break;
            case 'branch':
                draft = { ...draft, branch: !draft.branch };
                break;
            case 'mine':
                draft = { ...draft, mine: !draft.mine };
                break;
            case 'failed':
                draft = { ...draft, failed: !draft.failed };
                break;
            case 'workflow': {
                const files = workflowFiles();
                const choice = await vscode.window.showQuickPick([{ label: 'Any workflow', file: null, description: '' }, ...files.map(f => ({ label: f.name, file: f.file, description: f.file }))], { title: 'Show runs of one workflow' });
                if (choice)
                    draft = { ...draft, workflow: choice.file };
                break;
            }
        }
    }
}
//# sourceMappingURL=workflowFilterMenu.js.map