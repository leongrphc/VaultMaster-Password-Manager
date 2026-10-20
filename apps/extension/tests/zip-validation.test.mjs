import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { verifyExtension } from '../../../scripts/verify-extension.mjs';
import { releaseFiles, manifestIdentity, sha256 } from '../../../scripts/extension-release-policy.mjs';

// Synthetic release payload: no build tools, network, or user data required.
const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url)));
manifest.content_security_policy = {
  extension_pages: "script-src 'self'; object-src 'none'; connect-src https://example.test; base-uri 'none'; frame-src 'none'",
};
const files = new Map(releaseFiles.map(name => [name, Buffer.from(
  name === 'manifest.json' ? JSON.stringify(manifest) :
    name === 'config.js' ? 'export const API_URL = "https://example.test/api";\n' : '// fixture\n',
)]));
const inventory = { format: 1, version: manifest.version, extensionId: manifestIdentity(manifest),
  files: Object.fromEntries([...files].map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }])) };
files.set('verification.json', Buffer.from(JSON.stringify(inventory)));

function checksum(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
function archive() {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum(bytes), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const valid = archive();
const end = valid.length - 22;
const central = valid.readUInt32LE(end + 16);

test('accepts a complete release archive with a matching inventory', () => {
  assert.deepEqual(verifyExtension(valid), inventory);
});

const mutations = {
  'central compression method': zip => zip.writeUInt16LE(0, central + 10),
  'central flags': zip => zip.writeUInt16LE(0, central + 8),
  'central disk number': zip => zip.writeUInt16LE(1, central + 34),
  'local offset': zip => zip.writeUInt32LE(1, central + 42),
  'end disk number': zip => zip.writeUInt16LE(1, end + 4),
  'directory disk number': zip => zip.writeUInt16LE(1, end + 6),
  'disk entry count': zip => zip.writeUInt16LE(0, end + 8),
  'total entry count': zip => zip.writeUInt16LE(0, end + 10),
  'directory size': zip => zip.writeUInt32LE(1, end + 12),
  'directory offset': zip => zip.writeUInt32LE(1, end + 16),
  'missing end comment': zip => zip.writeUInt16LE(1, end + 20),
  'matching but incorrect CRCs': zip => {
    zip.writeUInt32LE(0, 14);
    zip.writeUInt32LE(0, central + 16);
  },
  'matching but incorrect uncompressed sizes': zip => {
    zip.writeUInt32LE(1, 22);
    zip.writeUInt32LE(1, central + 24);
  },
  'overstated uncompressed sizes': zip => {
    zip.writeUInt32LE(1000, 22);
    zip.writeUInt32LE(1000, central + 24);
  },
  'oversized compressed payload': zip => zip.writeUInt32LE(0xffffffff, 18),
  'unexpected filename': zip => zip.fill(0x78, 30, 30 + zip.readUInt16LE(26)),
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const zip = Buffer.from(valid);
    mutate(zip);
    assert.throws(() => verifyExtension(zip));
  });
}
test('rejects truncation at every byte boundary without raw buffer range errors', () => {
  for (let length = 0; length < valid.length; length++) {
    assert.throws(() => verifyExtension(valid.subarray(0, length)),
      error => error instanceof Error && error.code !== 'ERR_OUT_OF_RANGE', `length ${length}`);
  }
});
test('rejects appended bytes', () => {
  assert.throws(() => verifyExtension(Buffer.concat([valid, Buffer.from([0])])));
});
test('rejects trailing bytes hidden inside a compressed entry with consistent offsets', () => {
  const payloadEnd = 30 + valid.readUInt16LE(26) + valid.readUInt32LE(18);
  const zip = Buffer.concat([valid.subarray(0, payloadEnd), Buffer.from([0]), valid.subarray(payloadEnd)]);
  zip.writeUInt32LE(valid.readUInt32LE(18) + 1, 18);
  let cursor = central + 1;
  zip.writeUInt32LE(valid.readUInt32LE(18) + 1, cursor + 20);
  for (let index = 0; index < files.size; index++) {
    if (index > 0) zip.writeUInt32LE(zip.readUInt32LE(cursor + 42) + 1, cursor + 42);
    cursor += 46 + zip.readUInt16LE(cursor + 28);
  }
  zip.writeUInt32LE(central + 1, end + 1 + 16);
  assert.throws(() => verifyExtension(zip), /ZIP entry integrity mismatch/);
});
