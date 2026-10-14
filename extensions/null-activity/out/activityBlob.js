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
exports.blobHash = exports.blobName = void 0;
exports.parseBlobName = parseBlobName;
exports.encodeMonth = encodeMonth;
exports.decodeMonth = decodeMonth;
const crypto = __importStar(require("crypto"));
const zlib = __importStar(require("zlib"));
const intervalStore_1 = require("./intervalStore");
const types_1 = require("./types");
const PREFIX = 'activity__';
const NAME_RE = /^activity__([0-9a-f]{10})__(\d{4}-\d{2})\.enc$/;
/** The remote file holding one machine's intervals of one month. */
const blobName = (machine, month) => `${PREFIX}${machine}__${month}.enc`;
exports.blobName = blobName;
/** Remote names are untrusted: only exactly the names `blobName` writes are accepted. */
function parseBlobName(name) {
    const m = NAME_RE.exec(name);
    return m ? { machine: m[1], month: m[2] } : undefined;
}
const blobHash = (text) => crypto.createHash('sha256').update(text).digest('hex');
exports.blobHash = blobHash;
/**
 * Header line plus one interval per line (each with its window id, so per-window attribution and WakaTime imports
 * survive), gzipped and base64 so it can be sealed as text. Sorted, so equal data gives equal text and the hash
 * can tell whether anything changed.
 */
function encodeMonth(machine, intervals) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end || (a.window ?? '').localeCompare(b.window ?? ''));
    const lines = [JSON.stringify({ v: 1, machine: machine.id, name: machine.name })];
    for (const { machine: _machine, ...i } of sorted)
        lines.push(JSON.stringify(i));
    return zlib.gzipSync(lines.join('\n'), { level: 9 }).toString('base64');
}
/** `undefined` for anything that is not a v1 blob; unreadable lines are skipped like in the log. Never throws. */
function decodeMonth(text) {
    try {
        const [head, ...lines] = zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8').split('\n');
        const header = JSON.parse(head);
        if (header?.v !== 1 || typeof header.machine !== 'string' || !types_1.MACHINE_ID_RE.test(header.machine))
            return undefined;
        const intervals = lines.flatMap((line) => (line.trim() ? (0, intervalStore_1.parseInterval)(line) ?? [] : []));
        return { machine: header.machine, name: typeof header.name === 'string' ? header.name.slice(0, 80) : header.machine, intervals };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=activityBlob.js.map