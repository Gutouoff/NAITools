// Deterministic local fixtures. No downloaded images or provider requests.
import { deflateSync } from "node:zlib";
function chunk(kind, data) {
 const type = Buffer.from(kind);
 const payload = Buffer.concat([type, data]);
 let crc = 0xffffffff;
 for (const byte of payload) {
  crc ^= byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
 }
 const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
 const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
 return Buffer.concat([length, payload, checksum]);
}
export function imageFixture(metadata = false) {
 const width = 64, height = 48;
 const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
 const pixels = Buffer.alloc((width * 3 + 1) * height, 160);
 for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
 const texts = metadata ? [
  chunk("tEXt", Buffer.from("Software\0NovelAI")),
  chunk("tEXt", Buffer.from("Source\0nai-diffusion-4-5-full")),
  chunk("tEXt", Buffer.from("Comment\0" + JSON.stringify({ prompt: "artist:fixture, 1girl, blue hair", uc: "lowres", model: "nai-diffusion-4-5-full", steps: 28, scale: 6, seed: 42, width, height, sampler: "k_euler_ancestral" }))),
 ] : [];
 const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...texts, chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
 const base64 = bytes.toString("base64");
 return { image: { filePath: "naitools://imports/fixture-" + (metadata ? "meta" : "plain") + ".png", fileUrl: "data:image/png;base64," + base64, width, height }, snapshot: { name: "fixture.png", type: "image/png", lastModified: 123, base64 } };
}
