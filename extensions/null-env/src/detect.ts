import * as fs from 'node:fs';
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
];

const defaultListDir = (folderPath: string): string[] => fs.readdirSync(folderPath);

export function detectProjects(folderPath: string, listDir: (p: string) => string[] = defaultListDir): DetectedProject[] {
  let names: string[];
  try {
    names = listDir(folderPath).map(n => n.toLowerCase());
  } catch {
    return [];
  }
  const found: DetectedProject[] = [];
  for (const m of MATCHERS) {
    const hit = names.some(n => (m.exact ? n === m.exact.toLowerCase() : n.endsWith(m.suffix!)));
    if (hit) {
      found.push({ language: m.language, manifest: (m.exact ?? m.suffix)! });
    }
  }
  return found;
}

export function detectLanguages(folderPath: string, listDir?: (p: string) => string[]): Language[] {
  return [...new Set(detectProjects(folderPath, listDir).map(p => p.language))];
}
