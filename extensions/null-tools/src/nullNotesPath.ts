import * as path from 'path';

export function resolveNullNotesExePath(override: string, localAppData: string): string {
  return override.trim() || path.join(localAppData, 'null-notes', 'null-notes.exe');
}
