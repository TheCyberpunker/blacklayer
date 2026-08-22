#!/usr/bin/env node
/**
 * Copy Tesseract.js worker + WASM out of node_modules and fetch language data
 * from tessdata_fast into public/tesseract/ so the app can run OCR fully
 * offline from the Docker image (no CDN, no external fetch at runtime).
 *
 * Runs as prebuild. Skips work when the target files already exist.
 */
import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const outDir = join(root, 'public', 'tesseract')
const langDir = join(outDir, 'lang-data')

mkdirSync(langDir, { recursive: true })

const workerSrc = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
const coreSrc = join(root, 'node_modules', 'tesseract.js-core')

const localFiles = [
  { from: workerSrc, to: join(outDir, 'worker.min.js') },
  {
    from: join(coreSrc, 'tesseract-core-simd-lstm.wasm.js'),
    to: join(outDir, 'tesseract-core-simd-lstm.wasm.js'),
  },
  {
    from: join(coreSrc, 'tesseract-core-simd-lstm.wasm'),
    to: join(outDir, 'tesseract-core-simd-lstm.wasm'),
  },
]

for (const f of localFiles) {
  if (existsSync(f.to)) {
    console.log(`ocr: keeping ${f.to} (${(statSync(f.to).size / 1024).toFixed(1)} KB)`)
    continue
  }
  if (!existsSync(f.from)) {
    console.error(`ocr: source missing ${f.from}`)
    process.exit(1)
  }
  copyFileSync(f.from, f.to)
  console.log(`ocr: copied ${f.to}`)
}

// tessdata_fast is the same LSTM-only model tesseract.js uses by default, but
// self-hosted. English + Spanish covers most of the ID documents we detect.
const LANGS = ['eng', 'spa']
const TESSDATA_BASE = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0'

for (const lang of LANGS) {
  const out = join(langDir, `${lang}.traineddata`)
  if (existsSync(out) && statSync(out).size > 1_000_000) {
    console.log(`ocr: keeping ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`)
    continue
  }
  const url = `${TESSDATA_BASE}/${lang}.traineddata`
  console.log(`ocr: fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`ocr: ${url} returned ${res.status}`)
    process.exit(1)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  writeFileSync(out, buf)
  console.log(`ocr: wrote ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
}

console.log('ocr: assets ready in public/tesseract/')
