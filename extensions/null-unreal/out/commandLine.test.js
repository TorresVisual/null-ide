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
const commandLine_1 = require("./commandLine");
const engine = {
    root: 'C:\\UE',
    editor: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
    editorCmd: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe',
    automationTool: 'C:\\UE\\Engine\\Binaries\\DotNET\\AutomationTool\\AutomationTool.exe',
    buildTool: 'C:\\UE\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe',
};
const project = {
    file: 'C:\\Games\\MyGame\\MyGame.uproject',
    dir: 'C:\\Games\\MyGame',
    name: 'MyGame',
    engineAssociation: '5.8',
};
const none = { extraArgs: [] };
(0, node_test_1.test)('build runs AutomationTool BuildCookRun with no timeout', () => {
    const p = (0, commandLine_1.buildPlan)('build', engine, project, none);
    assert.equal(p.exe, engine.automationTool);
    assert.deepEqual(p.args, [
        'BuildCookRun', '-project=C:\\Games\\MyGame\\MyGame.uproject', '-platform=Win64', '-build', '-cook',
    ]);
    assert.equal(p.timeoutSec, undefined);
});
(0, node_test_1.test)('test runs UnrealEditor-Cmd with the default project-prefix filter and a 600 s timeout', () => {
    const p = (0, commandLine_1.buildPlan)('test', engine, project, none);
    assert.equal(p.exe, engine.editorCmd);
    assert.deepEqual(p.args, [
        'C:\\Games\\MyGame\\MyGame.uproject',
        '-ExecCmds=Automation RunTests MyGame.; Quit',
        '-unattended', '-nullrhi', '-stdout', '-FullStdOutLogOutput',
    ]);
    assert.equal(p.timeoutSec, 600);
});
(0, node_test_1.test)('run launches the editor windowed at 1280x720 with no timeout', () => {
    const p = (0, commandLine_1.buildPlan)('run', engine, project, none);
    assert.equal(p.exe, engine.editor);
    assert.deepEqual(p.args, [
        'C:\\Games\\MyGame\\MyGame.uproject', '-game', '-windowed', '-ResX=1280', '-ResY=720',
    ]);
    assert.equal(p.timeoutSec, undefined);
});
(0, node_test_1.test)('smoke runs UnrealEditor-Cmd headless with a 120 s timeout', () => {
    const p = (0, commandLine_1.buildPlan)('smoke', engine, project, none);
    assert.equal(p.exe, engine.editorCmd);
    assert.deepEqual(p.args, [
        'C:\\Games\\MyGame\\MyGame.uproject', '-game', '-nullrhi', '-unattended', '-stdout', '-ExecCmds=Quit',
    ]);
    assert.equal(p.timeoutSec, 120);
});
(0, node_test_1.test)('--filter replaces the default test filter', () => {
    const p = (0, commandLine_1.buildPlan)('test', engine, project, { filter: 'MyGame.Combat.', extraArgs: [] });
    assert.equal(p.args[1], '-ExecCmds=Automation RunTests MyGame.Combat.; Quit');
});
(0, node_test_1.test)('extra arguments are appended last', () => {
    const p = (0, commandLine_1.buildPlan)('smoke', engine, project, { extraArgs: ['-LogCmds=LogCook verbose'] });
    assert.equal(p.args[p.args.length - 1], '-LogCmds=LogCook verbose');
});
(0, node_test_1.test)('platform and resolution override the defaults', () => {
    const b = (0, commandLine_1.buildPlan)('build', engine, project, { extraArgs: [], platform: 'Linux' });
    assert.ok(b.args.includes('-platform=Linux'));
    const r = (0, commandLine_1.buildPlan)('run', engine, project, { extraArgs: [], resX: 1920, resY: 1080 });
    assert.ok(r.args.includes('-ResX=1920') && r.args.includes('-ResY=1080'));
});
(0, node_test_1.test)('a project path with spaces stays one argument', () => {
    const spaced = { ...project, file: 'C:\\My Games\\My Game\\MyGame.uproject' };
    const p = (0, commandLine_1.buildPlan)('run', engine, spaced, none);
    assert.equal(p.args[0], 'C:\\My Games\\My Game\\MyGame.uproject');
});
(0, node_test_1.test)('export runs the PythonScript commandlet headless and passes the request through the environment', () => {
    const script = path.join('ext', 'engine', 'export_asset.py');
    const request = path.join('saved', 'export-request-1.json');
    const p = (0, commandLine_1.buildPlan)('export', engine, project, { extraArgs: ['-Foo'], script, request });
    assert.equal(p.exe, engine.editorCmd);
    assert.deepEqual(p.args, [project.file, '-run=PythonScript', `-Script=${script}`, '-nullrhi', '-unattended', '-stdout', '-NoSplash', '-Foo']);
    assert.deepEqual(p.env, { NULL_UNREAL_REQUEST: request });
});
(0, node_test_1.test)('compdb runs UnrealBuildTool GenerateClangDatabase for the editor target and writes beside the .uproject', () => {
    const p = (0, commandLine_1.buildPlan)('compdb', engine, project, { extraArgs: ['-Foo'] });
    assert.equal(p.exe, engine.buildTool);
    assert.deepEqual(p.args, [
        '-mode=GenerateClangDatabase', `-project=${project.file}`, 'MyGameEditor', 'Development', 'Win64', `-OutputDir=${project.dir}`, '-Foo',
    ]);
    assert.equal(p.timeoutSec, undefined);
});
//# sourceMappingURL=commandLine.test.js.map