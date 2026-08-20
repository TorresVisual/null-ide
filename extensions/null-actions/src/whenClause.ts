'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { WhenClauseConfig } from './buttonConfig';

export interface WhenClauseContext {
  activeLanguageId?: string;
  folderName?: string;
  folderPath?: string;
}

export function evaluateWhenClause(when: WhenClauseConfig | undefined, ctx: WhenClauseContext): boolean {
  if (!when) { return true; }

  if (when.folder !== undefined && when.folder !== ctx.folderName) {
    return false;
  }

  if (when.languages && when.languages.length > 0) {
    if (!ctx.activeLanguageId || !when.languages.includes(ctx.activeLanguageId)) {
      return false;
    }
  }

  if (when.filesExist && when.filesExist.length > 0) {
    if (!ctx.folderPath) { return false; }
    for (const rel of when.filesExist) {
      if (!fs.existsSync(path.join(ctx.folderPath, rel))) {
        return false;
      }
    }
  }

  return true;
}
