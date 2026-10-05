'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCreateExtras = runCreateExtras;
/**
 * Runs the steps that follow the REST create call (set the type, link the parent). A failing step never stops the
 * rest and never throws: it is reported by name, so a created issue is never lost to a half-applied form.
 */
async function runCreateExtras(steps) {
    const problems = [];
    for (const step of steps) {
        try {
            await step.run();
        }
        catch (err) {
            problems.push(`couldn't ${step.what} (${err.message})`);
        }
    }
    return problems;
}
//# sourceMappingURL=createExtras.js.map