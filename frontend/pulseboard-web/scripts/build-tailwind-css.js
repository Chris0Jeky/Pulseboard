import fs from 'fs'
import path from 'path'

const tailwindDir = path.resolve('node_modules', 'tailwindcss')
const themePath = path.join(tailwindDir, 'theme.css')
const preflightPath = path.join(tailwindDir, 'preflight.css')
const utilitiesPath = path.join(tailwindDir, 'utilities.css')

function transformThemeCss(css) {
  return css.replace('@theme default {', ':root {')
}

function build() {
  const themeCss = transformThemeCss(fs.readFileSync(themePath, 'utf8'))
  const preflightCss = fs.readFileSync(preflightPath, 'utf8')
  const utilitiesCss = fs.readFileSync(utilitiesPath, 'utf8')

  const output = `${themeCss}\n${preflightCss}\n${utilitiesCss}`
  fs.writeFileSync(path.resolve('src', 'tailwind.generated.css'), output)
  console.log('Generated src/tailwind.generated.css')
}

build()
