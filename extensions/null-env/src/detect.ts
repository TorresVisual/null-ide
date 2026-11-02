import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Language } from './types';

export interface DetectedProject {
  language: Language;
  /** The canonical manifest name (the suffix, e.g. `.csproj`, for suffix matches). */
  manifest: string;
}

interface Matcher {
  language: Language;
  exact?: string;
  suffix?: string;
}

// The one manifest -> language table. Order is the order results are reported in.
const MATCHERS: readonly Matcher[] = [
  { language: 'rust', exact: 'Cargo.toml' },
  { language: 'cpp', exact: 'CMakeLists.txt' },
  { language: 'cpp', exact: 'compile_commands.json' },
  { language: 'cpp', exact: '.clangd' },
  { language: 'node', exact: 'package.json' },
  { language: 'dotnet', suffix: '.csproj' },
  { language: 'java', exact: 'pom.xml' },
  { language: 'java', exact: 'build.gradle' },
  { language: 'java', exact: 'build.gradle.kts' },
  // Standalone assignments with no build file; also looked for in src/ (IntelliJ layout), see detectProjects.
  { language: 'java', suffix: '.java' },
];

const defaultListDir = (folderPath: string): string[] => fs.readdirSync(folderPath);

export function detectProjects(folderPath: string, listDir: (p: string) => string[] = defaultListDir): DetectedProject[] {
  let names: string[];
  try {
    names = listDir(folderPath).map(n => n.toLowerCase());
  } catch {
    return [];
  }
  // ponytail: only src/ one level down, not a recursive scan; add when assignments nest deeper.
  let srcNames: string[] = [];
  try {
    srcNames = listDir(path.join(folderPath, 'src')).map(n => n.toLowerCase());
  } catch {
    // no src/ folder
  }
  const found: DetectedProject[] = [];
  for (const m of MATCHERS) {
    const matches = (n: string) => (m.exact ? n === m.exact.toLowerCase() : n.endsWith(m.suffix!));
    if (names.some(matches) || (m.suffix === '.java' && srcNames.some(matches))) {
      found.push({ language: m.language, manifest: (m.exact ?? m.suffix)! });
    }
  }
  return found;
}

export function detectLanguages(folderPath: string, listDir?: (p: string) => string[]): Language[] {
  return [...new Set(detectProjects(folderPath, listDir).map(p => p.language))];
}
