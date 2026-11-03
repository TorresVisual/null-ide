"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withLock = withLock;
const uproject_1 = require("./uproject");
// One engine run per project at a time, across processes. A lock whose PID is dead is taken over.
async function withLock(file, io, fn, waitMs = 600_000) {
    const started = io.now();
    while (!io.create(file, JSON.stringify({ pid: io.pid, started: started }))) {
        const held = io.read(file);
        let pid;
        try {
            pid = held === undefined ? undefined : JSON.parse(held).pid;
        }
        catch {
            pid = undefined;
        }
        // A missing or unreadable lock is stale too: the owner died mid-write or removed it.
        if (typeof pid !== 'number' || !io.alive(pid)) {
            io.remove(file);
            continue;
        }
        if (io.now() - started > waitMs) {
            throw new uproject_1.ResolveError(`another export (pid ${pid}) has held ${file} for more than ${Math.round(waitMs / 1000)}s`);
        }
        await io.sleep(500);
    }
    try {
        return await fn();
    }
    finally {
        io.remove(file);
    }
}
//# sourceMappingURL=lock.js.map