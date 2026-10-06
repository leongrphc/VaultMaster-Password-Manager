import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { releaseFiles, sha256, manifestIdentity, validateFiles } from './extension-release-policy.mjs';

// ZIP uses raw DEFLATE and CRC32 (integrity, not encryption). No secrets are
// present in the bundle; its identity key in manifest.json is a public key.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function packageExtension(output, target = 'chromium') {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  if (!['chromium', 'firefox'].includes(target)) throw new Error('Invalid extension browser');
  const stage = join(root, target === 'firefox' ? 'apps/extension/.package-build-firefox' : 'apps/extension/.package-build');
  try {
    execFileSync(process.execPath, [join(root, 'apps/extension/scripts/build.mjs'), stage, target], { cwd: root, stdio: 'inherit' });
    const files = new Map();
    for (const name of releaseFiles) files.set(name, await readFile(join(stage, name)));
    validateFiles(files);
    const manifest = JSON.parse(files.get('manifest.json'));
    const inventory = { format: 1, version: manifest.version, extensionId: manifestIdentity(manifest),
      files: Object.fromEntries([...files].map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }])) };
    await writeFile(join(stage, 'verification.json'), JSON.stringify(inventory, null, 2) + '\n');
    const locals = [], central = [];
    let offset = 0, count = 0;
    async function walk(directory, prefix = '') {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const path = join(directory, entry.name), name = prefix + entry.name;
        if (entry.isDirectory()) { await walk(path, name + '/'); continue; }
        if (!entry.isFile()) throw new Error('Only regular extension files may be packaged');
        if (name !== 'verification.json' && !releaseFiles.includes(name)) throw new Error('Unexpected extension release file');
        const bytes = await readFile(path), compressed = deflateRawSync(bytes), filename = Buffer.from(name), checksum = crc32(bytes);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
        local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(33, 14);
        header.writeUInt32LE(checksum, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(bytes.length, 24);
        header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
        locals.push(local, filename, compressed); central.push(header, filename);
        offset += local.length + filename.length + compressed.length; count++;
      }
    }
    await walk(stage);
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    await mkdir(resolve(output, '..'), { recursive: true });
    const zip = Buffer.concat([...locals, directory, end]);
    await writeFile(output, zip);
    await writeFile(output + '.sha256', `${sha256(zip)}  ${basename(output)}\n`);
    return sha256(zip);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2]) await packageExtension(resolve(process.argv[2]), process.argv[3] || 'chromium');
  else if (process.env.VAULTMASTER_STATIC_EXPORT === '1') await packageExtension(resolve('out/downloads/vaultmaster-extension.zip'));
}
