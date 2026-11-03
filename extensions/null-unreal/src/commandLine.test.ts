import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildPlan } from './commandLine';
import { Engine } from './engine';
import { Uproject } from './uproject';

const engine: Engine = {
  root: 'C:\\UE',
  editor: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
  editorCmd: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe',
  automationTool: 'C:\\UE\\Engine\\Binaries\\DotNET\\AutomationTool\\AutomationTool.exe',
};
const project: Uproject = {
  file: 'C:\\Games\\MyGame\\MyGame.uproject',
  dir: 'C:\\Games\\MyGame',
  name: 'MyGame',
  engineAssociation: '5.8',
};
const none = { extraArgs: [] as string[] };

test('build runs AutomationTool BuildCookRun with no timeout', () => {
  const p = buildPlan('build', engine, project, none);
  assert.equal(p.exe, engine.automationTool);
  assert.deepEqual(p.args, [
    'BuildCookRun', '-project=C:\\Games\\MyGame\\MyGame.uproject', '-platform=Win64', '-build', '-cook',
  ]);
  assert.equal(p.timeoutSec, undefined);
});

test('test runs UnrealEditor-Cmd with the default project-prefix filter and a 600 s timeout', () => {
  const p = buildPlan('test', engine, project, none);
  assert.equal(p.exe, engine.editorCmd);
  assert.deepEqual(p.args, [
    'C:\\Games\\MyGame\\MyGame.uproject',
    '-ExecCmds=Automation RunTests MyGame.; Quit',
    '-unattended', '-nullrhi', '-stdout', '-FullStdOutLogOutput',
  ]);
  assert.equal(p.timeoutSec, 600);
});

test('run launches the editor windowed at 1280x720 with no timeout', () => {
  const p = buildPlan('run', engine, project, none);
  assert.equal(p.exe, engine.editor);
  assert.deepEqual(p.args, [
    'C:\\Games\\MyGame\\MyGame.uproject', '-game', '-windowed', '-ResX=1280', '-ResY=720',
  ]);
  assert.equal(p.timeoutSec, undefined);
});

test('smoke runs UnrealEditor-Cmd headless with a 120 s timeout', () => {
  const p = buildPlan('smoke', engine, project, none);
  assert.equal(p.exe, engine.editorCmd);
  assert.deepEqual(p.args, [
    'C:\\Games\\MyGame\\MyGame.uproject', '-game', '-nullrhi', '-unattended', '-stdout', '-ExecCmds=Quit',
  ]);
  assert.equal(p.timeoutSec, 120);
});

test('--filter replaces the default test filter', () => {
  const p = buildPlan('test', engine, project, { filter: 'MyGame.Combat.', extraArgs: [] });
  assert.equal(p.args[1], '-ExecCmds=Automation RunTests MyGame.Combat.; Quit');
});

test('extra arguments are appended last', () => {
  const p = buildPlan('smoke', engine, project, { extraArgs: ['-LogCmds=LogCook verbose'] });
  assert.equal(p.args[p.args.length - 1], '-LogCmds=LogCook verbose');
});

test('platform and resolution override the defaults', () => {
  const b = buildPlan('build', engine, project, { extraArgs: [], platform: 'Linux' });
  assert.ok(b.args.includes('-platform=Linux'));
  const r = buildPlan('run', engine, project, { extraArgs: [], resX: 1920, resY: 1080 });
  assert.ok(r.args.includes('-ResX=1920') && r.args.includes('-ResY=1080'));
});

test('a project path with spaces stays one argument', () => {
  const spaced = { ...project, file: 'C:\\My Games\\My Game\\MyGame.uproject' };
  const p = buildPlan('run', engine, spaced, none);
  assert.equal(p.args[0], 'C:\\My Games\\My Game\\MyGame.uproject');
});
