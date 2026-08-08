const zlib = require('zlib');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function trayIconPng(recording = false, size = 32) {
  if (!Number.isInteger(size) || size < 16 || size > 256) throw new RangeError('Icon size must be an integer from 16 to 256.');
  const scale = value => Math.round(value * size / 32);
  const pixels = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3] ?? 255;
  };
  const fillRoundedRect = (left, top, right, bottom, radius, color) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const nearestX = Math.max(left + radius, Math.min(x, right - radius));
        const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
        if ((x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2) setPixel(x, y, color);
      }
    }
  };
  const fillCircle = (centerX, centerY, radius, color) => {
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(x, y, color);
      }
    }
  };

  fillRoundedRect(scale(2), scale(2), scale(29), scale(29), scale(7), [91, 78, 230, 255]);
  fillRoundedRect(scale(7), scale(9), scale(21), scale(22), scale(3), [250, 250, 250, 255]);
  for (let y = scale(12); y <= scale(19); y += 1) {
    const inset = Math.abs(y - scale(15.5)) > scale(2.5) ? scale(2) : 0;
    for (let x = scale(22); x <= scale(26) - inset; x += 1) setPixel(x, y, [250, 250, 250, 255]);
  }
  fillRoundedRect(scale(10), scale(12), scale(18), scale(19), Math.max(1, scale(1)), [91, 78, 230, 255]);

  if (recording) {
    fillCircle(scale(25), scale(25), scale(6), [255, 255, 255, 255]);
    fillCircle(scale(25), scale(25), scale(4), [239, 68, 68, 255]);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { trayIconPng };
