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
exports.realReaders = void 0;
exports.resolveEngine = resolveEngine;
const fs = __importStar(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const uproject_1 = require("./uproject");
const LAUNCHER_DAT = 'C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat';
const VERSION_KEY = 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine';
const BUILDS_KEY = 'HKCU\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds';
const GUID = /^\{?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}?$/i;
// Returns the engine at `root`, or undefined when its editor binary is missing.
function engineAt(root, r) {
    const bin = node_path_1.win32.join(root, 'Engine', 'Binaries');
    const editor = node_path_1.win32.join(bin, 'Win64', 'UnrealEditor.exe');
    if (!r.exists(editor))
        return undefined;
    return {
        root,
        editor,
        editorCmd: node_path_1.win32.join(bin, 'Win64', 'UnrealEditor-Cmd.exe'),
        automationTool: node_path_1.win32.join(bin, 'DotNET', 'AutomationTool', 'AutomationTool.exe'),
        buildTool: node_path_1.win32.join(bin, 'DotNET', 'UnrealBuildTool', 'UnrealBuildTool.exe'),
    };
}
function resolveEngine(project, override, r) {
    if (override) {
        const e = engineAt(override, r);
        if (!e)
            throw new uproject_1.ResolveError(`null-unreal.enginePath ${override} has no Engine\\Binaries\\Win64\\UnrealEditor.exe`);
        return e;
    }
    const assoc = project.engineAssociation.trim();
    const places = [];
    if (assoc === '') {
        for (let dir = project.dir;;) {
            if (r.exists(node_path_1.win32.join(dir, 'Engine', 'Binaries'))) {
                const e = engineAt(dir, r);
                if (e)
                    return e;
            }
            const parent = node_path_1.win32.dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        places.push(`an Engine\\ folder above ${project.dir}`);
    }
    else if (GUID.test(assoc)) {
        const braced = `{${assoc.replace(/[{}]/g, '')}}`;
        const root = r.registry(BUILDS_KEY, braced);
        const e = root && engineAt(root, r);
        if (e)
            return e;
        places.push(`${BUILDS_KEY} ${braced}`);
    }
    else {
        const root = r.registry(`${VERSION_KEY}\\${assoc}`, 'InstalledDirectory');
        const e = root && engineAt(root, r);
        if (e)
            return e;
        places.push(`${VERSION_KEY}\\${assoc} InstalledDirectory`);
        const dat = r.readFile(LAUNCHER_DAT);
        const list = dat ? parseInstallations(dat) : [];
        const match = list.find((i) => i.AppName === `UE_${assoc}`);
        const fromDat = match && engineAt(match.InstallLocation, r);
        if (fromDat)
            return fromDat;
        places.push(`${LAUNCHER_DAT} (UE_${assoc})`);
    }
    const label = assoc === '' ? 'an empty EngineAssociation' : `EngineAssociation "${assoc}"`;
    throw new uproject_1.ResolveError(`could not find Unreal Engine for ${label} (looked in: ${places.join('; ')}). Set null-unreal.enginePath to the engine root.`);
}
function parseInstallations(dat) {
    try {
        const json = JSON.parse(dat.replace(/^\uFEFF/, ''));
        return Array.isArray(json?.InstallationList) ? json.InstallationList : [];
    }
    catch {
        return [];
    }
}
exports.realReaders = {
    registry(key, value) {
        const r = (0, node_child_process_1.spawnSync)('reg', ['query', key, '/v', value], { encoding: 'utf8', shell: false });
        if (r.status !== 0)
            return undefined;
        const m = /REG_SZ\s+(.*?)\s*$/m.exec(r.stdout);
        return m ? m[1] : undefined;
    },
    readFile(p) {
        try {
            return fs.readFileSync(p, 'utf8');
        }
        catch {
            return undefined;
        }
    },
    exists(p) {
        return fs.existsSync(p);
    },
};
//# sourceMappingURL=engine.js.map