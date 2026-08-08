const fs = require('fs');
const path = require('path');
const { trayIconPng } = require('../src/tray-icon');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => ({ size, data: trayIconPng(false, size) }));
const headerSize = 6 + images.length * 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = headerSize;
images.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});

const outputDirectory = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, 'app-icon.ico');
fs.writeFileSync(outputPath, Buffer.concat([header, ...images.map(image => image.data)]));
console.log(`Generated ${outputPath} with ${images.length} sizes.`);
