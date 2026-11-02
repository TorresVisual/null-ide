import * as path from 'node:path';

export interface Jdk {
  /** The JDK home (the directory holding `bin/javac`). */
  home: string;
  /** From the `release` file, e.g. `21.0.2`, `1.8.0_392`; `unknown` when the file is missing. */
  version: string;
  major: number;
}

/** What discovery needs from the machine; bound to `fs` in `jdkCommand.ts`. */
export interface JdkFs {
  listDir(p: string): string[];
  readFile(p: string): string;
  isFile(p: string): boolean;
}

export function parseJavaVersion(releaseFile: string): string | null {
  return /^JAVA_VERSION="([^"]+)"/m.exec(releaseFile)?.[1] ?? null;
}

/** `1.8.0_392` is Java 8, `21.0.2` is Java 21. */
export function majorOf(version: string): number {
  const parts = version.split(/[.+_-]/);
  return Number(parts[0] === '1' ? parts[1] : parts[0]) || 0;
}

/** The name `java.configuration.runtimes` requires: `JavaSE-1.8`, `JavaSE-21`. */
export function runtimeName(major: number): string {
  return major <= 8 ? `JavaSE-1.${major}` : `JavaSE-${major}`;
}

const WINDOWS_VENDORS = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru'];

/** Directories whose children are JDK homes. */
function jdkRoots(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const roots = [p.join(home, '.jdks'), p.join(home, '.sdkman', 'candidates', 'java')];
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    roots.push(...WINDOWS_VENDORS.map(v => p.join(programFiles, v)));
  } else if (platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines');
  } else {
    roots.push('/usr/lib/jvm');
  }
  return roots;
}

/**
 * Every JDK (a directory with `bin/javac`) in `JAVA_HOME`, `extraHomes` (e.g. the `javac` on PATH) and the usual install
 * roots, newest first. ponytail: fixed vendor folders, no registry or `/usr/libexec/java_home`; add when a JDK is missed.
 */
export function findJdks(
  fs: JdkFs,
  platform: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
  extraHomes: readonly string[] = [],
): Jdk[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const javac = platform === 'win32' ? 'javac.exe' : 'javac';
  const candidates = [...extraHomes, ...(env.JAVA_HOME ? [env.JAVA_HOME.replace(/[\\/]+$/, '')] : [])];
  for (const root of jdkRoots(platform, home, env)) {
    let names: string[] = [];
    try {
      names = fs.listDir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = p.join(root, name);
      candidates.push(platform === 'darwin' ? p.join(dir, 'Contents', 'Home') : dir);
    }
  }

  const seen = new Set<string>();
  const jdks: Jdk[] = [];
  for (const dir of candidates) {
    const key = p.normalize(dir).toLowerCase();
    if (seen.has(key) || !fs.isFile(p.join(dir, 'bin', javac))) {
      continue;
    }
    seen.add(key);
    let version = 'unknown';
    try {
      version = parseJavaVersion(fs.readFile(p.join(dir, 'release'))) ?? version;
    } catch {
      // no release file: still a usable JDK
    }
    jdks.push({ home: dir, version, major: majorOf(version) });
  }
  return jdks.sort((a, b) => b.major - a.major);
}
