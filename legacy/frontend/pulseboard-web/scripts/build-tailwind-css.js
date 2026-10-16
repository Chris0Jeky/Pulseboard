import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const root = process.cwd()
const inputPath = path.resolve(root, 'src', 'tailwind.input.css')
const outputPath = path.resolve(root, 'src', 'tailwind.generated.css')

const result = await postcss([tailwindcss()]).process(
  fs.readFileSync(inputPath, 'utf8'),
  { from: inputPath, to: outputPath, map: false },
)
if (!result.css.trim()) throw new Error('Tailwind generated an empty stylesheet')
fs.writeFileSync(outputPath, result.css)
console.log('Generated src/tailwind.generated.css with Tailwind 4 PostCSS')
