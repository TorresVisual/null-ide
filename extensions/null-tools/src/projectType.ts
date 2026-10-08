'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectTypeInfo {
  projectType: string;
  icon: string;
}

// Ordered: the first marker found decides the type.
const MARKERS: Array<{ matches: (names: string[]) => boolean; info: ProjectTypeInfo }> = [
  { matches: names => names.includes('Cargo.toml'), info: { projectType: 'Rust', icon: 'rust' } },
  { matches: names => names.includes('CMakeLists.txt'), info: { projectType: 'CMake', icon: 'cmake' } },
  { matches: names => names.some(name => name.endsWith('.sln') || name.endsWith('.csproj')), info: { projectType: '.NET', icon: 'dotnet' } },
  { matches: names => names.includes('package.json'), info: { projectType: 'Node', icon: 'node' } },
];

/** Synchronous, single readdir of the project root. Returns undefined when nothing is recognised or the folder cannot be read. */
export function detectProjectType(projectPath: string): ProjectTypeInfo | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(path.resolve(projectPath));
  } catch {
    return undefined;
  }
  return MARKERS.find(marker => marker.matches(names))?.info;
}
