import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/sqlite.mjs';
import { RUN_RECEIPT_MAX_BYTES, previewRunReceiptFile } from './contracts.mjs';
import { importRunReceiptFile } from './store.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function readBoundedRunReceiptFile(filename) {
  if (typeof filename !== 'string' || filename.length === 0) throw new TypeError('A run receipt filename is required');
  const stat = lstatSync(filename, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new TypeError('Run receipt input must be a regular non-symlink file');
  if (stat.size > RUN_RECEIPT_MAX_BYTES) throw new RangeError('Run receipt file exceeds 256 KiB');
  const bytes = readFileSync(filename);
  if (bytes.byteLength > RUN_RECEIPT_MAX_BYTES) throw new RangeError('Run receipt file exceeds 256 KiB');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function previewRunReceiptPath(filename) {
  return previewRunReceiptFile(readBoundedRunReceiptFile(filename));
}

export async function importRunReceiptPath(filename, databasePath, options = {}) {
  if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath === ':memory:') {
    throw new TypeError('Import requires an explicit SQLite database path');
  }
  const DB = openDatabase(databasePath);
  try {
    DB.exec(schema);
    return await importRunReceiptFile(DB, readBoundedRunReceiptFile(filename), options);
  } finally { DB.close(); }
}

function usage() {
  return 'Usage: node run-receipts/file-adapter.mjs preview FILE | import FILE SQLITE_DATABASE';
}

const mainPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (mainPath && fileURLToPath(import.meta.url) === mainPath) {
  const [command, filename, databasePath] = process.argv.slice(2);
  try {
    if (command === 'preview' && filename && databasePath === undefined) {
      console.log(JSON.stringify(previewRunReceiptPath(filename), null, 2));
    } else if (command === 'import' && filename && databasePath) {
      console.log(JSON.stringify(await importRunReceiptPath(filename, databasePath), null, 2));
    } else {
      console.error(usage()); process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
