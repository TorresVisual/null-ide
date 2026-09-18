#!/usr/bin/env node
// PostToolUse: after editing an extension's src/*.ts, run that extension's own
// test script (tsc + node --test) and feed failures back to the agent.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let filePath;
  try {
    filePath = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!filePath) process.exit(0);
  const norm = filePath.replace(/\\/g, '/');

  const match = norm.match(/\/(extensions\/[^/]+)\/src\/.*\.ts$/);
  if (!match) process.exit(0);
  const extRel = match[1];

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projDir = path.join(root, extRel);
  const pkgPath = path.join(projDir, 'package.json');
  if (!fs.existsSync(pkgPath)) process.exit(0);

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!pkg.scripts || !pkg.scripts.test) process.exit(0);

  try {
    execSync('npm test', { cwd: projDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: `npm test failed in ${extRel} after this edit:\n\n${out}`,
      })
    );
  }
  process.exit(0);
});
