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
exports.registerBadges = registerBadges;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const badgeModel_1 = require("./badgeModel");
const badgePublisher_1 = require("./badgePublisher");
const badgeSvg_1 = require("./badgeSvg");
const gistHttp_1 = require("./gistHttp");
const STATE_KEY = 'null-activity.badge';
const REFRESH_MS = 60 * 60_000;
const FIRST_REFRESH_MS = 60_000;
function registerBadges(context, service, log) {
    const accountsApi = async () => vscode.extensions.getExtension('null.null-accounts')?.activate();
    const publisher = new badgePublisher_1.BadgePublisher({
        source: service,
        accounts: async () => (await accountsApi())?.getAccounts().filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh') ?? [],
        chooseAccount: async (accounts) => (await vscode.window.showQuickPick(accounts.map((account) => ({ label: `@${account.username}`, account })), { placeHolder: 'Publish badges with which GitHub account?' }))?.account,
        token: async (accountId, interactive) => {
            const api = await accountsApi();
            const account = api?.getAccounts().find((a) => a.id === accountId);
            return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
        },
        http: gistHttp_1.fetchJson,
        state: {
            get: () => context.globalState.get(STATE_KEY),
            set: (state) => void context.globalState.update(STATE_KEY, state),
        },
    });
    context.subscriptions.push(vscode.commands.registerCommand('null-activity.publishBadges', async () => {
        if (!context.globalState.get(STATE_KEY)) {
            const answer = await vscode.window.showWarningMessage('Publish three badges to a secret GitHub Gist? It contains only your total coding time, daily average and top language. Anyone with the link can view it.', { modal: true }, 'Publish');
            if (answer !== 'Publish')
                return;
        }
        const outcome = await publisher.publish({ interactive: true });
        if (!outcome.ok) {
            void vscode.window.showErrorMessage(`Null Activity: ${outcome.message}`);
            return;
        }
        await vscode.env.clipboard.writeText(outcome.markdown);
        void vscode.window.showInformationMessage('Null Activity: badges published. The Markdown for your README is on the clipboard.');
    }), vscode.commands.registerCommand('null-activity.saveBadges', async () => {
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Save Badges Here',
        });
        if (!picked)
            return;
        try {
            for (const b of (0, badgeModel_1.buildBadges)(service))
                fs.writeFileSync(path.join(picked[0].fsPath, b.file), (0, badgeSvg_1.renderBadge)(b.label, b.value, b.color));
            void vscode.window.showInformationMessage(`Null Activity: saved 3 badges to ${picked[0].fsPath}.`);
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Null Activity: could not save badges (${err instanceof Error ? err.message : String(err)}).`);
        }
    }));
    const refresh = () => {
        if (!service.enabled || !vscode.workspace.getConfiguration('null-activity').get('badge.autoPublish'))
            return;
        void publisher.publish({ interactive: false }).then((outcome) => log(outcome.ok ? (outcome.changed ? 'Badges refreshed.' : 'Badges unchanged.') : `Badge refresh skipped: ${outcome.message}`));
    };
    const first = setTimeout(refresh, FIRST_REFRESH_MS);
    const timer = setInterval(refresh, REFRESH_MS);
    context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(timer); } });
}
//# sourceMappingURL=badgeCommands.js.map