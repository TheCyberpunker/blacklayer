import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import type { MetadataMode } from '../types.ts'

/**
 * Apply metadata mode to a loaded PDFDocument.
 *
 * "neutralize" replaces every Info-dict field pdf-lib exposes with an empty or
 * BlackLayer-branded value. pdf-lib always writes /Producer as itself, so
 * "remove" and "neutralize" collapse to the same practical outcome for now.
 * "preserve" is a no-op.
 *
 * XMP metadata (a stream, not a dict) is not touched here yet. Documented as a
 * known limitation in the threat model; addressed when a proper XMP module lands.
 */
export function applyMetadataMode(pdf: PDFDocument, mode: MetadataMode): void {
  if (mode === 'preserve') return

  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setKeywords([])
  pdf.setProducer('BlackLayer')
  pdf.setCreator('BlackLayer')
  const now = new Date(0) // epoch; predictable and neutral
  pdf.setCreationDate(now)
  pdf.setModificationDate(now)
}

/**
 * Best-effort check: does the source PDF appear to carry an interactive digital
 * signature? Returns true when AcroForm SigFlags indicate one is present.
 */
export function hasDigitalSignature(pdf: PDFDocument): boolean {
  const catalog = pdf.catalog
  const acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  if (!acroForm) return false
  const sigFlags = acroForm.get(PDFName.of('SigFlags'))
  if (sigFlags && 'asNumber' in sigFlags && typeof (sigFlags as { asNumber(): number }).asNumber === 'function') {
    const flags = (sigFlags as { asNumber(): number }).asNumber()
    // Bit 1 (SignaturesExist) set means the form contains at least one signature.
    if ((flags & 1) === 1) return true
  }
  return false
}
