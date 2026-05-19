#!/usr/bin/env node
// Deep-merges an overlay JSON file into a base JSON file. Overlay values win on conflict.
// Arrays are replaced entirely (not concatenated).
// Usage: node merge-json.js <base.json> <overlay.json> <output.json>

const fs = require('fs');

const [,, basePath, overlayPath, outputPath] = process.argv;
if (!basePath || !overlayPath || !outputPath) {
  console.error('Usage: merge-json.js <base.json> <overlay.json> <output.json>');
  process.exit(1);
}

function deepMerge(base, overlay) {
  const result = { ...base };
  for (const [key, val] of Object.entries(overlay)) {
    const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

const base    = JSON.parse(fs.readFileSync(basePath,    'utf8'));
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const merged  = deepMerge(base, overlay);

fs.writeFileSync(outputPath, JSON.stringify(merged, null, '\t') + '\n');
console.log(`Merged ${overlayPath} → ${outputPath}`);
