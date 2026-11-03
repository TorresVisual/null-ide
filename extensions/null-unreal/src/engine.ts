import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 as win } from 'node:path';
import { ResolveError, Uproject } from './uproject';

// Everything that knows where Unreal Engine lives on disk. Windows only.
export interface EngineReaders {
  registry(key: string, value: string): string | undefined;   // reg query wrapper
  readFile(p: string): string | undefined;
  exists(p: string): boolean;
}

export interface Engine { root: string; editor: string; editorCmd: string; automationTool: string }

const LAUNCHER_DAT = 'C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat';
const VERSION_KEY = 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine';
const BUILDS_KEY = 'HKCU\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds';
const GUID = /^\{?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}?$/i;

// Returns the engine at `root`, or undefined when its editor binary is missing.
function engineAt(root: string, r: EngineReaders): Engine | undefined {
  const bin = win.join(root, 'Engine', 'Binaries');
  const editor = win.join(bin, 'Win64', 'UnrealEditor.exe');
  if (!r.exists(editor)) return undefined;
  return {
    root,
    editor,
    editorCmd: win.join(bin, 'Win64', 'UnrealEditor-Cmd.exe'),
    automationTool: win.join(bin, 'DotNET', 'AutomationTool', 'AutomationTool.exe'),
  };
}

export function resolveEngine(project: Uproject, override: string | undefined, r: EngineReaders): Engine {
  if (override) {
    const e = engineAt(override, r);
    if (!e) throw new ResolveError(`null-unreal.enginePath ${override} has no Engine\\Binaries\\Win64\\UnrealEditor.exe`);
    return e;
  }

  const assoc = project.engineAssociation.trim();
  const places: string[] = [];
  if (assoc === '') {
    for (let dir = project.dir; ; ) {
      if (r.exists(win.join(dir, 'Engine', 'Binaries'))) {
        const e = engineAt(dir, r);
        if (e) return e;
      }
      const parent = win.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    places.push(`an Engine\\ folder above ${project.dir}`);
  } else if (GUID.test(assoc)) {
    const braced = `{${assoc.replace(/[{}]/g, '')}}`;
    const root = r.registry(BUILDS_KEY, braced);
    const e = root && engineAt(root, r);
    if (e) return e;
    places.push(`${BUILDS_KEY} ${braced}`);
  } else {
    const root = r.registry(`${VERSION_KEY}\\${assoc}`, 'InstalledDirectory');
    const e = root && engineAt(root, r);
    if (e) return e;
    places.push(`${VERSION_KEY}\\${assoc} InstalledDirectory`);

    const dat = r.readFile(LAUNCHER_DAT);
    const list = dat ? parseInstallations(dat) : [];
    const match = list.find((i) => i.AppName === `UE_${assoc}`);
    const fromDat = match && engineAt(match.InstallLocation, r);
    if (fromDat) return fromDat;
    places.push(`${LAUNCHER_DAT} (UE_${assoc})`);
  }

  const label = assoc === '' ? 'an empty EngineAssociation' : `EngineAssociation "${assoc}"`;
  throw new ResolveError(
    `could not find Unreal Engine for ${label} (looked in: ${places.join('; ')}). Set null-unreal.enginePath to the engine root.`,
  );
}

function parseInstallations(dat: string): { AppName?: string; InstallLocation: string }[] {
  try {
    const json = JSON.parse(dat.replace(/^\uFEFF/, ''));
    return Array.isArray(json?.InstallationList) ? json.InstallationList : [];
  } catch {
    return [];
  }
}

export const realReaders: EngineReaders = {
  registry(key, value) {
    const r = spawnSync('reg', ['query', key, '/v', value], { encoding: 'utf8', shell: false });
    if (r.status !== 0) return undefined;
    const m = /REG_SZ\s+(.*?)\s*$/m.exec(r.stdout);
    return m ? m[1] : undefined;
  },
  readFile(p) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
  exists(p) {
    return fs.existsSync(p);
  },
};
