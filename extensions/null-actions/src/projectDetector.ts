'use strict';

export interface SuggestedButton {
  id: string;
  label: string;
  command: string;
  icon?: string;
  problemMatcher?: string;
}

/** One manifest found in a folder; produced by null-env's `detectProjects`. */
export interface DetectedProject {
  language: string;
  manifest: string;
}

export type ProjectDetector = (folderPath: string) => readonly DetectedProject[];

const SUGGESTIONS_BY_MANIFEST: Record<string, SuggestedButton[]> = {
  'Cargo.toml': [
    { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play', problemMatcher: '$null-rustc' },
    { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools', problemMatcher: '$null-rustc' },
    { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker', problemMatcher: '$null-rustc' },
  ],
  'CMakeLists.txt': [
    { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
    { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
  ],
  '.csproj': [
    { id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' },
    { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' },
  ],
};

/** Which manifests exist is null-env's job (`detect`); this only maps them to buttons. */
export function detectSuggestedButtons(folderPath: string, detect: ProjectDetector): SuggestedButton[] {
  return detect(folderPath).flatMap(project => SUGGESTIONS_BY_MANIFEST[project.manifest] ?? []);
}
