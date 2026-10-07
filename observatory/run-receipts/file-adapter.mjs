import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/sqlite.mjs';
import { RUN_RECEIPT_MAX_BYTES, previewRunReceiptFile } from './contracts.mjs';
import { importRunReceiptFile, validateRunReceiptImport } from './store.mjs';

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const regularInput = 'Run receipt input must be a regular non-symlink file';
const tooLarge = 'Run receipt file exceeds 256 KiB';
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const stableFile = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

export function readBoundedRunReceiptFile(filename) {
  if (typeof filename !== 'string' || filename.length === 0) throw new TypeError('A run receipt filename is required');
  const before = fs.lstatSync(filename, { throwIfNoEntry: false, bigint: true });
  if (!before?.isFile() || before.isSymbolicLink()) throw new TypeError(regularInput);
  if (before.size > RUN_RECEIPT_MAX_BYTES) throw new RangeError(tooLarge);
  // NONBLOCK prevents a replaced FIFO from hanging open; NOFOLLOW rejects a
  // final-component symlink where supported. fstat and identity checks apply too.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(filename, flags);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !stableFile(before, opened)) throw new TypeError('Run receipt input changed while opening');
    if (opened.size > RUN_RECEIPT_MAX_BYTES) throw new RangeError(tooLarge);
    const bytes = Buffer.alloc(RUN_RECEIPT_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > RUN_RECEIPT_MAX_BYTES) throw new RangeError(tooLarge);
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(filename, { throwIfNoEntry: false, bigint: true });
    if (BigInt(length) !== opened.size || !stableFile(opened, after) || !named?.isFile() ||
      !stableFile(after, named)) throw new TypeError('Run receipt input changed while reading');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { fs.closeSync(fd); }
}

export function previewRunReceiptPath(filename) {
  return previewRunReceiptFile(readBoundedRunReceiptFile(filename));
}

export async function importRunReceiptPath(filename, databasePath, options = {}) {
  if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath === ':memory:') {
    throw new TypeError('Import requires an explicit SQLite database path');
  }
  const text = readBoundedRunReceiptFile(filename);
  const checkedOptions = { ...options, now: options.now === undefined ? Date.now() : options.now };
  validateRunReceiptImport(text, checkedOptions);
  const resolvedDatabasePath = resolve(databasePath);
  const target = fs.lstatSync(resolvedDatabasePath, { throwIfNoEntry: false });
  if (target && (!target.isFile() || target.isSymbolicLink())) throw new TypeError('Database must be a regular non-symlink file');
  // The explicit output directory must be trusted. SQLite opens by pathname;
  // descriptor checks on input are not a cross-process lock on this destination.
  fs.mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
  const DB = openDatabase(resolvedDatabasePath);
  try {
    DB.exec(schema);
    return await importRunReceiptFile(DB, text, checkedOptions);
  } finally { DB.close(); }
}

function usage() {
  return 'Usage: node run-receipts/file-adapter.mjs preview FILE | import FILE SQLITE_DATABASE';
}

const mainPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (mainPath && fileURLToPath(import.meta.url) === mainPath) {
  const args = process.argv.slice(2), [command, filename, databasePath] = args;
  try {
    if (command === 'preview' && filename && args.length === 2) {
      console.log(JSON.stringify(previewRunReceiptPath(filename), null, 2));
    } else if (command === 'import' && filename && databasePath && args.length === 3) {
      console.log(JSON.stringify(await importRunReceiptPath(filename, databasePath), null, 2));
    } else {
      console.error(usage()); process.exitCode = 2;
    }
  } catch (error) {
    // JSON and filesystem errors can contain private source text and paths.
    const known = error instanceof Error && [regularInput, tooLarge].includes(error.message);
    console.error(known ? error.message : 'Run receipt operation refused: invalid input, conflicting evidence, or unavailable local storage');
    process.exitCode = 1;
  }
}
