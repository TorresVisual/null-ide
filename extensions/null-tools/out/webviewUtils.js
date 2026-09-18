'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNonce = getNonce;
function getNonce() {
    let t = '';
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++)
        t += c[Math.floor(Math.random() * c.length)];
    return t;
}
//# sourceMappingURL=webviewUtils.js.map