'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface SuggestedButton {
  id: string;
  label: string;
  command: string;
  icon?: string;
}

interface ManifestDetector {
  manifest: string;
  suggestions: SuggestedButton[];
}

const DETECTORS: ManifestDetector[] = [
  {
    manifest: 'Cargo.toml',
    suggestions: [
      { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play' },
      { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools' },
      { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker' },
    ],
  },
  {
    manifest: 'CMakeLists.txt',
    suggestions: [
      { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
      { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
    ],
  },
];

export function detectSuggestedButtons(folderPath: string): SuggestedButton[] {
  const suggestions: SuggestedButton[] = [];

  for (const detector of DETECTORS) {
    if (fs.existsSync(path.join(folderPath, detector.manifest))) {
      suggestions.push(...detector.suggestions);
    }
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    entries = [];
  }
  if (entries.some(f => f.endsWith('.csproj'))) {
    suggestions.push(
      { id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' },
      { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' },
    );
  }

  return suggestions;
}
