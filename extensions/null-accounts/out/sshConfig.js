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
exports.renderHostBlocks = renderHostBlocks;
exports.withInclude = withInclude;
exports.withoutInclude = withoutInclude;
exports.syncSshConfig = syncSshConfig;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const gitPlan_1 = require("./gitPlan");
const sshKey_1 = require("./sshKey");
// Plain `git clone` (terminal, other tools) has no repo yet, so repo-local `core.sshCommand` can't apply.
// Instead the keys live in a file Null IDE owns, pulled into the user's ssh config by one `Include` line.
// Relative Include paths in a user config resolve against ~/.ssh, so this works for every OpenSSH on Windows.
const INCLUDE_COMMENT = '# Null IDE account keys (managed; removed when no account has a key)';
const INCLUDE_LINE = 'Include null-accounts/config';
const managedConfigFile = (home) => path.join((0, sshKey_1.managedKeyDir)(home), 'config');
/**
 * One `Host` block per hostname, listing the key of every account on it that has one.
 * ponytail: with two accounts on one host ssh tries the keys in order and the server takes the first it knows;
 * a bound repo still gets its own account's key from `core.sshCommand`. Per-account host aliases if that bites.
 */
function renderHostBlocks(accounts, home) {
    const keysByHost = new Map();
    for (const account of accounts) {
        const host = account.host.replace(/:\d+$/, ''); // ssh matches the hostname; the port comes from the URL
        const key = (0, gitPlan_1.sshKeyFile)(account, home);
        // Anything outside these sets could end the value or add a directive of its own.
        if (!key || /["\r\n]/.test(key) || !/^[a-z0-9.-]+$/.test(host)) {
            continue;
        }
        (keysByHost.get(host) ?? keysByHost.set(host, new Set()).get(host)).add(key);
    }
    return [...keysByHost]
        .map(([host, keys]) => [
        `Host ${host}`,
        ...[...keys].map(key => `  IdentityFile "${key}"`),
        '  IdentitiesOnly yes',
        '',
    ].join('\n'))
        .join('\n');
}
const hasInclude = (config) => config.split(/\r?\n/).some(l => l.trim() === INCLUDE_LINE);
/** The Include must come before any `Host`/`Match` line, or it would only apply inside that block. */
function withInclude(config) {
    if (hasInclude(config)) {
        return config;
    }
    const eol = config.includes('\r\n') ? '\r\n' : '\n';
    return `${INCLUDE_COMMENT}${eol}${INCLUDE_LINE}${eol}${config.length > 0 ? eol : ''}${config}`;
}
function withoutInclude(config) {
    const eol = config.includes('\r\n') ? '\r\n' : '\n';
    const lines = config.split(/\r?\n/);
    const at = lines.findIndex(l => l.trim() === INCLUDE_LINE);
    if (at < 0) {
        return config;
    }
    const start = lines[at - 1]?.trim() === INCLUDE_COMMENT ? at - 1 : at;
    const end = lines[at + 1]?.trim() === '' ? at + 2 : at + 1; // the blank line withInclude added
    lines.splice(start, end - start);
    return lines.join(eol);
}
const readIfExists = (file) => fs.readFile(file, 'utf8').catch((err) => {
    if (err.code === 'ENOENT') {
        return undefined;
    }
    throw err;
});
/** Brings `~/.ssh/null-accounts/config` and the Include line in `~/.ssh/config` in line with the accounts. Writes only on change. */
async function syncSshConfig(accounts, home) {
    const managedFile = managedConfigFile(home);
    const userFile = path.join(home, '.ssh', 'config');
    const block = renderHostBlocks(accounts, home);
    const user = await readIfExists(userFile);
    if (block) {
        await fs.mkdir(path.dirname(managedFile), { recursive: true });
        if ((await readIfExists(managedFile)) !== block) {
            await fs.writeFile(managedFile, block);
        }
        if (user === undefined || !hasInclude(user)) {
            await fs.writeFile(userFile, withInclude(user ?? ''));
        }
    }
    else {
        await fs.rm(managedFile, { force: true });
        if (user !== undefined && hasInclude(user)) {
            await fs.writeFile(userFile, withoutInclude(user));
        }
    }
}
//# sourceMappingURL=sshConfig.js.map