'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { repoRoot, resolveProject } from './projectIdentity';
import { WakaProjectResolver } from './wakatimeImport';

/**
 * Matches a WakaTime project to a git repo that still exists on this machine, so imported and native time
 * share one project key. Directories from other machines (or deleted ones) simply do not resolve.
 */
export const diskProjectResolver: WakaProjectResolver = (_projectName, dir) => {
  if (!path.isAbsolute(dir) || !fs.existsSync(dir)) return undefined;
  const root = repoRoot(dir);
  if (!root) return undefined;
  const { key, name } = resolveProject(root);
  return { key, name, root };
};
