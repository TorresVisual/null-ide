'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stub = stub;
const node_events_1 = require("node:events");
const node_https_1 = __importDefault(require("node:https"));
const node_test_1 = require("node:test");
/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses) {
    const calls = [];
    node_test_1.mock.method(node_https_1.default, 'request', (url, opts, onResponse) => {
        const call = { url, method: opts.method };
        calls.push(call);
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        return Object.assign(new node_events_1.EventEmitter(), {
            setTimeout() { }, destroy() { },
            write(payload) { call.body = JSON.parse(payload); },
            end() {
                const res = Object.assign(new node_events_1.EventEmitter(), { statusCode: next.status ?? 200, headers: {}, setEncoding() { } });
                onResponse(res);
                res.emit('data', JSON.stringify(next.body));
                res.emit('end');
            },
        });
    });
    return calls;
}
//# sourceMappingURL=httpStub.js.map