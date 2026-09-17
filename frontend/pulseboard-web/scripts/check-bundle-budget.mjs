import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = path.resolve(process.cwd(), 'dist')
const INITIAL_JS_MAX_BYTES = 250_000
const CHUNK_JS_MAX_BYTES = 500_000

function fail(message) {
  console.error(`Bundle budget failed: ${message}`)
  process.exitCode = 1
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(absolute)
    return entry.isFile() && entry.name.endsWith('.js') ? [absolute] : []
  })
}

const indexPath = path.join(DIST, 'index.html')
const serviceWorkerPath = path.join(DIST, 'sw.js')
if (!existsSync(indexPath)) {
  throw new Error('dist/index.html is missing; run npm run build before checking the bundle budget')
}
if (!existsSync(serviceWorkerPath)) {
  throw new Error('dist/sw.js is missing; the production build must generate its offline manifest')
}

const indexHtml = readFileSync(indexPath, 'utf8')
const initialReferences = [
  ...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.js(?:[?#][^"']*)?)["']/g),
].map((match) => match[1].split(/[?#]/, 1)[0])

const initialFiles = [...new Set(initialReferences)].map((reference) => {
  const relative = reference.replace(/^\/+/, '')
  const absolute = path.resolve(DIST, relative)
  if (absolute !== DIST && !absolute.startsWith(DIST + path.sep)) {
    throw new Error(`initial JavaScript reference leaves dist: ${reference}`)
  }
  if (!existsSync(absolute)) throw new Error(`initial JavaScript reference is missing: ${reference}`)
  return absolute
})

if (initialFiles.length === 0) fail('index.html contains no initial JavaScript references')

const allFiles = javascriptFiles(DIST)
const describe = (file) => {
  const bytes = statSync(file).size
  return {
    file: path.relative(DIST, file).split(path.sep).join('/'),
    bytes,
    gzipBytes: gzipSync(readFileSync(file)).length,
  }
}
const chunks = allFiles.map(describe).sort((a, b) => b.bytes - a.bytes)
const initial = initialFiles.map(describe)
const initialBytes = initial.reduce((total, item) => total + item.bytes, 0)
const initialGzipBytes = initial.reduce((total, item) => total + item.gzipBytes, 0)
const largestChunk = chunks[0]

if (initialBytes > INITIAL_JS_MAX_BYTES) {
  fail(`initial JavaScript is ${initialBytes} bytes; budget is ${INITIAL_JS_MAX_BYTES}`)
}
if (largestChunk && largestChunk.bytes > CHUNK_JS_MAX_BYTES) {
  fail(`${largestChunk.file} is ${largestChunk.bytes} bytes; per-chunk budget is ${CHUNK_JS_MAX_BYTES}`)
}

// Route splitting must not trade initial transfer for broken offline navigation. Workbox emits
// the precache manifest inside sw.js, so every hashed application chunk and the registration
// helper must remain named there. The service worker and its Workbox runtime are bootstrap files,
// not entries in their own precache manifest.
const serviceWorker = readFileSync(serviceWorkerPath, 'utf8')
const offlineJavaScript = chunks
  .map((chunk) => chunk.file)
  .filter((file) => file === 'registerSW.js' || file.startsWith('assets/'))
const missingFromPrecache = offlineJavaScript.filter((file) => !serviceWorker.includes(file))
if (missingFromPrecache.length > 0) {
  fail(`PWA precache is missing JavaScript chunks: ${missingFromPrecache.join(', ')}`)
}

console.log(JSON.stringify({
  budgets: {
    initialJavaScriptBytes: INITIAL_JS_MAX_BYTES,
    individualChunkBytes: CHUNK_JS_MAX_BYTES,
  },
  initialBytes,
  initialGzipBytes,
  initial,
  largestChunks: chunks.slice(0, 8),
  pwa: {
    serviceWorker: 'sw.js',
    precachedJavaScriptChunks: offlineJavaScript.length,
    missingJavaScriptChunks: missingFromPrecache,
  },
}, null, 2))
