'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const providerRegistry_1 = require("../provider/providerRegistry");
const testFakes_1 = require("../testFakes");
(0, node_test_1.test)('ProviderRegistry registers, retrieves, and switches active providers', () => {
    const registry = new providerRegistry_1.ProviderRegistry();
    const spotify = new testFakes_1.FakeMusicProvider('spotify', 'Spotify');
    const apple = new testFakes_1.FakeMusicProvider('apple', 'Apple Music');
    let activeChangeCount = 0;
    registry.onDidChangeActiveProvider(() => {
        activeChangeCount++;
    });
    const regSpotify = registry.register(spotify);
    node_assert_1.default.strictEqual(registry.getActiveProvider()?.id, 'spotify');
    node_assert_1.default.strictEqual(activeChangeCount, 1);
    registry.register(apple);
    node_assert_1.default.strictEqual(registry.getAll().length, 2);
    registry.setActiveProviderId('apple');
    node_assert_1.default.strictEqual(registry.getActiveProvider()?.id, 'apple');
    node_assert_1.default.strictEqual(activeChangeCount, 2);
    regSpotify.dispose();
    node_assert_1.default.strictEqual(registry.get('spotify'), undefined);
    node_assert_1.default.strictEqual(registry.getAll().length, 1);
});
//# sourceMappingURL=providerRegistry.test.js.map