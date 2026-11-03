import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { win32 as win } from 'node:path';
import { resolveEngine, EngineReaders } from './engine';
import { Uproject } from './uproject';
import { ResolveError } from './uproject';

const ROOT = 'C:\\Engines\\UE_5.8';
const EDITOR = win.join(ROOT, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const DIR = 'C:\\Games\\MyGame';
const GUID = 'A1B2C3D4-0000-4000-8000-0123456789AB';
const LAUNCHER = 'C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat';

function project(engineAssociation: string): Uproject {
  return { file: win.join(DIR, 'MyGame.uproject'), dir: DIR, name: 'MyGame', engineAssociation };
}

// Fake readers: `reg` is keyed "<key>|<value>", `files` by path, `exists` lists existing paths.
function readers(o: { reg?: Record<string, string>; files?: Record<string, string>; exists?: string[] } = {}): EngineReaders {
  const reg = o.reg ?? {};
  const files = o.files ?? {};
  const exists = new Set(o.exists ?? []);
  return {
    registry: (key, value) => reg[`${key}|${value}`],
    readFile: (p) => files[p],
    exists: (p) => exists.has(p),
  };
}

test('an explicit override wins over EngineAssociation', () => {
  const r = readers({
    reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': 'C:\\Other' },
    exists: [EDITOR, win.join('D:\\Override', 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')],
  });
  const e = resolveEngine(project('5.8'), 'D:\\Override', r);
  assert.equal(e.root, 'D:\\Override');
  assert.equal(e.editor, win.join('D:\\Override', 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe'));
});

test('a version resolves from the registry InstalledDirectory', () => {
  const r = readers({
    reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': ROOT },
    exists: [EDITOR],
  });
  const e = resolveEngine(project('5.8'), undefined, r);
  assert.equal(e.root, ROOT);
  assert.equal(e.editor, EDITOR);
  assert.equal(e.editorCmd, win.join(ROOT, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe'));
  assert.equal(e.automationTool, win.join(ROOT, 'Engine', 'Binaries', 'DotNET', 'AutomationTool', 'AutomationTool.exe'));
});

test('a version falls back to LauncherInstalled.dat', () => {
  const dat = JSON.stringify({ InstallationList: [{ AppName: 'UE_5.8', InstallLocation: ROOT }] });
  const r = readers({ files: { [LAUNCHER]: dat }, exists: [EDITOR] });
  assert.equal(resolveEngine(project('5.8'), undefined, r).root, ROOT);
});

test('a GUID resolves from HKCU Builds, with and without braces', () => {
  const key = 'HKCU\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds';
  const r = readers({ reg: { [`${key}|{${GUID}}`]: ROOT }, exists: [EDITOR] });
  assert.equal(resolveEngine(project(GUID), undefined, r).root, ROOT);
  assert.equal(resolveEngine(project(`{${GUID}}`), undefined, r).root, ROOT);
});

test('an empty EngineAssociation walks up to a directory holding Engine\\Binaries', () => {
  const up = 'C:\\Engines\\UE_5.8';
  const r = readers({
    exists: [win.join(up, 'Engine', 'Binaries'), EDITOR],
  });
  const p = { ...project(''), dir: win.join(up, 'Samples', 'MyGame') };
  assert.equal(resolveEngine(p, undefined, r).root, up);
});

test('a root that lacks the editor exe is skipped as not found', () => {
  const r = readers({ reg: { 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.8|InstalledDirectory': ROOT } });
  assert.throws(
    () => resolveEngine(project('5.8'), undefined, r),
    (e: unknown) => e instanceof ResolveError
      && /EngineAssociation "5\.8"/.test(e.message)
      && /InstalledDirectory/.test(e.message)
      && /LauncherInstalled\.dat/.test(e.message)
      && /null-unreal\.enginePath/.test(e.message),
  );
});
