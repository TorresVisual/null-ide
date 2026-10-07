'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const commandHelpers_1 = require("../ui/commandHelpers");
(0, node_test_1.test)('formatSec formats seconds to mm:ss', () => {
    node_assert_1.default.strictEqual((0, commandHelpers_1.formatSec)(0), '0:00');
    node_assert_1.default.strictEqual((0, commandHelpers_1.formatSec)(5), '0:05');
    node_assert_1.default.strictEqual((0, commandHelpers_1.formatSec)(65), '1:05');
    node_assert_1.default.strictEqual((0, commandHelpers_1.formatSec)(125), '2:05');
    node_assert_1.default.strictEqual((0, commandHelpers_1.formatSec)(3600), '60:00');
});
(0, node_test_1.test)('parseTimeToMs parses seconds, mm:ss, and rejects invalid formats', () => {
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('45'), 45000);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('120'), 120000);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('1:30'), 90000);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('0:45'), 45000);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('3:00'), 180000);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('invalid'), null);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('1:99'), null);
    node_assert_1.default.strictEqual((0, commandHelpers_1.parseTimeToMs)('-10'), null);
});
(0, node_test_1.test)('NULL_MUSIC_COMMANDS includes all essential local playback and folder commands', () => {
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.playPause'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.nextTrack'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.previousTrack'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.seek'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.setVolume'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.volumeUp'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.volumeDown'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.toggleShuffle'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.toggleRepeat'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.likeCurrentTrack'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.search'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.browsePlaylists'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.openLocalFolder'));
    node_assert_1.default.ok(commandHelpers_1.NULL_MUSIC_COMMANDS.includes('null-music.focus'));
    node_assert_1.default.strictEqual(commandHelpers_1.NULL_MUSIC_COMMANDS.length, 17);
});
//# sourceMappingURL=commands.test.js.map