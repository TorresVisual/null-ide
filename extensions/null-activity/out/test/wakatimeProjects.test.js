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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const wakatimeProjects_1 = require("../wakatimeProjects");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-'));
const forward = (p) => p.replace(/\\/g, '/');
function repo(root, remote) {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`);
}
(0, node_test_1.test)('a heartbeat directory inside an existing repo resolves to the repo key and root', () => {
    const root = tmpDir();
    repo(root, 'git@github.com:Torres/Null-IDE.git');
    const src = path.join(root, 'src');
    fs.mkdirSync(src);
    node_assert_1.default.deepStrictEqual((0, wakatimeProjects_1.diskProjectResolver)('whatever', forward(src)), {
        key: 'github.com/torres/null-ide',
        name: path.basename(root),
        root,
    });
});
(0, node_test_1.test)('missing, relative and non-git directories do not resolve', () => {
    node_assert_1.default.strictEqual((0, wakatimeProjects_1.diskProjectResolver)('p', forward(path.join(tmpDir(), 'does-not-exist'))), undefined);
    node_assert_1.default.strictEqual((0, wakatimeProjects_1.diskProjectResolver)('p', 'relative/dir'), undefined);
    const plain = path.join(tmpDir(), 'plain');
    fs.mkdirSync(plain);
    node_assert_1.default.strictEqual((0, wakatimeProjects_1.diskProjectResolver)('p', forward(plain)), undefined);
});
//# sourceMappingURL=wakatimeProjects.test.js.map