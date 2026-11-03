import { spawn, spawnSync } from 'node:child_process';
import { Plan } from './commandLine';

export interface RunResult { code: number | null; timedOut: boolean; seconds: number }

// `sink` gets the engine's output; `echo` also mirrors it to this process's stdout.
// M1 passes echo=false everywhere; M2 summarizers replace this seam.
export function run(plan: Plan, sink: NodeJS.WritableStream | undefined, echo: boolean): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    let done = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, timedOut, seconds: (Date.now() - started) / 1000 });
    };

    const child = spawn(plan.exe, plan.args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: plan.env ? { ...process.env, ...plan.env } : undefined,
    });

    const pipe = (chunk: Buffer) => {
      sink?.write(chunk);
      if (echo) process.stdout.write(chunk);
    };
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);

    child.on('error', (err) => {
      sink?.write(`null-unreal: could not start ${plan.exe}: ${err.message}\n`);
      finish(null);
    });
    child.on('close', (code) => finish(code));

    if (plan.timeoutSec !== undefined && child.pid !== undefined) {
      const pid = child.pid;
      timer = setTimeout(() => {
        timedOut = true;
        // /T takes the whole tree: UAT leaves UBT and cook processes behind.
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
      }, plan.timeoutSec * 1000);
    }
  });
}
