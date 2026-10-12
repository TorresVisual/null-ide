export type Language = 'cpp' | 'rust' | 'node' | 'dotnet';
export type Severity = 'required' | 'recommended';

export type Fix =
  | { kind: 'install'; extensionId: string }
  | { kind: 'url'; url: string };

export interface Requirement {
  id: string;
  label: string;
  /** Languages that make this requirement apply, or `'all'` for every workspace. */
  languages: readonly Language[] | 'all';
  kind: 'extension' | 'tool';
  /** Satisfied when any one of these is present: extension ids, or executable names without extension. */
  anyOf: readonly string[];
  severity: Severity;
  fix: Fix;
}

/** A requirement that is not met. Plain JSON, so it can cross extension hosts as a command result. */
export type Finding = Omit<Requirement, 'languages'>;

/** What `check` needs to know about the machine; bound to `vscode` and the file system in `probes.ts`. */
export interface Probes {
  hasExtension(id: string): boolean;
  hasTool(name: string): boolean;
}
