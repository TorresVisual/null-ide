'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot } from './widgetTypes';

/** %LOCALAPPDATA%\Null\widgets. Local (not roaming): the file is derived data and the widgets host is per machine. */
export function widgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.LOCALAPPDATA) { throw new Error('Cannot locate %LOCALAPPDATA%.'); }
  return path.win32.join(env.LOCALAPPDATA, 'Null', 'widgets');
}

export class SnapshotStore {
  readonly file: string;
  private readonly tmp: string;
  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'snapshot.json');
    this.tmp = `${this.file}.tmp`;
  }

  /** Write-then-rename, so null_widgets.exe never reads a torn file. Only the owning window writes, so one fixed .tmp name is enough. */
  write(snapshot: Snapshot): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.tmp, JSON.stringify(snapshot), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }

  remove(): void {
    for (const f of [this.file, this.tmp]) {
      try { fs.unlinkSync(f); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; } }
    }
  }
}
