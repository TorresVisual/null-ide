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
const packagePath_1 = require("./packagePath");
const uproject_1 = require("./uproject");
const P = 'C:\\Games\\MyGame';
// A tree given as { folder: [entries] }; an entry ending in "/" is a folder.
function tree(t) {
    return {
        list: (dir) => (t[dir] ?? []).map((e) => ({ name: e.replace(/\/$/, ''), isDirectory: e.endsWith('/') })),
        exists: (p) => p in t,
    };
}
const fs = tree({
    [`${P}\\Plugins`]: ['Fx/', 'Tools/'],
    [`${P}\\Plugins\\Fx`]: ['Fx.uplugin', 'Content/'],
    [`${P}\\Plugins\\Fx\\Content`]: [],
    [`${P}\\Plugins\\Tools`]: ['Tools.uplugin'], // a code-only plugin has no Content
});
(0, node_test_1.test)('the project and each plugin with a Content folder are mounted', () => {
    assert.deepEqual((0, packagePath_1.findMounts)(P, fs), [
        { name: '/Game', root: `${P}\\Content` },
        { name: '/Fx', root: `${P}\\Plugins\\Fx\\Content` },
    ]);
});
(0, node_test_1.test)('a file maps to its package path under the project and under a plugin', () => {
    const m = (0, packagePath_1.findMounts)(P, fs);
    assert.equal((0, packagePath_1.toPackagePath)(`${P}\\Content\\Materials\\M_Example.uasset`, m), '/Game/Materials/M_Example');
    assert.equal((0, packagePath_1.toPackagePath)(`${P}\\Plugins\\Fx\\Content\\NS_Spark.uasset`, m), '/Fx/NS_Spark');
});
(0, node_test_1.test)('matching ignores drive-letter and folder case, as Windows does', () => {
    assert.equal((0, packagePath_1.toPackagePath)('c:\\games\\mygame\\content\\A.uasset', (0, packagePath_1.findMounts)(P, fs)), '/Game/A');
});
(0, node_test_1.test)('a .uasset outside every mounted root, or another file type, is an explicit error', () => {
    const m = (0, packagePath_1.findMounts)(P, fs);
    assert.throws(() => (0, packagePath_1.toPackagePath)('C:\\Other\\Content\\A.uasset', m), uproject_1.ResolveError);
    assert.throws(() => (0, packagePath_1.toPackagePath)(`${P}\\Content\\Level.umap`, m), uproject_1.ResolveError);
    assert.throws(() => (0, packagePath_1.toPackagePath)(`${P}\\ContentExtra\\A.uasset`, m), uproject_1.ResolveError);
});
(0, node_test_1.test)('a folder expands to its .uasset files, sorted, skipping other files', () => {
    const t = tree({
        [`${P}\\Content`]: ['B.uasset', 'Sub/', 'Level.umap', 'A.UASSET'],
        [`${P}\\Content\\Sub`]: ['C.uasset'],
    });
    assert.deepEqual((0, packagePath_1.uassetsIn)(`${P}\\Content`, t), [`${P}\\Content\\A.UASSET`, `${P}\\Content\\B.uasset`, `${P}\\Content\\Sub\\C.uasset`]);
});
//# sourceMappingURL=packagePath.test.js.map