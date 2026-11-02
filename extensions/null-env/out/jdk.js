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
exports.parseJavaVersion = parseJavaVersion;
exports.majorOf = majorOf;
exports.runtimeName = runtimeName;
exports.findJdks = findJdks;
const path = __importStar(require("node:path"));
function parseJavaVersion(releaseFile) {
    return /^JAVA_VERSION="([^"]+)"/m.exec(releaseFile)?.[1] ?? null;
}
/** `1.8.0_392` is Java 8, `21.0.2` is Java 21. */
function majorOf(version) {
    const parts = version.split(/[.+_-]/);
    return Number(parts[0] === '1' ? parts[1] : parts[0]) || 0;
}
/** The name `java.configuration.runtimes` requires: `JavaSE-1.8`, `JavaSE-21`. */
function runtimeName(major) {
    return major <= 8 ? `JavaSE-1.${major}` : `JavaSE-${major}`;
}
const WINDOWS_VENDORS = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru'];
/** Directories whose children are JDK homes. */
function jdkRoots(platform, home, env) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const roots = [p.join(home, '.jdks'), p.join(home, '.sdkman', 'candidates', 'java')];
    if (platform === 'win32') {
        const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
        roots.push(...WINDOWS_VENDORS.map(v => p.join(programFiles, v)));
    }
    else if (platform === 'darwin') {
        roots.push('/Library/Java/JavaVirtualMachines');
    }
    else {
        roots.push('/usr/lib/jvm');
    }
    return roots;
}
/**
 * Every JDK (a directory with `bin/javac`) in `JAVA_HOME`, `extraHomes` (e.g. the `javac` on PATH) and the usual install
 * roots, newest first. ponytail: fixed vendor folders, no registry or `/usr/libexec/java_home`; add when a JDK is missed.
 */
function findJdks(fs, platform, home, env, extraHomes = []) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const javac = platform === 'win32' ? 'javac.exe' : 'javac';
    const candidates = [...extraHomes, ...(env.JAVA_HOME ? [env.JAVA_HOME.replace(/[\\/]+$/, '')] : [])];
    for (const root of jdkRoots(platform, home, env)) {
        let names = [];
        try {
            names = fs.listDir(root);
        }
        catch {
            continue;
        }
        for (const name of names) {
            const dir = p.join(root, name);
            candidates.push(platform === 'darwin' ? p.join(dir, 'Contents', 'Home') : dir);
        }
    }
    const seen = new Set();
    const jdks = [];
    for (const dir of candidates) {
        const key = p.normalize(dir).toLowerCase();
        if (seen.has(key) || !fs.isFile(p.join(dir, 'bin', javac))) {
            continue;
        }
        seen.add(key);
        let version = 'unknown';
        try {
            version = parseJavaVersion(fs.readFile(p.join(dir, 'release'))) ?? version;
        }
        catch {
            // no release file: still a usable JDK
        }
        jdks.push({ home: dir, version, major: majorOf(version) });
    }
    return jdks.sort((a, b) => b.major - a.major);
}
//# sourceMappingURL=jdk.js.map