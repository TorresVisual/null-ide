'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePanelMessage = parsePanelMessage;
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
/** Webview messages are untrusted: accept only the exact shapes the host handles, copying known fields only. */
function parsePanelMessage(raw) {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const m = raw;
    const type = m.type;
    switch (type) {
        case 'ready':
        case 'add':
            return { type };
        case 'remove':
        case 'editEmail':
        case 'setGlobalIdentity':
        case 'reauth':
        case 'generateKey':
        case 'attachKey':
        case 'copyPublicKey':
        case 'uploadKey':
        case 'testKey':
        case 'removeKey':
            return nonEmpty(m.id) ? { type, id: m.id } : undefined;
        case 'setSigning':
            return nonEmpty(m.id) && typeof m.on === 'boolean' ? { type, id: m.id, on: m.on } : undefined;
        case 'unbind':
            return nonEmpty(m.key) ? { type, key: m.key } : undefined;
        default:
            return undefined;
    }
}
//# sourceMappingURL=panelMessages.js.map