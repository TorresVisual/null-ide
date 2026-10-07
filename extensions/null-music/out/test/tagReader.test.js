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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = require("node:test");
const tagReader_1 = require("../library/tagReader");
const fixtures_1 = require("./fixtures");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-tags-'));
(0, node_test_1.after)(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const write = (ext, data) => {
    const f = path.join(dir, `f${n++}${ext}`);
    fs.writeFileSync(f, data);
    return f;
};
(0, node_test_1.test)('mp3: ID3v2.3 latin1/utf-8/utf-16 frames and front cover', async () => {
    const t = await (0, tagReader_1.readTags)(write('.mp3', (0, fixtures_1.id3Tag)([
        (0, fixtures_1.id3Text)('TIT2', 'Song'), (0, fixtures_1.id3Utf16)('TPE1', 'Bänd'), (0, fixtures_1.id3Text)('TALB', 'LP'), (0, fixtures_1.id3Text)('TPE2', 'Various'),
        (0, fixtures_1.id3Text)('TRCK', '3/12'), (0, fixtures_1.id3Text)('TPOS', '1/2'), (0, fixtures_1.id3Text)('TYER', '2019'), (0, fixtures_1.id3Apic)(fixtures_1.PNG),
    ])));
    node_assert_1.default.strictEqual(t.title, 'Song');
    node_assert_1.default.strictEqual(t.artist, 'Bänd');
    node_assert_1.default.strictEqual(t.album, 'LP');
    node_assert_1.default.strictEqual(t.albumArtist, 'Various');
    node_assert_1.default.strictEqual(t.trackNo, 3);
    node_assert_1.default.strictEqual(t.discNo, 1);
    node_assert_1.default.strictEqual(t.year, 2019);
    node_assert_1.default.strictEqual(t.art?.ext, 'png');
    node_assert_1.default.deepStrictEqual(t.art?.data, fixtures_1.PNG);
});
(0, node_test_1.test)('mp3: ID3v2.4 (syncsafe sizes, TDRC) and ID3v2.2', async () => {
    const v24 = await (0, tagReader_1.readTags)(write('.mp3', (0, fixtures_1.id3Tag)([(0, fixtures_1.id3Text)('TIT2', 'Four', 4), (0, fixtures_1.id3Text)('TDRC', '2020-05-01', 4), (0, fixtures_1.id3Apic)(fixtures_1.PNG, 4)], 4)));
    node_assert_1.default.strictEqual(v24.title, 'Four');
    node_assert_1.default.strictEqual(v24.year, 2020);
    node_assert_1.default.deepStrictEqual(v24.art?.data, fixtures_1.PNG);
    const v22 = await (0, tagReader_1.readTags)(write('.mp3', (0, fixtures_1.id3Tag)([(0, fixtures_1.id3v22Text)('TT2', 'Two'), (0, fixtures_1.id3v22Text)('TP1', 'Old Band')], 2)));
    node_assert_1.default.strictEqual(v22.title, 'Two');
    node_assert_1.default.strictEqual(v22.artist, 'Old Band');
});
(0, node_test_1.test)('mp3: ID3v2.3 whole-tag unsynchronisation', async () => {
    const frame = Buffer.concat([Buffer.from('TIT2'), (0, fixtures_1.be32)(3), Buffer.alloc(2), Buffer.from([0, 0xff, 0x00, 0x61])]);
    const file = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0x80]), (0, fixtures_1.syncsafe)(frame.length), frame]);
    node_assert_1.default.strictEqual((await (0, tagReader_1.readTags)(write('.mp3', file))).title, 'ÿa');
});
(0, node_test_1.test)('flac: STREAMINFO duration, vorbis comments and picture', async () => {
    const t = await (0, tagReader_1.readTags)(write('.flac', (0, fixtures_1.flacFile)([
        (0, fixtures_1.flacBlock)(0, (0, fixtures_1.flacStreamInfo)(44100, 441000)),
        (0, fixtures_1.flacBlock)(4, (0, fixtures_1.vorbisComments)(['TITLE=Flac Song', 'ARTIST=Band', 'ALBUM=LP', 'ALBUMARTIST=VA', 'TRACKNUMBER=7', 'DISCNUMBER=2', 'DATE=2001-02-03'])),
        (0, fixtures_1.flacBlock)(6, (0, fixtures_1.flacPicture)(fixtures_1.PNG), true),
    ])));
    node_assert_1.default.strictEqual(t.durationMs, 10000);
    node_assert_1.default.strictEqual(t.title, 'Flac Song');
    node_assert_1.default.strictEqual(t.artist, 'Band');
    node_assert_1.default.strictEqual(t.album, 'LP');
    node_assert_1.default.strictEqual(t.albumArtist, 'VA');
    node_assert_1.default.strictEqual(t.trackNo, 7);
    node_assert_1.default.strictEqual(t.discNo, 2);
    node_assert_1.default.strictEqual(t.year, 2001);
    node_assert_1.default.deepStrictEqual(t.art?.data, fixtures_1.PNG);
});
(0, node_test_1.test)('opus and ogg vorbis: comment header and base64 picture', async () => {
    const pic = `METADATA_BLOCK_PICTURE=${(0, fixtures_1.flacPicture)(fixtures_1.PNG).toString('base64')}`;
    const opus = Buffer.concat([
        (0, fixtures_1.oggPage)(Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11)]), 0),
        (0, fixtures_1.oggPage)((0, fixtures_1.vorbisComments)(['TITLE=Opus Song', 'ARTIST=Band', pic], Buffer.from('OpusTags')), 1),
    ]);
    const o = await (0, tagReader_1.readTags)(write('.opus', opus));
    node_assert_1.default.strictEqual(o.title, 'Opus Song');
    node_assert_1.default.strictEqual(o.artist, 'Band');
    node_assert_1.default.deepStrictEqual(o.art?.data, fixtures_1.PNG);
    const vorbis = Buffer.concat([
        (0, fixtures_1.oggPage)(Buffer.concat([Buffer.from([1]), Buffer.from('vorbis'), Buffer.alloc(23)]), 0),
        (0, fixtures_1.oggPage)((0, fixtures_1.vorbisComments)(['TITLE=Ogg Song'], Buffer.concat([Buffer.from([3]), Buffer.from('vorbis')])), 1),
    ]);
    node_assert_1.default.strictEqual((await (0, tagReader_1.readTags)(write('.ogg', vorbis))).title, 'Ogg Song');
});
(0, node_test_1.test)('m4a: mvhd duration, ilst text, trkn/disk and covr (moov after mdat)', async () => {
    const mvhd = (0, fixtures_1.mp4Atom)('mvhd', Buffer.concat([Buffer.alloc(12), (0, fixtures_1.be32)(1000), (0, fixtures_1.be32)(213000)]));
    const ilst = (0, fixtures_1.mp4Atom)('ilst', (0, fixtures_1.mp4Item)('©nam', Buffer.from('M4A Song')), (0, fixtures_1.mp4Item)('©ART', Buffer.from('M4A Band')), (0, fixtures_1.mp4Item)('aART', Buffer.from('M4A VA')), (0, fixtures_1.mp4Item)('©alb', Buffer.from('M4A LP')), (0, fixtures_1.mp4Item)('©day', Buffer.from('2018-01-01')), (0, fixtures_1.mp4Item)('trkn', Buffer.from([0, 0, 0, 5, 0, 12, 0, 0]), 0), (0, fixtures_1.mp4Item)('disk', Buffer.from([0, 0, 0, 2, 0, 3]), 0), (0, fixtures_1.mp4Item)('covr', fixtures_1.PNG, 14));
    const file = Buffer.concat([
        (0, fixtures_1.mp4Atom)('ftyp', Buffer.from('M4A \0\0\0\0')),
        (0, fixtures_1.mp4Atom)('mdat', Buffer.alloc(64)),
        (0, fixtures_1.mp4Atom)('moov', mvhd, (0, fixtures_1.mp4Atom)('udta', (0, fixtures_1.mp4Atom)('meta', Buffer.alloc(4), ilst))),
    ]);
    const t = await (0, tagReader_1.readTags)(write('.m4a', file));
    node_assert_1.default.strictEqual(t.durationMs, 213000);
    node_assert_1.default.strictEqual(t.title, 'M4A Song');
    node_assert_1.default.strictEqual(t.artist, 'M4A Band');
    node_assert_1.default.strictEqual(t.albumArtist, 'M4A VA');
    node_assert_1.default.strictEqual(t.album, 'M4A LP');
    node_assert_1.default.strictEqual(t.year, 2018);
    node_assert_1.default.strictEqual(t.trackNo, 5);
    node_assert_1.default.strictEqual(t.discNo, 2);
    node_assert_1.default.strictEqual(t.art?.ext, 'png');
});
(0, node_test_1.test)('truncated files return the tags parsed before the cut', async () => {
    const mp3 = (0, fixtures_1.id3Tag)([(0, fixtures_1.id3Text)('TIT2', 'Song'), (0, fixtures_1.id3Apic)(fixtures_1.PNG)]);
    const a = await (0, tagReader_1.readTags)(write('.mp3', mp3.subarray(0, mp3.length - 5)));
    node_assert_1.default.strictEqual(a.title, 'Song');
    node_assert_1.default.strictEqual(a.art, undefined);
    const flac = (0, fixtures_1.flacFile)([
        (0, fixtures_1.flacBlock)(0, (0, fixtures_1.flacStreamInfo)(44100, 441000)),
        (0, fixtures_1.flacBlock)(4, (0, fixtures_1.vorbisComments)(['TITLE=Cut', 'ARTIST=Band']), true),
    ]);
    const b = await (0, tagReader_1.readTags)(write('.flac', flac.subarray(0, flac.length - 8)));
    node_assert_1.default.strictEqual(b.durationMs, 10000);
    node_assert_1.default.strictEqual(b.title, 'Cut');
    node_assert_1.default.strictEqual(b.artist, undefined);
});
(0, node_test_1.test)('garbage, oversized declared sizes and missing files yield empty tags without throwing', async () => {
    for (const ext of ['.mp3', '.flac', '.ogg', '.opus', '.m4a']) {
        node_assert_1.default.deepStrictEqual(await (0, tagReader_1.readTags)(write(ext, Buffer.alloc(4096, 0xff))), {});
    }
    const bigSize = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), (0, fixtures_1.syncsafe)(100), Buffer.alloc(100, 0xff)]);
    node_assert_1.default.deepStrictEqual(await (0, tagReader_1.readTags)(write('.mp3', bigSize)), {});
    node_assert_1.default.deepStrictEqual(await (0, tagReader_1.readTags)(path.join(dir, 'missing.mp3')), {});
    node_assert_1.default.deepStrictEqual(await (0, tagReader_1.readTags)(write('.wav', Buffer.from('RIFF'))), {});
});
//# sourceMappingURL=tagReader.test.js.map