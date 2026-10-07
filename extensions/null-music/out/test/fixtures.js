'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeOutput = exports.tick = exports.mp4Item = exports.flacFile = exports.id3Apic = exports.id3Utf16 = exports.id3Text = exports.syncsafe = exports.le32 = exports.be32 = exports.PNG = exports.MemState = void 0;
exports.track = track;
exports.id3Frame = id3Frame;
exports.id3v22Text = id3v22Text;
exports.id3Tag = id3Tag;
exports.flacBlock = flacBlock;
exports.flacStreamInfo = flacStreamInfo;
exports.vorbisComments = vorbisComments;
exports.flacPicture = flacPicture;
exports.oggPage = oggPage;
exports.mp4Atom = mp4Atom;
const emitter_1 = require("../emitter");
function track(n, over = {}) {
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
class MemState {
    map = new Map();
    get(key, defaultValue) {
        return this.map.has(key) ? this.map.get(key) : defaultValue;
    }
    update(key, value) {
        this.map.set(key, value);
        return Promise.resolve();
    }
}
exports.MemState = MemState;
exports.PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // not a real image; the reader only moves bytes
const be32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
};
exports.be32 = be32;
const le32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
};
exports.le32 = le32;
const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
exports.syncsafe = syncsafe;
/** ID3v2.3/2.4 frame (v2.4 sizes are syncsafe). */
function id3Frame(id, body, version = 3) {
    return Buffer.concat([
        Buffer.from(id, 'latin1'),
        version === 4 ? (0, exports.syncsafe)(body.length) : (0, exports.be32)(body.length),
        Buffer.alloc(2),
        body,
    ]);
}
const id3Text = (id, value, version = 3) => id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]), version);
exports.id3Text = id3Text;
const id3Utf16 = (id, value, version = 3) => id3Frame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]), version);
exports.id3Utf16 = id3Utf16;
const id3Apic = (data, version = 3) => id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), data]), version);
exports.id3Apic = id3Apic;
function id3v22Text(id, value) {
    const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
    return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([0, (body.length >> 8) & 255, body.length & 255]), body]);
}
function id3Tag(frames, version = 3) {
    const body = Buffer.concat(frames);
    return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), (0, exports.syncsafe)(body.length), body]);
}
function flacBlock(type, body, last = false) {
    return Buffer.concat([
        Buffer.from([(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]),
        body,
    ]);
}
function flacStreamInfo(sampleRate, totalSamples) {
    const b = Buffer.alloc(34);
    b[10] = (sampleRate >> 12) & 0xff;
    b[11] = (sampleRate >> 4) & 0xff;
    b[12] = (sampleRate & 0x0f) << 4;
    b[13] = Math.floor(totalSamples / 2 ** 32) & 0x0f;
    b.writeUInt32BE(totalSamples % 2 ** 32, 14);
    return b;
}
function vorbisComments(comments, prefix = Buffer.alloc(0)) {
    const vendor = Buffer.from('null-test');
    return Buffer.concat([
        prefix,
        (0, exports.le32)(vendor.length),
        vendor,
        (0, exports.le32)(comments.length),
        ...comments.flatMap((c) => [(0, exports.le32)(Buffer.byteLength(c)), Buffer.from(c)]),
    ]);
}
function flacPicture(data) {
    const mime = Buffer.from('image/png');
    return Buffer.concat([(0, exports.be32)(3), (0, exports.be32)(mime.length), mime, (0, exports.be32)(0), Buffer.alloc(16), (0, exports.be32)(data.length), data]);
}
const flacFile = (blocks) => Buffer.concat([Buffer.from('fLaC'), ...blocks]);
exports.flacFile = flacFile;
/** One Ogg page holding one whole packet (packets < 65 KB). */
function oggPage(packet, seq) {
    const lacing = [];
    for (let n = packet.length;; n -= 255) {
        if (n >= 255)
            lacing.push(255);
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
function mp4Atom(type, ...children) {
    const body = Buffer.concat(children);
    return Buffer.concat([(0, exports.be32)(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
const mp4Item = (type, value, flags = 1) => mp4Atom(type, mp4Atom('data', (0, exports.be32)(flags), (0, exports.be32)(0), value));
exports.mp4Item = mp4Item;
const tick = () => new Promise((resolve) => setImmediate(resolve));
exports.tick = tick;
/** Scriptable AudioOutput: records every command as a string and lets tests fire events. */
class FakeOutput {
    emitter = new emitter_1.Emitter();
    onEvent = this.emitter.event;
    isReady = false;
    failReady = false;
    readyChecks = 0;
    calls = [];
    waiters = [];
    ensureReady() {
        this.readyChecks++;
        if (this.isReady)
            return Promise.resolve();
        if (this.failReady)
            return Promise.reject(new Error('timeout'));
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
    /** Mirrors the real output: the 'ready' event first, then waiting commands continue. */
    becomeReady() {
        this.isReady = true;
        this.emit({ type: 'ready' });
        for (const w of this.waiters.splice(0))
            w.resolve();
    }
    emit(e) {
        this.emitter.fire(e);
    }
    load(track, opts) {
        this.calls.push(`load ${track.uri} @${opts.startMs} ${opts.autoplay ? 'play' : 'paused'}`);
    }
    play() {
        this.calls.push('play');
    }
    pause() {
        this.calls.push('pause');
    }
    seek(ms) {
        this.calls.push(`seek ${ms}`);
    }
    setVolume(pct) {
        this.calls.push(`volume ${pct}`);
    }
}
exports.FakeOutput = FakeOutput;
//# sourceMappingURL=fixtures.js.map