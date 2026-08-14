'use strict';

import * as net from 'net';
import { randomBytes } from 'crypto';

const OPCodes = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

function ipcPath(id: number): string {
  if (process.platform === 'win32') {
    return `\\\\?\\pipe\\discord-ipc-${id}`;
  }
  const prefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return `${prefix.replace(/\/$/, '')}/discord-ipc-${id}`;
}

function encode(op: number, data: unknown): Buffer {
  const json = JSON.stringify(data);
  const len = Buffer.byteLength(json);
  const packet = Buffer.alloc(8 + len);
  packet.writeInt32LE(op, 0);
  packet.writeInt32LE(len, 4);
  packet.write(json, 8, len);
  return packet;
}

interface RpcFrame {
  op: number;
  data: Record<string, unknown>;
}

function createDecoder(onFrame: (frame: RpcFrame) => void): (socket: net.Socket) => void {
  let buffer = Buffer.alloc(0);

  return (socket: net.Socket) => {
    const chunk = socket.read();
    if (!chunk) { return; }

    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0);
      const len = buffer.readInt32LE(4);
      if (buffer.length < 8 + len) { break; }

      const payload = buffer.subarray(8, 8 + len).toString('utf8');
      buffer = buffer.subarray(8 + len);

      try {
        onFrame({ op, data: JSON.parse(payload) as Record<string, unknown> });
      } catch {
        // Ignore malformed frames.
      }
    }
  };
}

export interface DiscordActivity {
  details?: string;
  state?: string;
  startTimestamp?: number;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
  buttons?: { label: string; url: string }[];
}

export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private ready = false;
  private closed = true;
  private readonly pending = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

  constructor(private readonly clientId: string) {}

  get isReady(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (!this.closed && this.ready) { return; }

    await this.disconnect();
    this.closed = false;

    const socket = await this.openSocket(0);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord RPC connection timed out'));
        void this.disconnect();
      }, 10_000);

      const onFrame = ({ op, data }: RpcFrame) => {
        if (op === OPCodes.PING) {
          this.write(OPCodes.PONG, data);
          return;
        }
        if (op !== OPCodes.FRAME) { return; }

        const evt = data.evt as string | undefined;
        const cmd = data.cmd as string | undefined;
        const nonce = data.nonce as string | undefined;

        if (evt === 'READY') {
          clearTimeout(timeout);
          this.ready = true;
          resolve();
          return;
        }

        if (evt === 'ERROR') {
          clearTimeout(timeout);
          const message = (data.data as { message?: string } | undefined)?.message ?? 'Discord RPC error';
          reject(new Error(message));
          void this.disconnect();
          return;
        }

        if (cmd && nonce && this.pending.has(nonce)) {
          const waiter = this.pending.get(nonce)!;
          this.pending.delete(nonce);
          if (evt === 'ERROR') {
            const message = (data.data as { message?: string } | undefined)?.message ?? 'Discord RPC command failed';
            waiter.reject(new Error(message));
          } else {
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

  async setActivity(activity: DiscordActivity): Promise<void> {
    if (!this.socket || !this.ready) {
      await this.connect();
    }

    const payload: Record<string, unknown> = {
      type: 0,
    };

    if (activity.details) { payload.details = activity.details; }
    if (activity.state) { payload.state = activity.state; }
    if (activity.startTimestamp) {
      payload.timestamps = { start: activity.startTimestamp };
    }

    const assets: Record<string, string> = {};
    if (activity.largeImageKey) { assets.large_image = activity.largeImageKey; }
    if (activity.largeImageText) { assets.large_text = activity.largeImageText; }
    if (activity.smallImageKey) { assets.small_image = activity.smallImageKey; }
    if (activity.smallImageText) { assets.small_text = activity.smallImageText; }
    if (Object.keys(assets).length > 0) { payload.assets = assets; }
    if (activity.buttons?.length) { payload.buttons = activity.buttons; }

    const nonce = randomBytes(8).toString('hex');
    await new Promise<void>((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      this.write(OPCodes.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: payload },
        nonce,
      });
      setTimeout(() => {
        if (!this.pending.has(nonce)) { return; }
        this.pending.delete(nonce);
        reject(new Error('Discord RPC SET_ACTIVITY timed out'));
      }, 5_000);
    });
  }

  async clearActivity(): Promise<void> {
    if (!this.socket || !this.ready) { return; }

    const nonce = randomBytes(8).toString('hex');
    await new Promise<void>((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      this.write(OPCodes.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce,
      });
      setTimeout(() => {
        if (!this.pending.has(nonce)) { return; }
        this.pending.delete(nonce);
        reject(new Error('Discord RPC clear timed out'));
      }, 5_000);
    });
  }

  async disconnect(): Promise<void> {
    this.ready = false;
    this.closed = true;

    const socket = this.socket;
    this.socket = null;
    if (!socket) { return; }

    await new Promise<void>((resolve) => {
      socket.once('close', resolve);
      try {
        socket.write(encode(OPCodes.CLOSE, {}));
        socket.end();
      } catch {
        resolve();
      }
      setTimeout(resolve, 250);
    });
  }

  private write(op: number, data: unknown): void {
    this.socket?.write(encode(op, data));
  }

  private openSocket(id: number): Promise<net.Socket> {
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
