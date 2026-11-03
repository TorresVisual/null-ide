import { Engine } from './engine';
import { Uproject } from './uproject';

export type Command = 'build' | 'test' | 'run' | 'smoke';
export interface Options { filter?: string; extraArgs: string[]; platform?: string; resX?: number; resY?: number }
export interface Plan { exe: string; args: string[]; timeoutSec: number | undefined }

// The only place a command line is built. Arguments stay an array; nothing goes through a shell.
export function buildPlan(cmd: Command, engine: Engine, project: Uproject, o: Options): Plan {
  const uproject = project.file;
  switch (cmd) {
    case 'build':
      return {
        exe: engine.automationTool,
        args: ['BuildCookRun', `-project=${uproject}`, `-platform=${o.platform ?? 'Win64'}`, '-build', '-cook', ...o.extraArgs],
        timeoutSec: undefined,
      };
    case 'test': {
      const filter = o.filter ?? `${project.name}.`;
      return {
        exe: engine.editorCmd,
        args: [
          uproject,
          `-ExecCmds=Automation RunTests ${filter}; Quit`,
          '-unattended', '-nullrhi', '-stdout', '-FullStdOutLogOutput',
          ...o.extraArgs,
        ],
        timeoutSec: 600,
      };
    }
    case 'run':
      return {
        exe: engine.editor,
        args: [uproject, '-game', '-windowed', `-ResX=${o.resX ?? 1280}`, `-ResY=${o.resY ?? 720}`, ...o.extraArgs],
        timeoutSec: undefined,
      };
    case 'smoke':
      return {
        exe: engine.editorCmd,
        args: [uproject, '-game', '-nullrhi', '-unattended', '-stdout', '-ExecCmds=Quit', ...o.extraArgs],
        timeoutSec: 120,
      };
  }
}
