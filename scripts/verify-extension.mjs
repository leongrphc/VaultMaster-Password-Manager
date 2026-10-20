import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { sha256, validateFiles, manifestIdentity, releaseFiles } from './extension-release-policy.mjs';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function verifyExtension(zip) {
  const files = new Map();
  const localOffsets = new Map();
  const requireBytes = (start, size) => {
    if (start < 0 || size < 0 || start + size > zip.length) throw new Error('Truncated ZIP archive');
  };
  const signature = start => { requireBytes(start, 4); return zip.readUInt32LE(start); };
  let offset = 0;
  while (signature(offset) === 0x04034b50) {
    requireBytes(offset, 30);
    if (zip.readUInt16LE(offset + 6) !== 0x800 || zip.readUInt16LE(offset + 8) !== 8) throw new Error('Unexpected ZIP encoding');
    const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    requireBytes(offset + 30, length + extra + size);
    const name = zip.subarray(offset + 30, offset + 30 + length).toString();
    if (name !== 'verification.json' && !releaseFiles.includes(name)) throw new Error('Unexpected ZIP entry');
    if (extra !== 0) throw new Error('Unexpected ZIP extra fields');
    if (files.has(name)) throw new Error('Duplicate ZIP entry');
    const start = offset + 30 + length + extra;
    const expectedSize = zip.readUInt32LE(offset + 22);
    const bytes = inflateRawSync(zip.subarray(start, start + size), { maxOutputLength: Math.max(1, expectedSize), info: true });
    if (bytes.buffer.length !== expectedSize || bytes.engine.bytesWritten !== size ||
        crc32(bytes.buffer) !== zip.readUInt32LE(offset + 14)) throw new Error('ZIP entry integrity mismatch');
    files.set(name, bytes.buffer);
    localOffsets.set(name, offset);
    offset = start + size;
  }
  // Validate the central directory too: extraction tools use it rather than local headers.
  const directoryOffset = offset;
  const centralNames = [];
  while (signature(offset) === 0x02014b50) {
    requireBytes(offset, 46);
    const length = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    requireBytes(offset + 46, length + extra + comment);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString();
    const localOffset = zip.readUInt32LE(offset + 42);
    if (localOffsets.get(name) !== localOffset || extra !== 0 || comment !== 0 ||
        zip.readUInt16LE(offset + 34) !== 0 ||
        zip.readUInt16LE(offset + 28) !== zip.readUInt16LE(localOffset + 26) ||
        !zip.subarray(offset + 6, offset + 16).equals(zip.subarray(localOffset + 4, localOffset + 14)) ||
        !zip.subarray(offset + 46, offset + 46 + length).equals(zip.subarray(localOffset + 30, localOffset + 30 + length)) ||
        !zip.subarray(offset + 16, offset + 28).equals(zip.subarray(localOffset + 14, localOffset + 26))) throw new Error('ZIP directory mismatch');
    centralNames.push(name);
    offset += 46 + length + extra + comment;
  }
  requireBytes(offset, 22);
  if (signature(offset) !== 0x06054b50 || offset + 22 !== zip.length ||
      zip.readUInt16LE(offset + 4) !== 0 || zip.readUInt16LE(offset + 6) !== 0 ||
      zip.readUInt16LE(offset + 8) !== files.size || zip.readUInt16LE(offset + 20) !== 0 ||
      zip.readUInt32LE(offset + 12) !== offset - directoryOffset ||
      zip.readUInt32LE(offset + 16) !== directoryOffset ||
      zip.readUInt16LE(offset + 10) !== files.size ||
      JSON.stringify(centralNames) !== JSON.stringify([...files.keys()])) throw new Error('ZIP directory entries mismatch');
  const inventory = JSON.parse(files.get('verification.json'));
  files.delete('verification.json');
  validateFiles(files);
  const manifest = JSON.parse(files.get('manifest.json'));
  const expected = { format: 1, version: manifest.version, extensionId: manifestIdentity(manifest),
    files: Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }])) };
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) throw new Error('Verification inventory mismatch');
  return inventory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(process.argv[2]);
  const zip = await readFile(path);
  const checksum = (await readFile(path + '.sha256', 'utf8')).split(' ')[0];
  if (sha256(zip) !== checksum) throw new Error('ZIP checksum mismatch');
  console.log(JSON.stringify(verifyExtension(zip), null, 2));
}
