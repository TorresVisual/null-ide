"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const node_child_process_1 = require("node:child_process");
// `sink` gets the engine's output; `echo` also mirrors it to this process's stdout.
// M1 passes echo=false everywhere; M2 summarizers replace this seam.
function run(plan, sink, echo) {
    return new Promise((resolve) => {
        const started = Date.now();
        let timedOut = false;
        let done = false;
        let timer;
        const finish = (code) => {
            if (done)
                return;
            done = true;
            if (timer)
                clearTimeout(timer);
            resolve({ code, timedOut, seconds: (Date.now() - started) / 1000 });
        };
        const child = (0, node_child_process_1.spawn)(plan.exe, plan.args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const pipe = (chunk) => {
            sink?.write(chunk);
            if (echo)
                process.stdout.write(chunk);
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
                (0, node_child_process_1.spawnSync)('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
            }, plan.timeoutSec * 1000);
        }
    });
}
//# sourceMappingURL=runner.js.map