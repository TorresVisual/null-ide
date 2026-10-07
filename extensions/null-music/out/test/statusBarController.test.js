'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const testFakes_1 = require("../testFakes");
const statusBarModel_1 = require("../ui/statusBarModel");
(0, node_test_1.test)('formatTime formats seconds into mm:ss', () => {
    node_assert_1.default.strictEqual((0, statusBarModel_1.formatTime)(0), '0:00');
    node_assert_1.default.strictEqual((0, statusBarModel_1.formatTime)(9), '0:09');
    node_assert_1.default.strictEqual((0, statusBarModel_1.formatTime)(65), '1:05');
    node_assert_1.default.strictEqual((0, statusBarModel_1.formatTime)(600), '10:00');
});
(0, node_test_1.test)('buildStatusBarModel returns idle state when no track is playing', () => {
    const model = (0, statusBarModel_1.buildStatusBarModel)(null);
    node_assert_1.default.strictEqual(model.text, '$(music) Music');
    node_assert_1.default.strictEqual(model.isPlaying, false);
    node_assert_1.default.ok(model.tooltipText.includes('No active playback'));
});
(0, node_test_1.test)('buildStatusBarModel formats playing song and markdown tooltip', () => {
    const state = (0, testFakes_1.makeSamplePlaybackState)({
        isPlaying: true,
        progressMs: 75000,
        durationMs: 200000,
    });
    const model = (0, statusBarModel_1.buildStatusBarModel)(state, '${title} by ${artist}');
    node_assert_1.default.strictEqual(model.text, '$(play) Lo-Fi Coding Beats by Chill Coder');
    node_assert_1.default.strictEqual(model.isPlaying, true);
    node_assert_1.default.ok(model.tooltipText.includes('Lo-Fi Coding Beats'));
    node_assert_1.default.ok(model.tooltipText.includes('Chill Coder'));
    node_assert_1.default.ok(model.tooltipText.includes('Code Vibes Vol. 1'));
    node_assert_1.default.ok(model.tooltipText.includes('1:15 / 3:20'));
    node_assert_1.default.ok(model.tooltipText.includes('MacBook Pro'));
});
(0, node_test_1.test)('buildStatusBarModel shows paused icon when paused', () => {
    const state = (0, testFakes_1.makeSamplePlaybackState)({
        isPlaying: false,
    });
    const model = (0, statusBarModel_1.buildStatusBarModel)(state);
    node_assert_1.default.strictEqual(model.text, '$(debug-pause) Lo-Fi Coding Beats - Chill Coder');
    node_assert_1.default.strictEqual(model.isPlaying, false);
});
//# sourceMappingURL=statusBarController.test.js.map