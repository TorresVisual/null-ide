'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.serial = serial;
/** Runs the tasks it is given one at a time, in order; a task that fails doesn't stop the ones queued behind it. */
function serial() {
    let tail = Promise.resolve();
    return task => {
        const run = tail.then(task);
        tail = run.catch(() => undefined);
        return run;
    };
}
//# sourceMappingURL=serial.js.map