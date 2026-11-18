/**
 * Minimal zip extractor (store + deflate) for Kane `.evidence` archives. Reads the central
 * directory, so data descriptors and odd local headers are handled. No dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function extractZip(zipPath: string, destDir: string): string[] {
  const buf = readFileSync(zipPath);
  // End-of-central-directory record sits in the last 22..(22+65535) bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zipPath}: not a zip archive`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = resolve(destDir);
  const written: string[] = [];

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error(`${zipPath}: corrupt central directory`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    const target = resolve(root, name);
    if (target !== root && !target.startsWith(root + sep)) continue; // zip-slip guard

    if (buf.readUInt32LE(localOff) !== LOC_SIG) throw new Error(`${zipPath}: bad local header for ${name}`);
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else continue; // unsupported method: skip rather than fail the whole pack

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.push(join(destDir, name));
  }
  return written;
}
