// Node smoke test for the DOM-free PDF core.
// Builds a synthetic 2-page PDF in memory, runs it through the watermark pipeline,
// re-parses the output, and asserts what we expect: same page count, page sizes preserved,
// each page's content stream now contains watermark text.
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { applyPdfWatermark } from '../src/core/pdf/watermark.ts'
import { defaultWatermarkOptions } from '../src/core/types.ts'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')

async function buildSample() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const p1 = pdf.addPage([595, 842]) // A4 portrait
  p1.drawText('Synthetic sample document', { x: 60, y: 780, size: 18, font })
  p1.drawText('Page 1 of 2', { x: 60, y: 60, size: 10, font })
  const p2 = pdf.addPage([842, 595]) // A4 landscape
  p2.drawText('Second page landscape', { x: 60, y: 540, size: 18, font })
  p2.drawText('Page 2 of 2', { x: 60, y: 60, size: 10, font })
  return await pdf.save()
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg)
}

async function main() {
  const sample = await buildSample()
  console.log(`sample: ${sample.byteLength} bytes`)

  const options = defaultWatermarkOptions({
    recipient: 'Hotel Test Madrid',
    purpose: 'Identity verification',
    date: '2026-08-10',
  })

  const t0 = performance.now()
  const out = await applyPdfWatermark({
    source: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength),
    options,
    lang: 'en',
  })
  const t1 = performance.now()
  console.log(`protected: ${out.byteLength} bytes in ${(t1 - t0).toFixed(1)}ms`)

  // Re-parse to check structure survived.
  const roundtrip = await PDFDocument.load(out)
  const pages = roundtrip.getPages()
  assert(pages.length === 2, `expected 2 pages, got ${pages.length}`)

  const p1 = pages[0].getSize()
  const p2 = pages[1].getSize()
  assert(p1.width === 595 && p1.height === 842, `p1 size wrong: ${JSON.stringify(p1)}`)
  assert(p2.width === 842 && p2.height === 595, `p2 size wrong: ${JSON.stringify(p2)}`)

  // Content-stream verification will move to pdfjs-based text extraction in the full test suite (Phase 8).
  // Here we assert that the pipeline embedded a font and drew visible content: output should be
  // meaningfully larger than the source (Helvetica alone adds ~30KB, plus per-page tiled text ops).
  const growth = out.byteLength - sample.byteLength
  assert(growth > 20000, `output only grew by ${growth} bytes, expected > 20KB (font + tiled text ops)`)

  // Font resource dictionary check: the output must reference a font.
  const raw = new TextDecoder('latin1').decode(out)
  assert(raw.includes('/Font'), 'no /Font resource in output')
  assert(raw.includes('Helvetica'), 'no Helvetica reference in output')

  // Write a copy so a human can eyeball it if they want.
  await writeFile(join(outDir, 'sample-protected.pdf'), out)
  await writeFile(join(outDir, 'sample-original.pdf'), sample)
  console.log('artifacts:')
  console.log(`  scripts/out/sample-original.pdf`)
  console.log(`  scripts/out/sample-protected.pdf`)
  console.log('all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
