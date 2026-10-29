"use strict";
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
exports.SERVER_PORT = exports.AUTHORITY_PREFIX = void 0;
exports.parseConfig = parseConfig;
exports.substitute = substitute;
exports.normalizePath = normalizePath;
exports.basename = basename;
exports.containerFolder = containerFolder;
exports.toAuthority = toAuthority;
exports.fromAuthority = fromAuthority;
exports.containerName = containerName;
exports.buildRunArgs = buildRunArgs;
exports.archOf = archOf;
// Pure helpers: no vscode import, covered by devcontainer.test.ts.
const crypto = __importStar(require("crypto"));
exports.AUTHORITY_PREFIX = 'dev-container';
/** Port the server listens on inside the container; docker publishes it on a random 127.0.0.1 port. */
exports.SERVER_PORT = 33000;
/** JSONC → JSON: drops comments and trailing commas, leaves strings alone. */
function parseConfig(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') {
                if (text[j] === '\\') {
                    j++;
                }
                j++;
            }
            out += text.slice(i, j + 1);
            i = j;
        }
        else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            out += '\n';
        }
        else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
        }
        else if (c === '}' || c === ']') {
            out = out.replace(/,\s*$/, '') + c;
        }
        else {
            out += c;
        }
    }
    return JSON.parse(out);
}
function substitute(s, v) {
    return s.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (m, name, arg) => {
        switch (name) {
            case 'localWorkspaceFolder': return v.localWorkspaceFolder;
            case 'localWorkspaceFolderBasename': return basename(v.localWorkspaceFolder);
            case 'containerWorkspaceFolder': return v.containerWorkspaceFolder;
            case 'localEnv': return v.env[arg ?? ''] ?? '';
            default: return m; // unknown variables pass through untouched
        }
    });
}
/** Forward slashes everywhere: `sh` (Git Bash) and docker both accept them, backslashes break `sh -c`. */
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
function basename(p) {
    return normalizePath(p).replace(/\/+$/, '').split('/').pop() ?? '';
}
function containerFolder(cfg, local) {
    return cfg.workspaceFolder?.replace('${localWorkspaceFolderBasename}', basename(local)) ?? `/workspaces/${basename(local)}`;
}
function toAuthority(local) {
    return `${exports.AUTHORITY_PREFIX}+${Buffer.from(local, 'utf8').toString('hex')}`;
}
function fromAuthority(authority) {
    return Buffer.from(authority.slice(authority.indexOf('+') + 1), 'hex').toString('utf8');
}
function containerName(local) {
    return `null-dc-${crypto.createHash('sha1').update(local).digest('hex').slice(0, 12)}`;
}
/**
 * `docker run` arguments. The image's own entrypoint is replaced by a sleep loop (the dev containers
 * default, `overrideCommand`), so the container stays up for `docker exec`.
 */
function buildRunArgs(cfg, v, name) {
    const env = Object.entries(cfg.containerEnv ?? {}).flatMap(([k, val]) => ['-e', `${k}=${substitute(val, v)}`]);
    return [
        'run', '-d', '--name', name,
        '--mount', `type=bind,source=${v.localWorkspaceFolder},target=${v.containerWorkspaceFolder}`,
        '-p', `127.0.0.1::${exports.SERVER_PORT}`,
        ...env,
        ...(cfg.runArgs ?? []).map((a) => substitute(a, v)),
        '--entrypoint', 'sh', cfg.image, '-c', 'while sleep 1000; do :; done',
    ];
}
/** Maps `uname -m` to the arch name used in the server download URL. */
function archOf(uname) {
    return /aarch64|arm64/.test(uname) ? 'arm64' : 'x64';
}
//# sourceMappingURL=devcontainer.js.map