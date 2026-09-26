import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const root = path.resolve(process.argv[2] || 'dist')
const entryBudget = 150_000
const chunkBudget = 500_000
const chartChunkPrefixes = ['assets/charts-echarts-', 'assets/charts-renderer-']

function filesBelow(directory, relative = '') {
  return readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name)
    return entry.isDirectory() ? filesBelow(directory, child) : [child.replaceAll('\\', '/')]
  })
}

function fail(messages) {
  for (const message of messages) console.error(`bundle-budget: ${message}`)
  process.exitCode = 1
}

const indexPath = path.join(root, 'index.html')
const workerPath = path.join(root, 'sw.js')
if (!existsSync(indexPath) || !existsSync(workerPath)) {
  fail(['run the production build first; dist/index.html and dist/sw.js are required'])
} else {
  const html = readFileSync(indexPath, 'utf8')
  const scriptTags = html.match(/<script\b[^>]*>/gi) || []
  const moduleTag = scriptTags.find((tag) => /\btype=["']module["']/i.test(tag))
  const entrySource = moduleTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1]
  const entry = entrySource?.replace(/^\.?\//, '')
  const modulePreloads = (html.match(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi) || [])
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.replace(/^\.?\//, ''))
    .filter(Boolean)
  const assets = filesBelow(root).filter((name) => /\.(?:js|css)$/.test(name) && name !== 'sw.js')
  const javascript = assets.filter((name) => name.endsWith('.js'))
  const applicationAssets = assets.filter((name) => name.startsWith('assets/') || name === 'registerSW.js')
  const serviceWorker = readFileSync(workerPath, 'utf8')
  const errors = []

  if (!entry || !javascript.includes(entry)) {
    errors.push(`could not resolve the module entry from index.html (${entrySource || 'missing src'})`)
  }
  if (javascript.length < 2) {
    errors.push(`expected code splitting, found ${javascript.length} JavaScript asset`)
  }
  for (const prefix of chartChunkPrefixes) {
    if (!javascript.some((name) => name.startsWith(prefix))) {
      errors.push(`missing measured chart chunk ${prefix}*.js`)
    }
  }
  const eagerCharts = modulePreloads.filter((name) => chartChunkPrefixes.some((prefix) => name.startsWith(prefix)))
  if (eagerCharts.length) {
    errors.push(`lazy chart chunks are eagerly module-preloaded: ${eagerCharts.join(', ')}`)
  }

  const rows = assets.map((name) => {
    const file = path.join(root, name)
    const bytes = statSync(file).size
    return { file: name, bytes, gzip: gzipSync(readFileSync(file)).length, entry: name === entry }
  }).sort((a, b) => b.bytes - a.bytes)

  const entryRow = rows.find((row) => row.entry)
  if (entryRow && entryRow.bytes > entryBudget) {
    errors.push(`entry ${entryRow.file} is ${entryRow.bytes} bytes; budget is ${entryBudget}`)
  }
  for (const row of rows.filter((item) => item.file.endsWith('.js'))) {
    if (row.bytes > chunkBudget) {
      errors.push(`chunk ${row.file} is ${row.bytes} bytes; budget is ${chunkBudget}`)
    }
  }

  // Workbox's generated runtime is loaded by the service worker rather than included in
  // its own precache manifest. Every application JS/CSS asset and the registration shim
  // must still be named in the generated worker so route chunks remain available offline.
  const missingFromPrecache = applicationAssets.filter((name) => !serviceWorker.includes(name))
  if (missingFromPrecache.length) {
    errors.push(`service worker does not precache: ${missingFromPrecache.join(', ')}`)
  }

  console.log(JSON.stringify({
    budgets: { entryBytes: entryBudget, chunkBytes: chunkBudget },
    entry,
    modulePreloads,
    chartChunksLazy: eagerCharts.length === 0,
    assets: rows,
    precache: {
      checked: applicationAssets,
      verified: missingFromPrecache.length === 0,
    },
  }, null, 2))

  if (errors.length) fail(errors)
}
