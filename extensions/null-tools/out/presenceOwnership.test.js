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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const presenceOwnership_1 = require("./presenceOwnership");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-own-'));
const claim = (dir, file, pid) => fs.writeFileSync(path.join(dir, file), JSON.stringify({ pid, focusedAt: Date.now() }));
(0, node_test_1.default)('the default claim file name is unchanged (Discord presence keeps working)', () => {
    const dir = tmp();
    new presenceOwnership_1.PresenceOwnership(dir).claim();
    node_assert_1.default.ok(fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
});
(0, node_test_1.default)('a custom claim file is used and is independent of the Discord claim', () => {
    const dir = tmp();
    const widgets = new presenceOwnership_1.PresenceOwnership(dir, undefined, 'widgets-owner.json');
    widgets.claim();
    node_assert_1.default.ok(fs.existsSync(path.join(dir, 'widgets-owner.json')) && !fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
    widgets.release();
    node_assert_1.default.ok(!fs.existsSync(path.join(dir, 'widgets-owner.json')));
});
(0, node_test_1.default)('a live foreign owner keeps ownership; a dead owner is taken over', async () => {
    const dir = tmp();
    const live = (0, node_child_process_1.spawn)(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
    try {
        claim(dir, 'widgets-owner.json', live.pid);
        node_assert_1.default.strictEqual(new presenceOwnership_1.PresenceOwnership(dir, undefined, 'widgets-owner.json').isOwner(), false);
    }
    finally {
        live.kill();
    }
    const dead = (0, node_child_process_1.spawn)(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise(r => dead.on('exit', r));
    claim(dir, 'widgets-owner.json', dead.pid);
    const mine = new presenceOwnership_1.PresenceOwnership(dir, undefined, 'widgets-owner.json');
    node_assert_1.default.strictEqual(mine.isOwner(), true);
    node_assert_1.default.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'widgets-owner.json'), 'utf8')).pid, process.pid);
});
//# sourceMappingURL=presenceOwnership.test.js.map