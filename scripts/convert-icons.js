const sharp = require('sharp');
const toIco = require('to-ico');
const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

const svgPath = path.resolve(__dirname, '../icons/icon.svg');
const outDir  = path.resolve(__dirname, '../icons');

async function main() {
  const svg = fs.readFileSync(svgPath);

  // PNG sizes to generate
  const pngSizes = [16, 32, 48, 64, 70, 128, 150, 256, 512, 1024];
  const bufs = {};

  for (const s of pngSizes) {
    bufs[s] = await sharp(svg).resize(s, s).png().toBuffer();
    process.stdout.write(`  ${s}px\n`);
  }

  // icon.png — 1024px master
  fs.writeFileSync(path.join(outDir, 'icon.png'), bufs[1024]);
  console.log('✓ icon.png (1024px)');

  // Windows window icon sizes (used by Electron BrowserWindow)
  fs.writeFileSync(path.join(outDir, 'icon_150x150.png'), bufs[150]);
  fs.writeFileSync(path.join(outDir, 'icon_70x70.png'),   bufs[70]);
  console.log('✓ icon_150x150.png + icon_70x70.png (Electron window icon)');

  // icon.ico — 16/32/48/256 inside one container
  const ico = await toIco([bufs[16], bufs[32], bufs[48], bufs[256]]);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('✓ icon.ico (16/32/48/256px)');

  // icon.icns — macOS, all standard sizes from the 1024px master
  const icns = png2icons.createICNS(bufs[1024], png2icons.BILINEAR, 0);
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns);
  console.log('✓ icon.icns (16/32/64/128/256/512/1024px)');
}

main().catch(e => { console.error(e); process.exit(1); });
