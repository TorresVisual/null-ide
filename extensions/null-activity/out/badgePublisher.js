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
exports.BadgePublisher = void 0;
const crypto = __importStar(require("crypto"));
const badgeModel_1 = require("./badgeModel");
const badgeSvg_1 = require("./badgeSvg");
const gistClient_1 = require("./gistClient");
const fail = (message) => ({ ok: false, message });
const markdownFor = (badges, owner, id) => badges.map((b) => `![${b.label}](${(0, gistClient_1.gistRawUrl)(owner, id, b.file)})`).join('\n');
class BadgePublisher {
    deps;
    tail = Promise.resolve();
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Interactive (a user command) may pick an account, sign in and always pushes. Non-interactive (the hourly
     * refresh) only updates an existing gist, silently, and skips when nothing changed. Calls run one at a time;
     * never rejects.
     */
    publish(opts) {
        const run = this.tail.then(() => this.run(opts.interactive));
        this.tail = run;
        return run;
    }
    async run(interactive) {
        try {
            const { deps } = this;
            const badges = (0, badgeModel_1.buildBadges)(deps.source);
            const files = badges.map((b) => ({ name: b.file, content: (0, badgeSvg_1.renderBadge)(b.label, b.value, b.color) }));
            const hash = crypto.createHash('sha1').update(files.map((f) => f.content).join('\n')).digest('hex');
            const accounts = await deps.accounts();
            const prior = deps.state.get();
            let account = accounts.find((a) => a.id === prior?.accountId);
            if (!account) {
                if (!interactive)
                    return fail('Badges have not been published yet.');
                if (accounts.length === 0)
                    return fail('Add a GitHub account (github.com) in Null Accounts first.');
                account = accounts.length === 1 ? accounts[0] : await deps.chooseAccount(accounts);
                if (!account)
                    return fail('Cancelled.');
            }
            const existing = prior?.accountId === account.id ? prior : undefined;
            if (!interactive && existing?.hash === hash) {
                return { ok: true, changed: false, markdown: markdownFor(badges, existing.owner, existing.gistId) };
            }
            const token = await deps.token(account.id, interactive);
            if (!token) {
                return fail(interactive ? 'GitHub did not provide a token with the gist scope.' : 'No GitHub token is available without signing in.');
            }
            const result = await (0, gistClient_1.publishGist)(deps.http, token, existing?.gistId, files, interactive);
            if (!result.ok)
                return result;
            deps.state.set({ gistId: result.id, accountId: account.id, owner: result.owner, hash });
            return { ok: true, changed: true, markdown: markdownFor(badges, result.owner, result.id) };
        }
        catch (err) {
            return fail(`Could not publish badges (${err instanceof Error ? err.message : String(err)}).`);
        }
    }
}
exports.BadgePublisher = BadgePublisher;
//# sourceMappingURL=badgePublisher.js.map