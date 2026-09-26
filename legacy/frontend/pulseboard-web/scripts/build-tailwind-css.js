import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const cliPath = path.resolve(root, 'node_modules', 'tailwindcss', 'lib', 'cli.js')
const inputPath = path.resolve(root, 'src', 'tailwind.input.css')
const outputPath = path.resolve(root, 'src', 'tailwind.generated.css')

for (const [label, file] of [
  ['Tailwind CLI', cliPath],
  ['Tailwind input stylesheet', inputPath],
]) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label} is missing: ${file}`)
  }
}

const result = spawnSync(
  process.execPath,
  [cliPath, '-i', inputPath, '-o', outputPath],
  { cwd: root, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
  throw new Error('Tailwind generated an empty stylesheet')
}

console.log('Generated src/tailwind.generated.css with the installed Tailwind 3 CLI')
