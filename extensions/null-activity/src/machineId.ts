'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MACHINE_ID_RE } from './types';

/**
 * This installation's id, generated once and kept in `machine.json`. A reinstall or a wiped storage folder is a
 * new machine; the old id stays in the cloud as a separate machine. Never throws: if the file cannot be written
 * the id lasts for this launch only.
 */
export function loadMachineId(dir: string, random: () => string = () => crypto.randomBytes(5).toString('hex')): string {
  const file = path.join(dir, 'machine.json');
  try {
    const id = JSON.parse(fs.readFileSync(file, 'utf8'))?.id;
    if (typeof id === 'string' && MACHINE_ID_RE.test(id)) return id;
  } catch {
    // missing or corrupt: make a new one
  }
  const id = random();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id }));
  } catch {
    // keep the id in memory
  }
  return id;
}
