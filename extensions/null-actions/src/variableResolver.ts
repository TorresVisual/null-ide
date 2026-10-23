'use strict';

export interface VariableContext {
  workspaceFolder?: string;
  file?: string;
  fileBasename?: string;
  fileDirname?: string;
  relativeFile?: string;
  selectedText?: string;
  lineNumber?: string;
  env?: NodeJS.ProcessEnv;
}

const SIMPLE_VARS = [
  'workspaceFolder', 'file', 'fileBasename', 'fileDirname',
  'relativeFile', 'selectedText', 'lineNumber',
] as const;

/** `missing`, when given, collects known variables that had no value (shell-style `${HOME}` is not one). */
export function resolveVariables(template: string, ctx: VariableContext, missing?: string[]): string {
  return template.replace(
    /\$\{([a-zA-Z]+)(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}/g,
    (match, name: string, envVar?: string) => {
      if (name === 'env' && envVar) {
        const value = ctx.env?.[envVar];
        if (value === undefined) { missing?.push(match); }
        return value !== undefined ? value : match;
      }
      if ((SIMPLE_VARS as readonly string[]).includes(name)) {
        const value = ctx[name as (typeof SIMPLE_VARS)[number]];
        if (value === undefined) { missing?.push(match); }
        return value !== undefined ? value : match;
      }
      return match;
    },
  );
}
