import * as vscode from 'vscode';
import { findExecutable } from './probe';
import type { Probes } from './types';

export const vscodeProbes: Probes = {
  hasExtension: id => vscode.extensions.getExtension(id) !== undefined,
  hasTool: name => findExecutable(name) !== null,
};
