'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Capture = exports.SETTLE_DELAY_MS = void 0;
const buildReport_1 = require("./buildReport");
exports.SETTLE_DELAY_MS = 30_000;
/**
 * One report per launch: written right after startup, then rewritten under the same id once late
 * activations have settled. Extension status is cumulative, so the later snapshot supersedes the first.
 */
class Capture {
    deps;
    timer;
    constructor(deps) {
        this.deps = deps;
    }
    async run() {
        const id = `${this.deps.now()}-${this.deps.windowId}`;
        if (!(await this.write(id)))
            return;
        this.timer = this.deps.schedule(() => void this.write(id), exports.SETTLE_DELAY_MS);
    }
    dispose() {
        this.timer?.dispose();
    }
    async write(id) {
        try {
            const snapshot = await this.deps.snapshot();
            if (!snapshot)
                return false;
            await this.deps.save((0, buildReport_1.buildReport)(snapshot, { id, windowId: this.deps.windowId }));
            this.deps.onSaved();
            return true;
        }
        catch (err) {
            this.deps.log(`startup report failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
}
exports.Capture = Capture;
//# sourceMappingURL=capture.js.map