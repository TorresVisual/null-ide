const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

// icon key -> source SVG in extensions/null-icons/src/icons/files
const ICONS = {
  js: 'js.svg',
  ts: 'ts.svg',
  python: 'python.svg',
  json: 'brackets-yellow.svg',
  markdown: 'markdown.svg',
  html: 'code-orange.svg',
  css: 'brackets-sky.svg',
  yaml: 'yaml.svg',
  text: 'text.svg',
  xml: 'xml.svg',
  c: 'c.svg',
  h: 'h.svg',
  cplus: 'cplus.svg',
  csharp: 'csharp.svg',
  go: 'go.svg',
  rust: 'rust.svg',
  php: 'php.svg',
  ruby: 'ruby.svg',
  shell: 'shell.svg',
  database: 'database.svg',
  git: 'git.svg',
  patch: 'patch.svg',
  cmake: 'cmake.svg',
  dart: 'dart.svg',
  docker: 'docker.svg',
  notebook: 'notebook.svg',
  csproj: 'visual-studio.svg',
  hplus: 'hplus.svg',
  java: 'java.svg',
  lua: 'lua.svg',
  tex: 'tex.svg',
  document: 'document.svg',
};

const srcDir = path.resolve(__dirname, '../extensions/null-icons/src/icons/files');
const outDir = path.resolve(__dirname, '../icons/file-assoc');
const sizes = [16, 32, 48, 256];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, svgName] of Object.entries(ICONS)) {
    const svgPath = path.join(srcDir, svgName);
    if (!fs.existsSync(svgPath)) {
      throw new Error(`Source SVG not found for "${key}": ${svgPath}`);
    }
    const svg = fs.readFileSync(svgPath);

    const bufs = [];
    for (const s of sizes) {
      bufs.push(await sharp(svg).resize(s, s).png().toBuffer());
    }

    const ico = await toIco(bufs);
    fs.writeFileSync(path.join(outDir, `${key}.ico`), ico);
    console.log(`✓ ${key}.ico (from ${svgName}, ${sizes.join('/')}px)`);
  }

  console.log(`\nGenerated ${Object.keys(ICONS).length} icons in ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
