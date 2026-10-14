// Local stand-in for the GitHub Releases API, for the manual update matrix.
//   node scripts/fake-release.mjs --zip <file> --tag v9.9.9 [--port 8787] [--throttle <KB/s>] [--cut-after <bytes>]
// Start Null IDE from a terminal with NULL_SETUP_API_BASE=http://127.0.0.1:<port> to point the updater at it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const zip = arg('zip');
const tag = arg('tag');
const port = Number(arg('port', 8787));
const throttle = Number(arg('throttle', 0));
let cutAfter = Number(arg('cut-after', 0));
if (!zip || !tag) {
  console.error('usage: --zip <file> --tag <tag> [--port n] [--throttle KB/s] [--cut-after bytes]');
  process.exit(2);
}

const name = 'null-ide-win32-x64.zip';
const size = fs.statSync(zip).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const base = `http://127.0.0.1:${port}`;

http.createServer((req, res) => {
  console.log(req.method, req.url, req.headers.range ?? '');
  if (/^\/repos\/[^/]+\/[^/]+\/releases\/tags\//.test(req.url)) {
    if (!req.url.endsWith(`/releases/tags/${tag}`)) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      tag_name: tag, html_url: base, body: 'fake release',
      assets: [
        { name, browser_download_url: `${base}/zip`, size },
        { name: `${name}.sha256`, browser_download_url: `${base}/zip.sha256`, size: 64 },
      ],
    }));
  }
  if (req.url === '/zip.sha256') return res.end(`${sha}  ${name}`);
  if (req.url === '/zip') {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    res.statusCode = m ? 206 : 200;
    if (m) res.setHeader('content-range', `bytes ${start}-${size - 1}/${size}`);
    res.setHeader('content-length', size - start);
    let sent = 0;
    const stream = fs.createReadStream(zip, { start });
    stream.on('data', (chunk) => {
      if (cutAfter && sent + chunk.length > cutAfter) { // cut the connection once, so the client has to resume
        cutAfter = 0;
        stream.destroy();
        res.destroy();
        return;
      }
      sent += chunk.length;
      res.write(chunk);
      if (throttle) {
        stream.pause();
        setTimeout(() => stream.resume(), (chunk.length / (throttle * 1024)) * 1000);
      }
    });
    stream.on('end', () => res.end());
    return;
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(port, '127.0.0.1', () => console.log(`fake release ${tag} on ${base}`));
