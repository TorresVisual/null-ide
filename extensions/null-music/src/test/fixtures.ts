'use strict';

import { KeyValueStore, Track } from '../types';

export function track(n: number, over: Partial<Track> = {}): Track {
  return {
    id: `local:file:///t${n}.mp3`,
    name: `t${n}`,
    artist: 'a',
    artists: ['a'],
    album: '',
    durationMs: 0,
    uri: `file:///t${n}.mp3`,
    ...over,
  };
}

/** In-memory stand-in for `vscode.Memento`. */
export class MemState implements KeyValueStore {
  readonly map = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return this.map.has(key) ? (this.map.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}

export const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // not a real image; the reader only moves bytes

export const be32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
export const le32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
export const syncsafe = (n: number): Buffer =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** ID3v2.3/2.4 frame (v2.4 sizes are syncsafe). */
export function id3Frame(id: string, body: Buffer, version = 3): Buffer {
  return Buffer.concat([
    Buffer.from(id, 'latin1'),
    version === 4 ? syncsafe(body.length) : be32(body.length),
    Buffer.alloc(2),
    body,
  ]);
}
export const id3Text = (id: string, value: string, version = 3): Buffer =>
  id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]), version);
export const id3Utf16 = (id: string, value: string, version = 3): Buffer =>
  id3Frame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]), version);
export const id3Apic = (data: Buffer, version = 3): Buffer =>
  id3Frame(
    'APIC',
    Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), data]),
    version
  );
export function id3v22Text(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
  return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([0, (body.length >> 8) & 255, body.length & 255]), body]);
}
export function id3Tag(frames: Buffer[], version = 3): Buffer {
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncsafe(body.length), body]);
}

export function flacBlock(type: number, body: Buffer, last = false): Buffer {
  return Buffer.concat([
    Buffer.from([(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]),
    body,
  ]);
}
export function flacStreamInfo(sampleRate: number, totalSamples: number): Buffer {
  const b = Buffer.alloc(34);
  b[10] = (sampleRate >> 12) & 0xff;
  b[11] = (sampleRate >> 4) & 0xff;
  b[12] = (sampleRate & 0x0f) << 4;
  b[13] = Math.floor(totalSamples / 2 ** 32) & 0x0f;
  b.writeUInt32BE(totalSamples % 2 ** 32, 14);
  return b;
}
export function vorbisComments(comments: string[], prefix: Buffer = Buffer.alloc(0)): Buffer {
  const vendor = Buffer.from('null-test');
  return Buffer.concat([
    prefix,
    le32(vendor.length),
    vendor,
    le32(comments.length),
    ...comments.flatMap((c) => [le32(Buffer.byteLength(c)), Buffer.from(c)]),
  ]);
}
export function flacPicture(data: Buffer): Buffer {
  const mime = Buffer.from('image/png');
  return Buffer.concat([be32(3), be32(mime.length), mime, be32(0), Buffer.alloc(16), be32(data.length), data]);
}
export const flacFile = (blocks: Buffer[]): Buffer => Buffer.concat([Buffer.from('fLaC'), ...blocks]);

/** One Ogg page holding one whole packet (packets < 65 KB). */
export function oggPage(packet: Buffer, seq: number): Buffer {
  const lacing: number[] = [];
  for (let n = packet.length; ; n -= 255) {
    if (n >= 255) lacing.push(255);
    else {
      lacing.push(n);
      break;
    }
  }
  const header = Buffer.alloc(27);
  header.write('OggS', 0, 'latin1');
  header.writeUInt32LE(seq, 18);
  header[26] = lacing.length;
  return Buffer.concat([header, Buffer.from(lacing), packet]);
}

export function mp4Atom(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  return Buffer.concat([be32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
export const mp4Item = (type: string, value: Buffer, flags = 1): Buffer =>
  mp4Atom(type, mp4Atom('data', be32(flags), be32(0), value));
