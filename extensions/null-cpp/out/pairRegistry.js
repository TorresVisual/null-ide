"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PairRegistry = void 0;
class PairRegistry {
    pairs = new Map();
    record(uriA, uriB) {
        this.pairs.set(uriA, uriB);
        this.pairs.set(uriB, uriA);
    }
    getCounterpart(uri) {
        return this.pairs.get(uri);
    }
    has(uri) {
        return this.pairs.has(uri);
    }
    remove(uri) {
        const counterpart = this.pairs.get(uri);
        this.pairs.delete(uri);
        if (counterpart !== undefined) {
            this.pairs.delete(counterpart);
        }
    }
}
exports.PairRegistry = PairRegistry;
//# sourceMappingURL=pairRegistry.js.map