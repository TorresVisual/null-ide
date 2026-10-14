/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphLayouter = exports.PALETTE_SIZE = void 0;
exports.PALETTE_SIZE = 6;
/**
 * Assigns each commit a lane. `lanes[i]` is the sha lane i is waiting for (the next commit expected there), or null.
 * A commit takes the leftmost lane waiting for it, else a free lane; its first parent inherits that lane and extra
 * (merge) parents take a lane already waiting for them or open one. State carries across pages, so pages must be
 * fed in order and reset() must be called before a reload from the top.
 */
class GraphLayouter {
    lanes = [];
    reset() {
        this.lanes = [];
    }
    layoutPage(commits) {
        return commits.map((commit) => this.layoutOne(commit));
    }
    freeSlot() {
        const free = this.lanes.indexOf(null);
        return free === -1 ? this.lanes.length : free;
    }
    layoutOne(commit) {
        const lanes = this.lanes;
        const before = lanes.length;
        const edges = [];
        lanes.forEach((waitingFor, i) => {
            if (waitingFor !== null && waitingFor !== commit.sha)
                edges.push({ kind: 'pass', from: i, to: i, color: i % exports.PALETTE_SIZE });
        });
        const waiting = [];
        lanes.forEach((waitingFor, i) => { if (waitingFor === commit.sha)
            waiting.push(i); });
        const lane = waiting.length > 0 ? waiting[0] : this.freeSlot();
        for (const w of waiting)
            edges.push({ kind: 'in', from: w, to: lane, color: w % exports.PALETTE_SIZE });
        for (const w of waiting)
            lanes[w] = null;
        if (lane >= lanes.length)
            lanes[lane] = null;
        const [first, ...rest] = commit.parents;
        if (first !== undefined) {
            lanes[lane] = first;
            edges.push({ kind: 'out', from: lane, to: lane, color: lane % exports.PALETTE_SIZE });
        }
        for (const parent of rest) {
            let target = lanes.indexOf(parent);
            if (target === -1) {
                target = this.freeSlot();
                lanes[target] = parent;
            }
            edges.push({ kind: 'out', from: lane, to: target, color: target % exports.PALETTE_SIZE });
        }
        while (lanes.length > 0 && lanes[lanes.length - 1] === null)
            lanes.pop();
        return {
            sha: commit.sha,
            parents: commit.parents,
            lane,
            laneCount: Math.max(before, lanes.length, lane + 1),
            edges,
            refs: commit.refs,
            subject: commit.subject,
            author: commit.author,
            time: commit.time,
        };
    }
}
exports.GraphLayouter = GraphLayouter;
//# sourceMappingURL=graphLayout.js.map