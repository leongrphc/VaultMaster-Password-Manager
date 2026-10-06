import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { sha256, validateFiles, extensionId } from './extension-release-policy.mjs';
export function verifyExtension(zip) {
  const files = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    if (zip.readUInt16LE(offset + 6) !== 0x800 || zip.readUInt16LE(offset + 8) !== 8) throw new Error('Unexpected ZIP encoding');
    const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + length).toString();
    if (files.has(name)) throw new Error('Duplicate ZIP entry');
    const start = offset + 30 + length + extra;
    files.set(name, inflateRawSync(zip.subarray(start, start + size)));
    offset = start + size;
  }
  // Validate the central directory too: extraction tools use it rather than local headers.
  const centralNames = [];
  while (zip.readUInt32LE(offset) === 0x02014b50) {
    const length = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString();
    const localOffset = zip.readUInt32LE(offset + 42);
    if (zip.readUInt32LE(localOffset) !== 0x04034b50 ||
        !zip.subarray(offset + 46, offset + 46 + length).equals(zip.subarray(localOffset + 30, localOffset + 30 + length)) ||
        !zip.subarray(offset + 16, offset + 28).equals(zip.subarray(localOffset + 14, localOffset + 26))) throw new Error('ZIP directory mismatch');
    centralNames.push(name);
    offset += 46 + length + extra + comment;
  }
  if (zip.readUInt32LE(offset) !== 0x06054b50 || offset + 22 !== zip.length ||
      zip.readUInt16LE(offset + 10) !== files.size ||
      JSON.stringify(centralNames) !== JSON.stringify([...files.keys()])) throw new Error('ZIP directory entries mismatch');
  const inventory = JSON.parse(files.get('verification.json'));
  files.delete('verification.json');
  validateFiles(files);
  const manifest = JSON.parse(files.get('manifest.json'));
  const expected = { format: 1, version: manifest.version, extensionId: extensionId(manifest.key),
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
