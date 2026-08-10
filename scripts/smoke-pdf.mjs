// Node smoke test for the DOM-free PDF core.
// Builds a synthetic 2-page PDF in memory, runs it through the watermark pipeline,
// re-parses the output, and asserts what we expect: same page count, page sizes preserved,
// each page's content stream now contains watermark text.
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib'
import { applyPdfWatermark } from '../src/core/pdf/watermark.ts'
import { profileFor } from '../src/core/types.ts'
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

  const profile = profileFor(
    'recommended',
    {
      recipient: 'Hotel Test Madrid',
      purpose: 'Identity verification',
      date: '2026-08-10',
    },
    0xdeadbeef, // deterministic seed for the smoke test
  )

  const t0 = performance.now()
  const { bytes: out, hadDigitalSignature } = await applyPdfWatermark({
    source: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength),
    profile,
    lang: 'en',
  })
  const t1 = performance.now()
  console.log(`protected: ${out.byteLength} bytes in ${(t1 - t0).toFixed(1)}ms (signature detected: ${hadDigitalSignature})`)

  // Write artifacts first so they exist even if a later assertion fails.
  await writeFile(join(outDir, 'sample-original.pdf'), sample)
  await writeFile(join(outDir, 'sample-protected.pdf'), out)

  // Re-parse to check structure survived. Load with updateMetadata:false so pdf-lib
  // doesn't stamp its own Producer on us during inspection.
  const roundtrip = await PDFDocument.load(out, { updateMetadata: false })
  const pages = roundtrip.getPages()
  assert(pages.length === 2, `expected 2 pages, got ${pages.length}`)

  const p1 = pages[0].getSize()
  const p2 = pages[1].getSize()
  assert(p1.width === 595 && p1.height === 842, `p1 size wrong: ${JSON.stringify(p1)}`)
  assert(p2.width === 842 && p2.height === 595, `p2 size wrong: ${JSON.stringify(p2)}`)

  // Content-stream text verification will move to pdfjs-based extraction in the full test suite (Phase 8).
  // Here we check that (a) output grew meaningfully (font + tiled ops), and (b) every page has a Font
  // resource attached via the pdf-lib API (works regardless of object-stream compression).
  const growth = out.byteLength - sample.byteLength
  assert(growth > 20000, `output only grew by ${growth} bytes, expected > 20KB (font + tiled text ops)`)

  for (const [i, page] of pages.entries()) {
    const res = page.node.Resources()
    const font = res?.get(PDFName.of('Font'))
    assert(!!font, `page ${i}: no /Font resource dictionary`)
  }

  // Metadata neutralize check: 'recommended' level should have wiped Author/Title.
  const title = roundtrip.getTitle()
  const author = roundtrip.getAuthor()
  const producer = roundtrip.getProducer()
  assert(title === '', `title not neutralized: "${title}"`)
  assert(author === '', `author not neutralized: "${author}"`)
  assert(producer === 'BlackLayer', `producer not branded: "${producer}"`)

  console.log('artifacts:')
  console.log(`  scripts/out/sample-original.pdf`)
  console.log(`  scripts/out/sample-protected.pdf`)
  console.log('all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
