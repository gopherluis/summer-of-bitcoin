import fs from 'node:fs'
import path from 'node:path'
import { build } from './builder.js'

const fixturePath = process.argv[2]

if (!fixturePath) {
  console.error('Usage: node dist/cli.js <fixture_path>')
  process.exit(1)
}

let raw: unknown
try {
  const content = fs.readFileSync(fixturePath, 'utf-8')
  raw = JSON.parse(content)
} catch (e: any) {
  console.error(`Error reading fixture: ${e.message}`)
  process.exit(1)
}

// build() é async — top-level await funciona em ESM (type: "module")
const result = await build(raw)

const basename = path.basename(fixturePath, '.json')
fs.mkdirSync('out', { recursive: true })
fs.writeFileSync(path.join('out', `${basename}.json`), JSON.stringify(result, null, 2))

if (result.ok) {
  console.error(`✓ ${basename}: ok — fee=${result.fee_sats} sats, vbytes=${result.vbytes}`)
  process.exit(0)
} else {
  console.error(`✗ ${basename}: error — ${result.error.code}: ${result.error.message}`)
  process.exit(1)
}