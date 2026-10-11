'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const badgeSvg_1 = require("../badgeSvg");
const widthOf = (svg) => Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1]);
(0, node_test_1.test)('renders a two-segment flat badge sized from the text', () => {
    const svg = (0, badgeSvg_1.renderBadge)('coding time', '1h', '#007ec6');
    node_assert_1.default.ok(svg.startsWith('<svg '));
    node_assert_1.default.ok(svg.endsWith('</svg>'));
    // 11 chars -> round(72.6) + 10 = 83; 2 chars -> round(13.2) + 10 = 23
    node_assert_1.default.strictEqual(widthOf(svg), 106);
    node_assert_1.default.strictEqual(svg.match(/<text /g)?.length, 2);
    node_assert_1.default.ok(svg.includes('>coding time</text>'));
    node_assert_1.default.ok(svg.includes('>1h</text>'));
    node_assert_1.default.ok(svg.includes('fill="#007ec6"'));
});
(0, node_test_1.test)('a longer value makes a wider badge', () => {
    node_assert_1.default.ok(widthOf((0, badgeSvg_1.renderBadge)('top language', 'typescript', '#000')) > widthOf((0, badgeSvg_1.renderBadge)('top language', 'c', '#000')));
});
(0, node_test_1.test)('text is XML-escaped so a value can never inject markup', () => {
    const svg = (0, badgeSvg_1.renderBadge)('a&b', '<script>"x"</script>', '#000');
    node_assert_1.default.ok(!svg.includes('<script>'));
    node_assert_1.default.ok(svg.includes('a&amp;b'));
    node_assert_1.default.ok(svg.includes('&lt;script&gt;&quot;x&quot;&lt;/script&gt;'));
});
//# sourceMappingURL=badgeSvg.test.js.map