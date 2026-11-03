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
const path = __importStar(require("node:path"));
const uproject_1 = require("./uproject");
// In-memory project tree: `files` maps full paths to contents.
function memFs(files) {
    const paths = Object.keys(files);
    return {
        readdir: (dir) => paths.filter((p) => path.dirname(p) === dir).map((p) => path.basename(p)),
        readFile: (p) => {
            if (!(p in files))
                throw new Error(`ENOENT ${p}`);
            return files[p];
        },
        exists: (p) => p in files || paths.some((f) => f.startsWith(p + path.sep)),
    };
}
const root = path.resolve('/work/MyGame');
const mygame = path.join(root, 'MyGame.uproject');
const other = path.join(root, 'Tools', 'Other.uproject');
const body = '{"EngineAssociation":"5.8"}';
(0, node_test_1.test)('walks up from Source/Game to the project file', () => {
    const fs = memFs({ [mygame]: body });
    const p = (0, uproject_1.resolveProject)(path.join(root, 'Source', 'Game'), undefined, fs);
    assert.equal(p.file, mygame);
    assert.equal(p.dir, root);
    assert.equal(p.name, 'MyGame');
    assert.equal(p.engineAssociation, '5.8');
});
(0, node_test_1.test)('explicit project file wins over walking up', () => {
    const fs = memFs({ [mygame]: body, [other]: body });
    const p = (0, uproject_1.resolveProject)(root, other, fs);
    assert.equal(p.file, other);
});
(0, node_test_1.test)('explicit directory holding one project resolves to it', () => {
    const fs = memFs({ [mygame]: body, [other]: body });
    const p = (0, uproject_1.resolveProject)(root, path.dirname(other), fs);
    assert.equal(p.file, other);
});
(0, node_test_1.test)('two project files in one directory is an error that lists both', () => {
    const a = path.join(root, 'A.uproject');
    const b = path.join(root, 'B.uproject');
    const fs = memFs({ [a]: body, [b]: body });
    assert.throws(() => (0, uproject_1.resolveProject)(root, undefined, fs), (e) => e instanceof uproject_1.ResolveError && /A\.uproject/.test(e.message) && /B\.uproject/.test(e.message));
});
(0, node_test_1.test)('no project up to the drive root is an error that mentions --project', () => {
    const fs = memFs({});
    assert.throws(() => (0, uproject_1.resolveProject)(path.join(root, 'x'), undefined, fs), (e) => e instanceof uproject_1.ResolveError && /--project/.test(e.message));
});
(0, node_test_1.test)('a project file with a UTF-8 BOM parses', () => {
    const fs = memFs({ [mygame]: '\uFEFF' + body });
    assert.equal((0, uproject_1.resolveProject)(root, undefined, fs).engineAssociation, '5.8');
});
(0, node_test_1.test)('malformed JSON is an error that names the file', () => {
    const fs = memFs({ [mygame]: '{"EngineAssociation":' });
    assert.throws(() => (0, uproject_1.resolveProject)(root, undefined, fs), (e) => e instanceof uproject_1.ResolveError && e.message.includes('MyGame.uproject'));
});
//# sourceMappingURL=uproject.test.js.map