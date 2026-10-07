/** Explicit local publication only. No fetch, provider token, database import or overwrite. */
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedRunReceiptFile } from './file-adapter.mjs';
import { convertGithubActionsExport, previewGithubActionsExport } from './github-actions.mjs';

export function writeGithubActionsReceipt(text, mapping, destination, options) {
  if (typeof destination !== 'string' || !destination) throw new TypeError('An explicit receipt destination is required');
  const file = convertGithubActionsExport(text, mapping, options);
  const preview = previewGithubActionsExport(text, mapping, options);
  const output = resolve(destination);
  // A trusted existing directory is required. Linking a complete same-filesystem
  // temporary file publishes atomically without following or replacing an output.
  const temporary = fs.mkdtempSync(join(dirname(output), '.pulseboard-receipt-'));
  try {
    const source = join(temporary, 'receipt.json'), fd = fs.openSync(source, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(file, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.linkSync(source, output);
    return preview;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const writing = args[0] === 'write' && args.length === 4;
  const explicitPreview = args[0] === 'preview' && args.length === 3;
  if (!writing && !explicitPreview && args.length !== 2) {
    console.error('Usage: node run-receipts/github-actions-file.mjs [preview] EXPORT MAPPING | write EXPORT MAPPING NEW_RECEIPT');
    process.exitCode = 2;
  } else {
    try {
      const [input, map, destination] = writing || explicitPreview ? args.slice(1) : args;
      const text = readBoundedRunReceiptFile(input), mapping = JSON.parse(readBoundedRunReceiptFile(map));
      const preview = writing ? writeGithubActionsReceipt(text, mapping, destination) : previewGithubActionsExport(text, mapping);
      console.log(JSON.stringify(preview, null, 2));
    } catch {
      console.error('Actions conversion refused: invalid or incomplete export, mismatched mapping, or unavailable output');
      process.exitCode = 1;
    }
  }
}
