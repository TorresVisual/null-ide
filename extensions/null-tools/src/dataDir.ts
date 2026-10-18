'use strict';

import * as os from 'os';
import * as path from 'path';

/** Electron's userData folder for this app: %APPDATA%\Null on Windows, $XDG_CONFIG_HOME/Null (~/.config/Null) elsewhere. */
export function nullDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    if (!env.APPDATA) { throw new Error('Cannot locate %APPDATA%.'); }
    return path.win32.join(env.APPDATA, 'Null');
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'Null');
}
