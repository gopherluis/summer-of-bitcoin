import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../builder.js'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json({ limit: '10mb' }))

const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))

const fixturesDir = path.resolve('./fixtures')
app.use('/fixtures', express.static(fixturesDir))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/fixtures', (_req, res) => {
  try {
    const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort()
    res.json(files)
  } catch {
    res.status(500).json([])
  }
})

// async: build() é async desde a otimização lazy-init do tiny-secp256k1
app.post('/api/build', async (req, res) => {
  const result = await build(req.body)
  res.json(result)
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}`)
})