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
const node_path_1 = require("node:path");
const engine_1 = require("./engine");
const uproject_1 = require("./uproject");
const ROOT = 'C:\\Engines\\UE_5.8';
const EDITOR = node_path_1.win32.join(ROOT, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const DIR = 'C:\\Games\\MyGame';
const GUID = 'A1B2C3D4-0000-4000-8000-0123456789AB';
const LAUNCHER = 'C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat';
function project(engineAssociation) {
    return { file: node_path_1.win32.join(DIR, 'MyGame.uproject'), dir: DIR, name: 'MyGame', engineAssociation };
}
// Fake readers: `reg` is keyed "<key>|<value>", `files` by path, `exists` lists existing paths.
function readers(o = {}) {
    const reg = o.reg ?? {};
    const files = o.files ?? {};
    const exists = new Set(o.exists ?? []);
    return {
        registry: (key, value) => reg[`${key}|${value}`],
        readFile: (p) => files[p],
        exists: (p) => exists.has(p),
    };
}
(0, node_test_1.test)('an explicit override wins over EngineAssociation', () => {
    const r = readers({
        reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': 'C:\\Other' },
        exists: [EDITOR, node_path_1.win32.join('D:\\Override', 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')],
    });
    const e = (0, engine_1.resolveEngine)(project('5.8'), 'D:\\Override', r);
    assert.equal(e.root, 'D:\\Override');
    assert.equal(e.editor, node_path_1.win32.join('D:\\Override', 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe'));
});
(0, node_test_1.test)('a version resolves from the registry InstalledDirectory', () => {
    const r = readers({
        reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': ROOT },
        exists: [EDITOR],
    });
    const e = (0, engine_1.resolveEngine)(project('5.8'), undefined, r);
    assert.equal(e.root, ROOT);
    assert.equal(e.editor, EDITOR);
    assert.equal(e.editorCmd, node_path_1.win32.join(ROOT, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe'));
    assert.equal(e.automationTool, node_path_1.win32.join(ROOT, 'Engine', 'Binaries', 'DotNET', 'AutomationTool', 'AutomationTool.exe'));
});
(0, node_test_1.test)('a version falls back to LauncherInstalled.dat', () => {
    const dat = JSON.stringify({ InstallationList: [{ AppName: 'UE_5.8', InstallLocation: ROOT }] });
    const r = readers({ files: { [LAUNCHER]: dat }, exists: [EDITOR] });
    assert.equal((0, engine_1.resolveEngine)(project('5.8'), undefined, r).root, ROOT);
});
(0, node_test_1.test)('a GUID resolves from HKCU Builds, with and without braces', () => {
    const key = 'HKCU\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds';
    const r = readers({ reg: { [`${key}|{${GUID}}`]: ROOT }, exists: [EDITOR] });
    assert.equal((0, engine_1.resolveEngine)(project(GUID), undefined, r).root, ROOT);
    assert.equal((0, engine_1.resolveEngine)(project(`{${GUID}}`), undefined, r).root, ROOT);
});
(0, node_test_1.test)('an empty EngineAssociation walks up to a directory holding Engine\\Binaries', () => {
    const up = 'C:\\Engines\\UE_5.8';
    const r = readers({
        exists: [node_path_1.win32.join(up, 'Engine', 'Binaries'), EDITOR],
    });
    const p = { ...project(''), dir: node_path_1.win32.join(up, 'Samples', 'MyGame') };
    assert.equal((0, engine_1.resolveEngine)(p, undefined, r).root, up);
});
(0, node_test_1.test)('a root that lacks the editor exe is skipped as not found', () => {
    const r = readers({ reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': ROOT } });
    assert.throws(() => (0, engine_1.resolveEngine)(project('5.8'), undefined, r), (e) => e instanceof uproject_1.ResolveError
        && /EngineAssociation "5\.8"/.test(e.message)
        && /InstalledDirectory/.test(e.message)
        && /LauncherInstalled\.dat/.test(e.message)
        && /null-unreal\.enginePath/.test(e.message));
});
//# sourceMappingURL=engine.test.js.map