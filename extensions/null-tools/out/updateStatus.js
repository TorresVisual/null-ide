'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProgressLine = parseProgressLine;
exports.formatBytes = formatBytes;
exports.statusFor = statusFor;
exports.isSafeTag = isSafeTag;
exports.shouldAcknowledge = shouldAcknowledge;
const PLAIN = new Set(['checking', 'verifying', 'preparing', 'installing', 'restarting', 'upToDate', 'ready', 'busy', 'needsReapproval']);
function parseProgressLine(line) {
    let v;
    try {
        v = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    if (!v || typeof v !== 'object')
        return undefined;
    const o = v;
    switch (o.state) {
        case 'downloading':
            return typeof o.bytes === 'number' && typeof o.total === 'number'
                ? { state: 'downloading', bytes: o.bytes, total: o.total, bytesPerSec: typeof o.bytesPerSec === 'number' ? o.bytesPerSec : 0 }
                : undefined;
        case 'waitingForClose':
            return { state: 'waitingForClose', processes: Array.isArray(o.processes) ? o.processes.filter((p) => typeof p === 'string') : [] };
        case 'failed':
            return typeof o.message === 'string'
                ? { state: 'failed', message: o.message, log: typeof o.log === 'string' ? o.log : undefined }
                : undefined;
        default:
            return typeof o.state === 'string' && PLAIN.has(o.state) ? { state: o.state } : undefined;
    }
}
function formatBytes(n) {
    return n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
function statusFor(version, p, ready) {
    if (ready) {
        return { text: '$(rocket) Restart to update', tooltip: `Null IDE ${version} is downloaded and ready to install` };
    }
    switch (p?.state) {
        case 'downloading': {
            const pct = p.total > 0 ? Math.min(100, Math.floor((p.bytes / p.total) * 100)) : 0;
            return {
                text: `$(cloud-download) ${version} ${pct}%`,
                tooltip: `Downloading Null IDE ${version}: ${formatBytes(p.bytes)} of ${formatBytes(p.total)} (${formatBytes(p.bytesPerSec)}/s)`,
            };
        }
        case 'verifying':
            return { text: `$(sync~spin) Verifying ${version}`, tooltip: `Verifying the Null IDE ${version} download` };
        case 'failed':
            return {
                text: `$(warning) Update ${version} failed`,
                tooltip: `${p.message}${p.log ? `\nLog: ${p.log}` : ''}\nClick to try again.`,
            };
        default:
            return { text: `$(cloud-download) ${version}`, tooltip: `Preparing Null IDE ${version}…` };
    }
}
/** Tags become directory names inside null-setup, so mirror its conservative rule. */
function isSafeTag(tag) {
    return /^[A-Za-z0-9._-]+$/.test(tag) && !tag.includes('..');
}
/** Only a journal in step MovedIn means "the new install is in place"; a Started journal belongs to an update still in progress. */
function shouldAcknowledge(journalText) {
    try {
        return JSON.parse(journalText ?? '').step === 'MovedIn';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=updateStatus.js.map