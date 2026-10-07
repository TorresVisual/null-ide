'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const musicHtml_1 = require("../ui/musicHtml");
(0, node_test_1.test)('getMusicWebviewHtml contains CSP nonce, controls, and elements', () => {
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
    node_assert_1.default.ok(html.includes('id="playlists-list"'));
    node_assert_1.default.ok(html.includes('id="search-input"'));
    node_assert_1.default.ok(html.includes('id="devices-list"'));
});
//# sourceMappingURL=musicHtml.test.js.map