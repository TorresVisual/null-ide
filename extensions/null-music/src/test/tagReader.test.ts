'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { readTags } from '../library/tagReader';
import {
  PNG, be32, flacBlock, flacFile, flacPicture, flacStreamInfo, id3Apic, id3Tag, id3Text, id3Utf16,
  id3v22Text, mp4Atom, mp4Item, oggPage, syncsafe, vorbisComments,
} from './fixtures';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-tags-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const write = (ext: string, data: Buffer): string => {
  const f = path.join(dir, `f${n++}${ext}`);
  fs.writeFileSync(f, data);
  return f;
};

test('mp3: ID3v2.3 latin1/utf-8/utf-16 frames and front cover', async () => {
  const t = await readTags(
    write('.mp3', id3Tag([
      id3Text('TIT2', 'Song'), id3Utf16('TPE1', 'Bänd'), id3Text('TALB', 'LP'), id3Text('TPE2', 'Various'),
      id3Text('TRCK', '3/12'), id3Text('TPOS', '1/2'), id3Text('TYER', '2019'), id3Apic(PNG),
    ]))
  );
  assert.strictEqual(t.title, 'Song');
  assert.strictEqual(t.artist, 'Bänd');
  assert.strictEqual(t.album, 'LP');
  assert.strictEqual(t.albumArtist, 'Various');
  assert.strictEqual(t.trackNo, 3);
  assert.strictEqual(t.discNo, 1);
  assert.strictEqual(t.year, 2019);
  assert.strictEqual(t.art?.ext, 'png');
  assert.deepStrictEqual(t.art?.data, PNG);
});

test('mp3: ID3v2.4 (syncsafe sizes, TDRC) and ID3v2.2', async () => {
  const v24 = await readTags(
    write('.mp3', id3Tag([id3Text('TIT2', 'Four', 4), id3Text('TDRC', '2020-05-01', 4), id3Apic(PNG, 4)], 4))
  );
  assert.strictEqual(v24.title, 'Four');
  assert.strictEqual(v24.year, 2020);
  assert.deepStrictEqual(v24.art?.data, PNG);

  const v22 = await readTags(write('.mp3', id3Tag([id3v22Text('TT2', 'Two'), id3v22Text('TP1', 'Old Band')], 2)));
  assert.strictEqual(v22.title, 'Two');
  assert.strictEqual(v22.artist, 'Old Band');
});

test('mp3: ID3v2.3 whole-tag unsynchronisation', async () => {
  const frame = Buffer.concat([Buffer.from('TIT2'), be32(3), Buffer.alloc(2), Buffer.from([0, 0xff, 0x00, 0x61])]);
  const file = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0x80]), syncsafe(frame.length), frame]);
  assert.strictEqual((await readTags(write('.mp3', file))).title, 'ÿa');
});

test('flac: STREAMINFO duration, vorbis comments and picture', async () => {
  const t = await readTags(
    write('.flac', flacFile([
      flacBlock(0, flacStreamInfo(44100, 441000)),
      flacBlock(4, vorbisComments(['TITLE=Flac Song', 'ARTIST=Band', 'ALBUM=LP', 'ALBUMARTIST=VA', 'TRACKNUMBER=7', 'DISCNUMBER=2', 'DATE=2001-02-03'])),
      flacBlock(6, flacPicture(PNG), true),
    ]))
  );
  assert.strictEqual(t.durationMs, 10000);
  assert.strictEqual(t.title, 'Flac Song');
  assert.strictEqual(t.artist, 'Band');
  assert.strictEqual(t.album, 'LP');
  assert.strictEqual(t.albumArtist, 'VA');
  assert.strictEqual(t.trackNo, 7);
  assert.strictEqual(t.discNo, 2);
  assert.strictEqual(t.year, 2001);
  assert.deepStrictEqual(t.art?.data, PNG);
});

test('opus and ogg vorbis: comment header and base64 picture', async () => {
  const pic = `METADATA_BLOCK_PICTURE=${flacPicture(PNG).toString('base64')}`;
  const opus = Buffer.concat([
    oggPage(Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11)]), 0),
    oggPage(vorbisComments(['TITLE=Opus Song', 'ARTIST=Band', pic], Buffer.from('OpusTags')), 1),
  ]);
  const o = await readTags(write('.opus', opus));
  assert.strictEqual(o.title, 'Opus Song');
  assert.strictEqual(o.artist, 'Band');
  assert.deepStrictEqual(o.art?.data, PNG);

  const vorbis = Buffer.concat([
    oggPage(Buffer.concat([Buffer.from([1]), Buffer.from('vorbis'), Buffer.alloc(23)]), 0),
    oggPage(vorbisComments(['TITLE=Ogg Song'], Buffer.concat([Buffer.from([3]), Buffer.from('vorbis')])), 1),
  ]);
  assert.strictEqual((await readTags(write('.ogg', vorbis))).title, 'Ogg Song');
});

test('m4a: mvhd duration, ilst text, trkn/disk and covr (moov after mdat)', async () => {
  const mvhd = mp4Atom('mvhd', Buffer.concat([Buffer.alloc(12), be32(1000), be32(213000)]));
  const ilst = mp4Atom(
    'ilst',
    mp4Item('©nam', Buffer.from('M4A Song')),
    mp4Item('©ART', Buffer.from('M4A Band')),
    mp4Item('aART', Buffer.from('M4A VA')),
    mp4Item('©alb', Buffer.from('M4A LP')),
    mp4Item('©day', Buffer.from('2018-01-01')),
    mp4Item('trkn', Buffer.from([0, 0, 0, 5, 0, 12, 0, 0]), 0),
    mp4Item('disk', Buffer.from([0, 0, 0, 2, 0, 3]), 0),
    mp4Item('covr', PNG, 14)
  );
  const file = Buffer.concat([
    mp4Atom('ftyp', Buffer.from('M4A \0\0\0\0')),
    mp4Atom('mdat', Buffer.alloc(64)),
    mp4Atom('moov', mvhd, mp4Atom('udta', mp4Atom('meta', Buffer.alloc(4), ilst))),
  ]);
  const t = await readTags(write('.m4a', file));
  assert.strictEqual(t.durationMs, 213000);
  assert.strictEqual(t.title, 'M4A Song');
  assert.strictEqual(t.artist, 'M4A Band');
  assert.strictEqual(t.albumArtist, 'M4A VA');
  assert.strictEqual(t.album, 'M4A LP');
  assert.strictEqual(t.year, 2018);
  assert.strictEqual(t.trackNo, 5);
  assert.strictEqual(t.discNo, 2);
  assert.strictEqual(t.art?.ext, 'png');
});

test('truncated files return the tags parsed before the cut', async () => {
  const mp3 = id3Tag([id3Text('TIT2', 'Song'), id3Apic(PNG)]);
  const a = await readTags(write('.mp3', mp3.subarray(0, mp3.length - 5)));
  assert.strictEqual(a.title, 'Song');
  assert.strictEqual(a.art, undefined);

  const flac = flacFile([
    flacBlock(0, flacStreamInfo(44100, 441000)),
    flacBlock(4, vorbisComments(['TITLE=Cut', 'ARTIST=Band']), true),
  ]);
  const b = await readTags(write('.flac', flac.subarray(0, flac.length - 8)));
  assert.strictEqual(b.durationMs, 10000);
  assert.strictEqual(b.title, 'Cut');
  assert.strictEqual(b.artist, undefined);
});

test('garbage, oversized declared sizes and missing files yield empty tags without throwing', async () => {
  for (const ext of ['.mp3', '.flac', '.ogg', '.opus', '.m4a']) {
    assert.deepStrictEqual(await readTags(write(ext, Buffer.alloc(4096, 0xff))), {});
  }
  const bigSize = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(100), Buffer.alloc(100, 0xff)]);
  assert.deepStrictEqual(await readTags(write('.mp3', bigSize)), {});
  assert.deepStrictEqual(await readTags(path.join(dir, 'missing.mp3')), {});
  assert.deepStrictEqual(await readTags(write('.wav', Buffer.from('RIFF'))), {});
});
