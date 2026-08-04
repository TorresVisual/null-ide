"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const symbolSwitch_1 = require("./symbolSwitch");
const pairedSplit_1 = require("./pairedSplit");
const scaffold_1 = require("./scaffold");
function activate(context) {
    (0, symbolSwitch_1.registerSwitchSourceHeader)(context);
    (0, pairedSplit_1.registerPairedSplit)(context);
    (0, scaffold_1.registerNewClass)(context);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map