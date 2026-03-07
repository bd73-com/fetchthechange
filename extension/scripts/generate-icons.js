// Generate minimal placeholder PNG icons (solid indigo squares)
// PNG format: 8-byte signature + IHDR + IDAT + IEND

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function createPng(size) {
  // IHDR data
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // colour type: RGB
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  // Raw image data: each row has a filter byte (0) + RGB pixels
  const rowBytes = 1 + size * 3;
  const rawData = Buffer.alloc(rowBytes * size);
  // Indigo: rgb(99, 102, 241)
  for (let y = 0; y < size; y++) {
    const offset = y * rowBytes;
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = offset + 1 + x * 3;
      // Simple icon: darker border, lighter center
      const border = x === 0 || x === size - 1 || y === 0 || y === size - 1;
      const innerBorder = x === 1 || x === size - 2 || y === 1 || y === size - 2;
      if (border) {
        rawData[px] = 30;     // R
        rawData[px + 1] = 30; // G
        rawData[px + 2] = 46; // B (dark bg)
      } else if (innerBorder && size > 16) {
        rawData[px] = 67;
        rawData[px + 1] = 56;
        rawData[px + 2] = 202; // indigo-600
      } else {
        rawData[px] = 99;
        rawData[px + 1] = 102;
        rawData[px + 2] = 241; // indigo-500
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([len, typeBytes, data, crc]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makeChunk("IHDR", ihdrData);
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const iconsDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createPng(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
}
