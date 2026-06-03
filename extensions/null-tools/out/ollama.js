'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAlive = isAlive;
exports.models = models;
exports.generate = generate;
exports.chat = chat;
const http = __importStar(require("http"));
function isAlive() {
    return new Promise(resolve => {
        const req = http.request({ method: 'GET', hostname: 'localhost', port: 11434, path: '/api/tags' }, res => { res.resume(); resolve((res.statusCode ?? 500) < 500); });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
        req.end();
    });
}
function models() {
    return new Promise(resolve => {
        const req = http.request({ method: 'GET', hostname: 'localhost', port: 11434, path: '/api/tags' }, res => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve((data.models || []).map(m => m.name || String(m)));
                }
                catch {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.setTimeout(5000, () => { req.destroy(); resolve([]); });
        req.end();
    });
}
function generate(model, prompt, onChunk, signal) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model, prompt, stream: true });
        const req = http.request({
            method: 'POST', hostname: 'localhost', port: 11434, path: '/api/generate',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        }, res => {
            let full = '', buf = '';
            res.on('data', (chunk) => {
                if (signal?.aborted) {
                    req.destroy();
                    return;
                }
                buf += chunk.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        const obj = JSON.parse(line);
                        if (obj.response) {
                            full += obj.response;
                            onChunk?.(obj.response);
                        }
                    }
                    catch { }
                }
            });
            res.on('end', () => resolve(full));
        });
        req.on('error', reject);
        if (signal)
            signal.addEventListener('abort', () => req.destroy());
        req.write(payload);
        req.end();
    });
}
function chat(model, messages, onChunk, signal) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model, messages, stream: true });
        const req = http.request({
            method: 'POST', hostname: 'localhost', port: 11434, path: '/api/chat',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        }, res => {
            let full = '', buf = '';
            res.on('data', (chunk) => {
                if (signal?.aborted) {
                    req.destroy();
                    return;
                }
                buf += chunk.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        const obj = JSON.parse(line);
                        const text = obj.message?.content;
                        if (text) {
                            full += text;
                            onChunk?.(text);
                        }
                    }
                    catch { }
                }
            });
            res.on('end', () => resolve(full));
        });
        req.on('error', reject);
        if (signal)
            signal.addEventListener('abort', () => req.destroy());
        req.write(payload);
        req.end();
    });
}
//# sourceMappingURL=ollama.js.map