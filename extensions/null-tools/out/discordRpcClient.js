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
exports.DiscordRpcClient = void 0;
const net = __importStar(require("net"));
const crypto_1 = require("crypto");
const OPCodes = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4,
};
function ipcPath(id) {
    if (process.platform === 'win32') {
        return `\\\\?\\pipe\\discord-ipc-${id}`;
    }
    const prefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
    return `${prefix.replace(/\/$/, '')}/discord-ipc-${id}`;
}
function encode(op, data) {
    const json = JSON.stringify(data);
    const len = Buffer.byteLength(json);
    const packet = Buffer.alloc(8 + len);
    packet.writeInt32LE(op, 0);
    packet.writeInt32LE(len, 4);
    packet.write(json, 8, len);
    return packet;
}
function createDecoder(onFrame) {
    let buffer = Buffer.alloc(0);
    return (socket) => {
        const chunk = socket.read();
        if (!chunk) {
            return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 8) {
            const op = buffer.readInt32LE(0);
            const len = buffer.readInt32LE(4);
            if (buffer.length < 8 + len) {
                break;
            }
            const payload = buffer.subarray(8, 8 + len).toString('utf8');
            buffer = buffer.subarray(8 + len);
            try {
                onFrame({ op, data: JSON.parse(payload) });
            }
            catch {
                // Ignore malformed frames.
            }
        }
    };
}
class DiscordRpcClient {
    clientId;
    socket = null;
    ready = false;
    closed = true;
    pending = new Map();
    constructor(clientId) {
        this.clientId = clientId;
    }
    get isReady() {
        return this.ready;
    }
    async connect() {
        if (!this.closed && this.ready) {
            return;
        }
        await this.disconnect();
        this.closed = false;
        const socket = await this.openSocket(0);
        this.socket = socket;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Discord RPC connection timed out'));
                void this.disconnect();
            }, 10_000);
            const onFrame = ({ op, data }) => {
                if (op === OPCodes.PING) {
                    this.write(OPCodes.PONG, data);
                    return;
                }
                if (op !== OPCodes.FRAME) {
                    return;
                }
                const evt = data.evt;
                const cmd = data.cmd;
                const nonce = data.nonce;
                if (evt === 'READY') {
                    clearTimeout(timeout);
                    this.ready = true;
                    resolve();
                    return;
                }
                if (evt === 'ERROR') {
                    clearTimeout(timeout);
                    const message = data.data?.message ?? 'Discord RPC error';
                    reject(new Error(message));
                    void this.disconnect();
                    return;
                }
                if (cmd && nonce && this.pending.has(nonce)) {
                    const waiter = this.pending.get(nonce);
                    this.pending.delete(nonce);
                    if (evt === 'ERROR') {
                        const message = data.data?.message ?? 'Discord RPC command failed';
                        waiter.reject(new Error(message));
                    }
                    else {
                        waiter.resolve();
                    }
                }
            };
            socket.on('readable', createDecoder(onFrame));
            socket.on('close', () => {
                this.ready = false;
                this.closed = true;
                for (const waiter of this.pending.values()) {
                    waiter.reject(new Error('Discord RPC connection closed'));
                }
                this.pending.clear();
            });
            socket.on('error', () => {
                this.ready = false;
            });
            this.write(OPCodes.HANDSHAKE, { v: 1, client_id: this.clientId });
        });
    }
    async setActivity(activity) {
        if (!this.socket || !this.ready) {
            await this.connect();
        }
        const payload = {
            type: 0,
        };
        if (activity.details) {
            payload.details = activity.details;
        }
        if (activity.state) {
            payload.state = activity.state;
        }
        if (activity.startTimestamp) {
            payload.timestamps = { start: activity.startTimestamp };
        }
        const assets = {};
        if (activity.largeImageKey) {
            assets.large_image = activity.largeImageKey;
        }
        if (activity.largeImageText) {
            assets.large_text = activity.largeImageText;
        }
        if (activity.smallImageKey) {
            assets.small_image = activity.smallImageKey;
        }
        if (activity.smallImageText) {
            assets.small_text = activity.smallImageText;
        }
        if (Object.keys(assets).length > 0) {
            payload.assets = assets;
        }
        if (activity.buttons?.length) {
            payload.buttons = activity.buttons;
        }
        const nonce = (0, crypto_1.randomBytes)(8).toString('hex');
        await new Promise((resolve, reject) => {
            this.pending.set(nonce, { resolve, reject });
            this.write(OPCodes.FRAME, {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity: payload },
                nonce,
            });
            setTimeout(() => {
                if (!this.pending.has(nonce)) {
                    return;
                }
                this.pending.delete(nonce);
                reject(new Error('Discord RPC SET_ACTIVITY timed out'));
            }, 5_000);
        });
    }
    async clearActivity() {
        if (!this.socket || !this.ready) {
            return;
        }
        const nonce = (0, crypto_1.randomBytes)(8).toString('hex');
        await new Promise((resolve, reject) => {
            this.pending.set(nonce, { resolve, reject });
            this.write(OPCodes.FRAME, {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity: null },
                nonce,
            });
            setTimeout(() => {
                if (!this.pending.has(nonce)) {
                    return;
                }
                this.pending.delete(nonce);
                reject(new Error('Discord RPC clear timed out'));
            }, 5_000);
        });
    }
    async disconnect() {
        this.ready = false;
        this.closed = true;
        const socket = this.socket;
        this.socket = null;
        if (!socket) {
            return;
        }
        await new Promise((resolve) => {
            socket.once('close', resolve);
            try {
                socket.write(encode(OPCodes.CLOSE, {}));
                socket.end();
            }
            catch {
                resolve();
            }
            setTimeout(resolve, 250);
        });
    }
    write(op, data) {
        this.socket?.write(encode(op, data));
    }
    openSocket(id) {
        return new Promise((resolve, reject) => {
            if (id > 9) {
                reject(new Error('Discord is not running'));
                return;
            }
            const path = ipcPath(id);
            const socket = net.createConnection(path);
            const onError = () => {
                socket.removeListener('connect', onConnect);
                void this.openSocket(id + 1).then(resolve, reject);
            };
            const onConnect = () => {
                socket.removeListener('error', onError);
                resolve(socket);
            };
            socket.once('error', onError);
            socket.once('connect', onConnect);
        });
    }
}
exports.DiscordRpcClient = DiscordRpcClient;
//# sourceMappingURL=discordRpcClient.js.map