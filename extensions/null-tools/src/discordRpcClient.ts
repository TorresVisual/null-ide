'use strict';

import * as net from 'net';
import { randomBytes } from 'crypto';
import WebSocket from 'ws';

const OPCodes = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

/** How long a single pipe/port probe may take before we move on. */
const PROBE_TIMEOUT_MS = 1_500;
/** How long to wait for Discord to acknowledge a command. */
const REQUEST_TIMEOUT_MS = 5_000;
/** Discord listens on discord-ipc-0 … discord-ipc-9. */
const IPC_PIPE_COUNT = 10;
/** Discord's RPC WebSocket ports are 6463 … 6472. */
const WS_PORT_FIRST = 6463;
const WS_PORT_COUNT = 10;
/** Guard against a desynced stream making us allocate absurd buffers. */
const MAX_FRAME_BYTES = 1024 * 1024;

type TransportKind = 'ipc' | 'websocket';
type LogFn = (message: string) => void;

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

interface RpcMessage {
  cmd?: string;
  evt?: string;
  nonce?: string;
  data?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface Frame {
  op: number;
  payload: string;
}

function parseCloseError(data: Record<string, unknown>): string {
  const message = data.message as string | undefined;
  const code = data.code as number | undefined;
  if (message && code !== undefined) {
    return `${message} (code ${code})`;
  }
  return message ?? 'Discord closed the connection';
}

function isReadyMessage(message: RpcMessage): boolean {
  return message.cmd === 'DISPATCH' && message.evt === 'READY';
}

function isErrorMessage(message: RpcMessage): boolean {
  return message.evt === 'ERROR';
}

function errorText(message: RpcMessage): string {
  const data = message.data as { message?: string; code?: number } | undefined;
  if (data?.message && data.code !== undefined) {
    return `${data.message} (code ${data.code})`;
  }
  return data?.message ?? 'Discord RPC error';
}

/**
 * Incrementally decodes Discord's length-prefixed IPC framing. Kept separate
 * from the socket so a connection probe can hand its partially-filled decoder
 * over to the live client without dropping bytes that already arrived.
 */
class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);

      if (len < 0 || len > MAX_FRAME_BYTES) {
        // The stream is desynced; nothing sensible left to read.
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < 8 + len) { break; }

      frames.push({ op, payload: this.buffer.subarray(8, 8 + len).toString('utf8') });
      this.buffer = this.buffer.subarray(8 + len);
    }

    return frames;
  }
}

interface IpcProbeResult {
  socket: net.Socket;
  decoder: FrameDecoder;
  pipeId: number;
}

async function probeIpcPipe(clientId: string, pipeId: number, log: LogFn): Promise<IpcProbeResult> {
  const path = ipcPath(pipeId);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const decoder = new FrameDecoder();
    let settled = false;

    const onData = (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        if (settled) { return; }

        if (frame.op === OPCodes.CLOSE) {
          try {
            finish(new Error(parseCloseError(JSON.parse(frame.payload) as Record<string, unknown>)));
          } catch {
            finish(new Error(frame.payload || 'Discord closed the connection'));
          }
          return;
        }
        if (frame.op !== OPCodes.FRAME) { continue; }

        let message: RpcMessage;
        try {
          message = JSON.parse(frame.payload) as RpcMessage;
        } catch {
          continue;
        }

        if (isReadyMessage(message)) {
          log(`Connected over IPC pipe ${pipeId}.`);
          finish(undefined, { socket, decoder, pipeId });
          return;
        }
        if (isErrorMessage(message)) {
          finish(new Error(errorText(message)));
          return;
        }
      }
    };

    const onError = (err: Error) => finish(new Error(err.message || 'pipe connection failed'));
    const onClose = () => finish(new Error('pipe closed before READY'));
    const onConnect = () => {
      socket.write(encode(OPCodes.HANDSHAKE, { v: 1, client_id: clientId }));
    };

    const finish = (err?: Error, result?: IpcProbeResult) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      // Detach probe-scoped handlers so the live client owns the socket alone.
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.off('connect', onConnect);

      if (err) {
        socket.destroy();
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    const timer = setTimeout(() => finish(new Error('timed out')), PROBE_TIMEOUT_MS);

    socket.on('connect', onConnect);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function probeWebSocket(clientId: string, port: number, log: LogFn): Promise<WebSocket> {
  const url = `ws://127.0.0.1:${port}/?v=1&client_id=${clientId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin: 'https://discord.com' });
    let settled = false;

    const onMessage = (raw: WebSocket.RawData) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(raw.toString()) as RpcMessage;
      } catch {
        return;
      }

      if (isReadyMessage(message)) {
        log(`Connected over WebSocket port ${port}.`);
        finish(undefined, ws);
        return;
      }
      if (isErrorMessage(message)) {
        finish(new Error(errorText(message)));
      }
    };

    const onError = () => finish(new Error('websocket connection failed'));
    const onClose = () => finish(new Error('websocket closed before READY'));

    const finish = (err?: Error, readySocket?: WebSocket) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);

      if (err) {
        try { ws.close(); } catch { /* already closing */ }
        reject(err);
      } else if (readySocket) {
        resolve(readySocket);
      }
    };

    const timer = setTimeout(() => finish(new Error('timed out')), PROBE_TIMEOUT_MS);

    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
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
  private websocket: WebSocket | null = null;
  private transport: TransportKind | null = null;
  private ready = false;
  private connecting: Promise<void> | null = null;
  /** Endpoint that worked last time — retried first so reconnects are cheap. */
  private preferredPipeId: number | null = null;
  private preferredWsPort: number | null = null;
  private readonly pending = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

  constructor(
    private readonly clientId: string,
    private readonly log: LogFn = () => undefined,
    private readonly transportPreference: 'auto' | 'ipc' | 'websocket' = 'auto',
    /** Fired when an established connection drops on its own. */
    private readonly onDisconnect: (reason: string) => void = () => undefined,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  /** Which transport the live connection uses — surfaced by the test command. */
  get transportKind(): TransportKind | null {
    return this.transport;
  }

  async connect(): Promise<void> {
    if (this.ready) { return; }
    if (this.connecting) { return this.connecting; }

    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<void> {
    await this.disconnect(true);

    const errors: string[] = [];

    if (this.transportPreference !== 'websocket') {
      for (const pipeId of this.pipeOrder()) {
        try {
          const { socket, decoder } = await probeIpcPipe(this.clientId, pipeId, this.log);
          this.socket = socket;
          this.transport = 'ipc';
          this.preferredPipeId = pipeId;
          this.attachIpcHandlers(socket, decoder);
          this.ready = true;
          return;
        } catch (err) {
          errors.push(`ipc-${pipeId}: ${(err as Error).message}`);
        }
      }
      this.preferredPipeId = null;
    }

    if (this.transportPreference !== 'ipc') {
      for (const port of this.portOrder()) {
        try {
          const ws = await probeWebSocket(this.clientId, port, this.log);
          this.websocket = ws;
          this.transport = 'websocket';
          this.preferredWsPort = port;
          this.attachWebSocketHandlers(ws);
          this.ready = true;
          return;
        } catch (err) {
          errors.push(`ws-${port}: ${(err as Error).message}`);
        }
      }
      this.preferredWsPort = null;
    }

    // Every endpoint refusing the connection means Discord simply isn't there;
    // surfacing ten identical ENOENT lines helps nobody.
    const detail = errors.every((e) => /ENOENT|ECONNREFUSED|connection failed/i.test(e))
      ? ''
      : `\n${errors.slice(0, 4).join('\n')}`;

    throw new Error(
      'Could not reach Discord. Make sure the Discord desktop app is running (the browser version has no RPC endpoint).'
      + detail,
    );
  }

  /** Retry the endpoint that worked last time before sweeping the rest. */
  private pipeOrder(): number[] {
    const all = Array.from({ length: IPC_PIPE_COUNT }, (_, i) => i);
    if (this.preferredPipeId === null) { return all; }
    return [this.preferredPipeId, ...all.filter((id) => id !== this.preferredPipeId)];
  }

  private portOrder(): number[] {
    const all = Array.from({ length: WS_PORT_COUNT }, (_, i) => WS_PORT_FIRST + i);
    if (this.preferredWsPort === null) { return all; }
    return [this.preferredWsPort, ...all.filter((p) => p !== this.preferredWsPort)];
  }

  private attachIpcHandlers(socket: net.Socket, decoder: FrameDecoder): void {
    socket.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(frame.payload) as Record<string, unknown>;
        } catch {
          if (frame.op !== OPCodes.CLOSE) { continue; }
          data = { message: frame.payload };
        }
        this.handleMessage(frame.op, data);
      }
    });

    socket.on('close', () => this.handleDrop('Discord RPC connection closed'));
    socket.on('error', (err) => this.handleDrop(err.message || 'Discord RPC socket error'));
  }

  private attachWebSocketHandlers(ws: WebSocket): void {
    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        this.handleMessage(OPCodes.FRAME, JSON.parse(raw.toString()) as Record<string, unknown>);
      } catch {
        // Ignore malformed frames.
      }
    });
    ws.on('close', () => this.handleDrop('Discord RPC connection closed'));
    ws.on('error', () => this.handleDrop('Discord RPC websocket error'));
  }

  /** A live connection went away without us asking it to. */
  private handleDrop(reason: string): void {
    const wasReady = this.ready;
    this.ready = false;
    this.rejectPending(new Error(reason));
    if (wasReady) {
      this.onDisconnect(reason);
    }
  }

  private handleMessage(op: number, data: Record<string, unknown>): void {
    if (op === OPCodes.CLOSE) {
      this.handleDrop(parseCloseError(data));
      return;
    }
    if (op === OPCodes.PING) {
      this.write(OPCodes.PONG, data);
      return;
    }
    if (op !== OPCodes.FRAME) { return; }

    const message = data as RpcMessage;
    if (isErrorMessage(message)) {
      const err = new Error(errorText(message));
      const waiter = message.nonce ? this.pending.get(message.nonce) : undefined;
      if (waiter && message.nonce) {
        // A rejected command (bad asset key, oversized field) is not a dead
        // connection — fail just that request and keep the socket.
        this.pending.delete(message.nonce);
        waiter.reject(err);
        return;
      }
      this.handleDrop(err.message);
      return;
    }

    if (message.cmd && message.nonce) {
      const waiter = this.pending.get(message.nonce);
      if (waiter) {
        this.pending.delete(message.nonce);
        waiter.resolve();
      }
    }
  }

  async setActivity(activity: DiscordActivity): Promise<void> {
    if (!this.ready) {
      await this.connect();
    }

    // Field names and shape follow Discord's documented SET_ACTIVITY payload.
    // `name` is deliberately absent: Discord always uses the application's own
    // name from the Developer Portal and ignores anything we send.
    const payload: Record<string, unknown> = {
      type: 0,
      instance: false,
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

    await this.request('SET_ACTIVITY', {
      pid: process.pid,
      activity: payload,
    });
  }

  async clearActivity(): Promise<void> {
    if (!this.ready) { return; }
    await this.request('SET_ACTIVITY', { pid: process.pid });
  }

  async disconnect(silent = false): Promise<void> {
    this.ready = false;
    this.rejectPending(new Error('Discord RPC disconnected'));

    const socket = this.socket;
    const ws = this.websocket;
    this.socket = null;
    this.websocket = null;
    this.transport = null;

    if (socket) {
      // We are tearing this down on purpose — the close handler must not
      // report it as an unexpected drop and trigger a reconnect.
      socket.removeAllListeners('close');
      socket.removeAllListeners('error');
      socket.on('error', () => undefined);
      await closeWithTimeout((done) => {
        socket.once('close', done);
        try {
          socket.write(encode(OPCodes.CLOSE, {}));
          socket.end();
        } catch {
          socket.destroy();
          done();
        }
      });
      socket.destroy();
    }

    if (ws) {
      ws.removeAllListeners('close');
      ws.removeAllListeners('error');
      ws.on('error', () => undefined);
      await closeWithTimeout((done) => {
        ws.once('close', done);
        try { ws.close(); } catch { done(); }
      });
      ws.terminate();
    }

    if (!silent) {
      this.log('Disconnected from Discord.');
    }
  }

  private rejectPending(err: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(err);
    }
    this.pending.clear();
  }

  private request(cmd: string, args: Record<string, unknown>): Promise<void> {
    const nonce = randomBytes(8).toString('hex');

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(nonce)) { return; }
        reject(new Error(`Discord RPC ${cmd} timed out`));
      }, REQUEST_TIMEOUT_MS);

      const settle = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };

      this.pending.set(nonce, {
        resolve: () => settle(resolve),
        reject: (err) => settle(() => reject(err)),
      });

      try {
        this.sendFrame({ cmd, args, nonce });
      } catch (err) {
        this.pending.delete(nonce);
        settle(() => reject(err as Error));
      }
    });
  }

  private sendFrame(payload: RpcMessage): void {
    if (this.transport === 'ipc') {
      if (!this.socket || this.socket.destroyed) {
        throw new Error('Discord RPC socket is not connected');
      }
      this.write(OPCodes.FRAME, payload);
      return;
    }
    if (this.transport === 'websocket') {
      if (this.websocket?.readyState !== WebSocket.OPEN) {
        throw new Error('Discord RPC websocket is not open');
      }
      this.websocket.send(JSON.stringify(payload));
      return;
    }
    throw new Error('Discord RPC is not connected');
  }

  private write(op: number, data: unknown): void {
    this.socket?.write(encode(op, data));
  }
}

/** Resolves when `begin` reports done, or after a short grace period. */
function closeWithTimeout(begin: (done: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 250);
    begin(done);
  });
}
