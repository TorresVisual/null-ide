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
const pullFilter_1 = require("./pullFilter");
const pullModel_1 = require("./pullModel");
async function pickOne(title, options, current) {
    const picked = await vscode.window.showQuickPick(options.map(o => ({ label: o.label, description: o.value === current ? 'current' : '', value: o.value })), { title });
    return picked ? picked.value : current;
}
/** `null` clears the facet; the current value is kept when the list cannot be loaded or the pick is cancelled. */
async function pickName(title, load, current) {
    let names;
    try {
        names = await load();
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Could not load the ${title.toLowerCase()} list: ${(0, pullModel_1.describeFailure)(err)}`);
        return current;
    }
    const items = [{ label: 'Any', value: null }, ...names.map(n => ({ label: n, value: n }))];
    const picked = await vscode.window.showQuickPick(items, { title });
    return picked ? picked.value : current;
}
/** Walks the facets until Apply (resolves to the new filter) or Escape (resolves to undefined: nothing changes). */
async function editFilter(start, choices) {
    let f = start;
    for (;;) {
        const items = [
            { label: '$(check) Apply', action: 'apply' },
            ...(0, pullFilter_1.facetRows)(f).map(r => ({ label: r.label, description: r.description, id: r.id })),
            { label: '$(discard) Reset filters', action: 'reset' },
        ];
        const picked = await vscode.window.showQuickPick(items, { title: 'Filter pull requests' });
        if (!picked)
            return undefined;
        if (picked.action === 'apply')
            return f;
        if (picked.action === 'reset') {
            f = pullFilter_1.DEFAULT_FILTER;
            continue;
        }
        switch (picked.id) {
            case 'mine':
                f = { ...f, mine: !f.mine };
                break;
            case 'reviewRequested':
                f = { ...f, reviewRequested: !f.reviewRequested };
                break;
            case 'state':
                f = { ...f, state: await pickOne('State', pullFilter_1.STATE_OPTIONS, f.state) };
                break;
            case 'draft':
                f = { ...f, draft: await pickOne('Drafts', pullFilter_1.DRAFT_OPTIONS, f.draft) };
                break;
            case 'sort':
                f = { ...f, sort: await pickOne('Sort by', pullFilter_1.SORT_OPTIONS, f.sort) };
                break;
            case 'label':
                f = { ...f, label: await pickName('Label', choices.labels, f.label) };
                break;
            case 'milestone':
                f = { ...f, milestone: await pickName('Milestone', choices.milestones, f.milestone) };
                break;
        }
    }
}
//# sourceMappingURL=pullFilterMenu.js.map