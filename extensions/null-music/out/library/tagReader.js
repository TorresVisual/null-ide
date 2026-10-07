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
exports.readTags = readTags;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ponytail: 16 MB art cap — raise only if a real library needs it
const MAX_ART_BYTES = 16 * 1024 * 1024;
// A tag region larger than this is parsed from its first MAX_TAG_BYTES only.
const MAX_TAG_BYTES = MAX_ART_BYTES + 1024 * 1024;
/** Reads a bounded head of the file. Malformed input yields whatever was parsed so far. */
async function readTags(filePath) {
    const tags = {};
    let fh;
    try {
        fh = await fs.promises.open(filePath, 'r');
        switch (path.extname(filePath).toLowerCase()) {
            case '.mp3':
                await readId3(fh, tags);
                break;
            case '.flac':
                await readFlac(fh, tags);
                break;
            case '.ogg':
            case '.opus':
                await readOgg(fh, tags);
                break;
            case '.m4a':
                await readMp4(fh, tags);
                break;
        }
    }
    catch {
        // keep the partial result
    }
    finally {
        await fh?.close().catch(() => { });
    }
    return tags;
}
async function readAt(fh, pos, len) {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, pos);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
}
const num = (s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};
function setArt(tags, data, mime) {
    if (data.length === 0 || data.length > MAX_ART_BYTES)
        return;
    tags.art = { data, ext: /png/i.test(mime) ? 'png' : 'jpg' };
}
// ─── Vorbis comments / FLAC pictures (shared by flac, ogg, opus) ─────────────
function readVorbisComments(buf, pos) {
    const out = [];
    if (pos + 4 > buf.length)
        return out;
    pos += 4 + buf.readUInt32LE(pos); // vendor string
    if (pos + 4 > buf.length)
        return out;
    const count = buf.readUInt32LE(pos);
    pos += 4;
    for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
        const len = buf.readUInt32LE(pos);
        pos += 4;
        if (pos + len > buf.length)
            break;
        out.push(buf.toString('utf8', pos, pos + len));
        pos += len;
    }
    return out;
}
function applyVorbisComments(tags, comments) {
    for (const c of comments) {
        const eq = c.indexOf('=');
        if (eq < 1)
            continue;
        const key = c.slice(0, eq).toUpperCase();
        const value = c.slice(eq + 1).trim();
        if (!value)
            continue;
        switch (key) {
            case 'TITLE':
                tags.title ??= value;
                break;
            case 'ARTIST':
                tags.artist ??= value;
                break;
            case 'ALBUM':
                tags.album ??= value;
                break;
            case 'ALBUMARTIST':
                tags.albumArtist ??= value;
                break;
            case 'TRACKNUMBER':
                tags.trackNo ??= num(value);
                break;
            case 'DISCNUMBER':
                tags.discNo ??= num(value);
                break;
            case 'DATE':
            case 'YEAR':
                tags.year ??= num(value.slice(0, 4));
                break;
            case 'METADATA_BLOCK_PICTURE':
                readFlacPicture(tags, Buffer.from(value, 'base64'));
                break;
        }
    }
}
function readFlacPicture(tags, b) {
    try {
        let p = 4; // picture type
        const mimeLen = b.readUInt32BE(p);
        p += 4;
        const mime = b.toString('latin1', p, p + mimeLen);
        p += mimeLen;
        p += 4 + b.readUInt32BE(p); // description
        p += 16; // width, height, depth, colours
        const dataLen = b.readUInt32BE(p);
        p += 4;
        if (p + dataLen <= b.length)
            setArt(tags, b.subarray(p, p + dataLen), mime);
    }
    catch {
        // a bad picture must not hide the text tags
    }
}
// ─── FLAC ────────────────────────────────────────────────────────────────────
async function readFlac(fh, tags) {
    if ((await readAt(fh, 0, 4)).toString('latin1') !== 'fLaC')
        return;
    let pos = 4;
    for (;;) {
        const head = await readAt(fh, pos, 4);
        if (head.length < 4)
            return;
        const last = (head[0] & 0x80) !== 0;
        const type = head[0] & 0x7f;
        const len = head.readUIntBE(1, 3);
        pos += 4;
        if (type === 0 && len >= 18) {
            const b = await readAt(fh, pos, 18);
            if (b.length === 18) {
                const rate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
                const total = (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14);
                if (rate > 0 && total > 0)
                    tags.durationMs = Math.round((total / rate) * 1000);
            }
        }
        else if (type === 4 && len <= MAX_TAG_BYTES) {
            applyVorbisComments(tags, readVorbisComments(await readAt(fh, pos, len), 0));
        }
        else if (type === 6 && len <= MAX_TAG_BYTES) {
            readFlacPicture(tags, await readAt(fh, pos, len));
        }
        if (last)
            return;
        pos += len;
    }
}
// ─── Ogg / Opus ──────────────────────────────────────────────────────────────
async function readOgg(fh, tags) {
    let pos = 0;
    let packet = [];
    let packetBytes = 0;
    let packetNo = 0;
    for (;;) {
        const h = await readAt(fh, pos, 27);
        if (h.length < 27 || h.toString('latin1', 0, 4) !== 'OggS')
            return;
        const nseg = h[26];
        const lacing = await readAt(fh, pos + 27, nseg);
        if (lacing.length < nseg)
            return;
        const bodyLen = lacing.reduce((a, b) => a + b, 0);
        const body = await readAt(fh, pos + 27 + nseg, bodyLen);
        if (body.length < bodyLen)
            return;
        let off = 0;
        for (const lace of lacing) {
            packet.push(body.subarray(off, off + lace));
            packetBytes += lace;
            off += lace;
            if (lace < 255) {
                if (++packetNo === 2) {
                    parseOggComments(tags, Buffer.concat(packet));
                    return;
                }
                packet = [];
                packetBytes = 0;
            }
        }
        if (packetBytes > MAX_TAG_BYTES)
            return;
        pos += 27 + nseg + bodyLen;
    }
}
function parseOggComments(tags, b) {
    let off;
    if (b.toString('latin1', 0, 8) === 'OpusTags')
        off = 8;
    else if (b[0] === 3 && b.toString('latin1', 1, 7) === 'vorbis')
        off = 7;
    else
        return;
    applyVorbisComments(tags, readVorbisComments(b, off));
}
// ─── MP3 / ID3v2 ─────────────────────────────────────────────────────────────
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
/** Removes the 0x00 inserted after every 0xFF. Returns the input when there is nothing to remove. */
function unsync(b) {
    const parts = [];
    let from = 0;
    for (let i = 0; i + 1 < b.length; i++) {
        if (b[i] === 0xff && b[i + 1] === 0x00) {
            parts.push(b.subarray(from, i + 1));
            from = i + 2;
            i++;
        }
    }
    if (from === 0)
        return b;
    parts.push(b.subarray(from));
    return Buffer.concat(parts);
}
function decodeText(enc, b) {
    let s;
    if (enc === 1 || enc === 2) {
        let body = b;
        let le = true;
        if (enc === 1 && b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)
            body = b.subarray(2);
        else if (enc === 1 && b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
            body = b.subarray(2);
            le = false;
        }
        else if (enc === 2)
            le = false;
        body = body.subarray(0, body.length & ~1);
        s = le ? body.toString('utf16le') : Buffer.from(body).swap16().toString('utf16le');
    }
    else {
        s = b.toString(enc === 3 ? 'utf8' : 'latin1');
    }
    return s.split('\0')[0].trim();
}
const frameText = (frame) => (frame.length > 1 ? decodeText(frame[0], frame.subarray(1)) : '');
/** Index just past the terminator of a string starting at `p` in encoding `enc`. */
function skipTerminated(d, p, enc) {
    if (enc === 1 || enc === 2) {
        for (; p + 1 < d.length; p += 2)
            if (d[p] === 0 && d[p + 1] === 0)
                return p + 2;
        return d.length;
    }
    const end = d.indexOf(0, p);
    return end < 0 ? d.length : end + 1;
}
function readId3Picture(tags, d, v22) {
    if (d.length < 4)
        return;
    const enc = d[0];
    let p = 1;
    let mime;
    if (v22) {
        mime = 'image/' + d.toString('latin1', 1, 4).toLowerCase();
        p = 4;
    }
    else {
        const end = d.indexOf(0, p);
        if (end < 0)
            return;
        mime = d.toString('latin1', p, end);
        p = end + 1;
    }
    const picType = d[p];
    p = skipTerminated(d, p + 1, enc);
    if (!tags.art || picType === 3)
        setArt(tags, d.subarray(p), mime);
}
async function readId3(fh, tags) {
    const head = await readAt(fh, 0, 10);
    if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3')
        return;
    const major = head[3];
    if (major < 2 || major > 4)
        return;
    const flags = head[5];
    let tag = await readAt(fh, 10, Math.min(syncsafe(head, 6), MAX_TAG_BYTES));
    if (major === 3 && flags & 0x80)
        tag = unsync(tag); // 2.3: whole-tag unsynchronisation
    let pos = 0;
    if (flags & 0x40 && tag.length >= 4)
        pos = major === 4 ? syncsafe(tag, 0) : 4 + tag.readUInt32BE(0);
    const idLen = major === 2 ? 3 : 4;
    const headLen = major === 2 ? 6 : 10;
    while (pos + headLen <= tag.length) {
        const id = tag.toString('latin1', pos, pos + idLen);
        if (id.charCodeAt(0) === 0)
            break; // padding
        const size = major === 2 ? tag.readUIntBE(pos + 3, 3) : major === 4 ? syncsafe(tag, pos + 4) : tag.readUInt32BE(pos + 4);
        const fflags = major === 2 ? 0 : tag.readUInt16BE(pos + 8);
        const start = pos + headLen;
        if (start + size > tag.length)
            break;
        let data = tag.subarray(start, start + size);
        pos = start + size;
        if (major === 3) {
            if (fflags & 0x00c0)
                continue; // compressed / encrypted
            if (fflags & 0x0020)
                data = data.subarray(1); // grouping byte
        }
        else if (major === 4) {
            if (fflags & 0x000c)
                continue; // compressed / encrypted
            if (fflags & 0x0040)
                data = data.subarray(1); // grouping byte
            if (fflags & 0x0001)
                data = data.subarray(4); // data length indicator
            if (fflags & 0x0002 || flags & 0x80)
                data = unsync(data);
        }
        const value = id[0] === 'T' ? frameText(data) : '';
        switch (id) {
            case 'TIT2':
            case 'TT2':
                tags.title ??= value || undefined;
                break;
            case 'TPE1':
            case 'TP1':
                tags.artist ??= value || undefined;
                break;
            case 'TPE2':
            case 'TP2':
                tags.albumArtist ??= value || undefined;
                break;
            case 'TALB':
            case 'TAL':
                tags.album ??= value || undefined;
                break;
            case 'TRCK':
            case 'TRK':
                tags.trackNo ??= num(value);
                break;
            case 'TPOS':
            case 'TPA':
                tags.discNo ??= num(value);
                break;
            case 'TDRC':
            case 'TYER':
            case 'TYE':
                tags.year ??= num(value.slice(0, 4));
                break;
            case 'APIC':
            case 'PIC':
                readId3Picture(tags, data, id === 'PIC');
                break;
        }
    }
}
// ─── M4A / MP4 ───────────────────────────────────────────────────────────────
/** Yields `[type, payloadStart, payloadEnd]` for each atom in `b[start, end)`. */
function* atoms(b, start, end) {
    let p = start;
    while (p + 8 <= end) {
        const size = b.readUInt32BE(p);
        if (size < 8 || p + size > end)
            return;
        yield [b.toString('latin1', p + 4, p + 8), p + 8, p + size];
        p += size;
    }
}
function parseIlst(tags, b, start, end) {
    for (const [type, s, e] of atoms(b, start, end)) {
        for (const [t2, s2, e2] of atoms(b, s, e)) {
            if (t2 !== 'data' || e2 - s2 < 8)
                continue;
            const flags = b.readUInt32BE(s2) & 0xffffff; // 1 = UTF-8, 13 = JPEG, 14 = PNG, 0 = implicit
            const v = b.subarray(s2 + 8, e2);
            const str = () => v.toString('utf8').trim();
            switch (type) {
                case '©nam':
                    tags.title ??= str() || undefined;
                    break;
                case '©ART':
                    tags.artist ??= str() || undefined;
                    break;
                case 'aART':
                    tags.albumArtist ??= str() || undefined;
                    break;
                case '©alb':
                    tags.album ??= str() || undefined;
                    break;
                case '©day':
                    tags.year ??= num(str().slice(0, 4));
                    break;
                case 'trkn':
                    if (v.length >= 4)
                        tags.trackNo ??= v.readUInt16BE(2) || undefined;
                    break;
                case 'disk':
                    if (v.length >= 4)
                        tags.discNo ??= v.readUInt16BE(2) || undefined;
                    break;
                case 'covr':
                    if (!tags.art)
                        setArt(tags, v, flags === 14 ? 'png' : 'jpeg');
                    break;
            }
        }
    }
}
function parseMoov(tags, moov) {
    for (const [type, s, e] of atoms(moov, 0, moov.length)) {
        if (type === 'mvhd') {
            const v1 = moov[s] === 1;
            const scale = moov.readUInt32BE(s + (v1 ? 20 : 12));
            const dur = v1 ? Number(moov.readBigUInt64BE(s + 24)) : moov.readUInt32BE(s + 16);
            if (scale > 0 && dur > 0)
                tags.durationMs = Math.round((dur / scale) * 1000);
        }
        else if (type === 'udta') {
            for (const [t2, s2, e2] of atoms(moov, s, e)) {
                if (t2 !== 'meta')
                    continue;
                for (const [t3, s3, e3] of atoms(moov, s2 + 4, e2)) { // meta is a full box: skip version/flags
                    if (t3 === 'ilst')
                        parseIlst(tags, moov, s3, e3);
                }
            }
        }
    }
}
async function readMp4(fh, tags) {
    let pos = 0;
    for (;;) {
        const h = await readAt(fh, pos, 16);
        if (h.length < 8)
            return;
        let size = h.readUInt32BE(0);
        let headLen = 8;
        if (size === 1) {
            if (h.length < 16)
                return;
            size = Number(h.readBigUInt64BE(8));
            headLen = 16;
        }
        if (size < headLen)
            return; // size 0 (to EOF) or corrupt
        if (h.toString('latin1', 4, 8) === 'moov') {
            if (size > MAX_TAG_BYTES * 2)
                return;
            parseMoov(tags, await readAt(fh, pos + headLen, size - headLen));
            return;
        }
        pos += size;
    }
}
//# sourceMappingURL=tagReader.js.map