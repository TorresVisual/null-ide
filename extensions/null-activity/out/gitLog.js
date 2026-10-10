/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitLogArgs = gitLogArgs;
exports.parseGitLog = parseGitLog;
/** Arguments for `git` (after the binary). `--author` only narrows the output; parseGitLog does the exact match. */
function gitLogArgs(range, email) {
    const args = [
        '--no-pager', 'log', '--branches', '--no-merges', '--no-renames', '--numstat',
        '-F', `--author=${email}`, '--format=@%ct%x09%ae',
    ];
    if (range.from > 0)
        args.push(`--since=${Math.floor(range.from / 1000)}`);
    if (range.to < Number.MAX_SAFE_INTEGER)
        args.push(`--until=${Math.ceil(range.to / 1000)}`);
    return args;
}
/**
 * Parses the output of gitLogArgs: a `@<unix seconds>\t<email>` header per commit followed by
 * `<added>\t<removed>\t<path>` lines (`-` for binary files). Counts only commits by `email`
 * whose committer time is in [from, to); anything unparseable is skipped.
 */
function parseGitLog(stdout, email, range) {
    const want = email.trim().toLowerCase();
    const files = new Set();
    let commits = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let counting = false;
    for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith('@')) {
            const [seconds, author] = line.slice(1).split('\t');
            const ts = Number(seconds) * 1000;
            counting = author?.trim().toLowerCase() === want && Number.isFinite(ts) && ts >= range.from && ts < range.to;
            if (counting)
                commits++;
            continue;
        }
        if (!counting)
            continue;
        const stat = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (!stat)
            continue;
        files.add(stat[3]);
        if (stat[1] !== '-')
            linesAdded += Number(stat[1]);
        if (stat[2] !== '-')
            linesRemoved += Number(stat[2]);
    }
    return { commits, filesChanged: files.size, linesAdded, linesRemoved };
}
//# sourceMappingURL=gitLog.js.map