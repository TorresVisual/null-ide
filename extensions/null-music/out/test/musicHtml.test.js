'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const musicHtml_1 = require("../ui/musicHtml");
(0, node_test_1.test)('getMusicWebviewHtml contains CSP nonce, controls, and clean local elements', () => {
    const nonce = 'test-nonce-12345';
    const html = (0, musicHtml_1.getMusicWebviewHtml)(nonce);
    node_assert_1.default.ok(html.includes(`nonce-${nonce}`));
    node_assert_1.default.ok(html.includes('id="btn-play-pause"'));
    node_assert_1.default.ok(html.includes('id="btn-prev"'));
    node_assert_1.default.ok(html.includes('id="btn-next"'));
    node_assert_1.default.ok(html.includes('id="btn-shuffle"'));
    node_assert_1.default.ok(html.includes('id="btn-repeat"'));
    node_assert_1.default.ok(html.includes('id="btn-like"'));
    node_assert_1.default.ok(html.includes('id="volume-slider"'));
    node_assert_1.default.ok(html.includes('id="progress-bar-container"'));
    node_assert_1.default.ok(html.includes('id="search-input"'));
    node_assert_1.default.ok(html.includes('id="btn-add-folder"'));
    node_assert_1.default.ok(html.includes('id="audio-player"'));
    node_assert_1.default.ok(html.includes('id="pane-tracks"'));
    node_assert_1.default.ok(html.includes('id="pane-playlists"'));
    node_assert_1.default.ok(html.includes('id="pane-folders"'));
    node_assert_1.default.ok(html.includes('id="pane-favorites"'));
    node_assert_1.default.ok(html.includes('id="btn-import-playlist"'));
    node_assert_1.default.ok(html.includes('id="btn-rewind-10"'));
    node_assert_1.default.ok(html.includes('id="btn-forward-10"'));
    node_assert_1.default.ok(html.includes('id="error-banner"'));
    // Ensure slop is completely removed
    node_assert_1.default.ok(!html.includes('Spotify'));
    node_assert_1.default.ok(!html.includes('Lo-Fi Radio'));
    node_assert_1.default.ok(!html.includes('input-client-id'));
    node_assert_1.default.ok(!html.includes('link-dev-dash'));
    node_assert_1.default.ok(!html.includes('select-provider'));
    // Engine protocol: loads carry autoplay + start offset, interrupted play() is not a failure.
    node_assert_1.default.ok(html.includes("case 'localLoad':"));
    node_assert_1.default.ok(!html.includes("case 'localPlay':"));
    node_assert_1.default.ok(html.includes("err.name === 'AbortError'"));
    node_assert_1.default.ok(html.includes('t.folder === f'));
});
//# sourceMappingURL=musicHtml.test.js.map