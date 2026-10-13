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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const statusText_1 = require("./statusText");
const status = (state, lastSyncedAt) => ({
    state,
    lastSyncedAt,
    conflicts: [],
    pending: [],
    pendingInstalls: [],
    pendingRemovals: [],
});
const NOW = 10 * 24 * 3_600_000;
const MINUTE = 60_000;
(0, node_test_1.describe)('describeStatus', () => {
    (0, node_test_1.it)('says what each state means', () => {
        assert.equal((0, statusText_1.describeStatus)(status('disabled'), NOW), 'Sync is off');
        assert.equal((0, statusText_1.describeStatus)(status('signedOut'), NOW), 'Sign-in or setup needed');
        assert.equal((0, statusText_1.describeStatus)(status('syncing'), NOW), 'Syncing…');
    });
    (0, node_test_1.it)('adds when it last synced', () => {
        assert.equal((0, statusText_1.describeStatus)(status('idle', NOW - 30_000), NOW), 'Up to date (last synced just now)');
        assert.equal((0, statusText_1.describeStatus)(status('offline', NOW - 5 * MINUTE), NOW), 'Offline (last synced 5 min ago)');
        assert.equal((0, statusText_1.describeStatus)(status('error', NOW - 3 * 60 * MINUTE), NOW), 'Error (last synced 3 h ago)');
        assert.equal((0, statusText_1.describeStatus)(status('needsAttention', NOW - 2 * 24 * 60 * MINUTE), NOW), 'Needs attention (last synced 2 d ago)');
    });
    (0, node_test_1.it)('says so when it has never synced', () => {
        assert.equal((0, statusText_1.describeStatus)(status('idle'), NOW), 'Up to date (never synced)');
    });
});
//# sourceMappingURL=statusText.test.js.map