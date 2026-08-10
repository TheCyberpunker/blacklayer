import { PDFDocument, PDFName, PDFDict, PDFRef } from 'pdf-lib'
import type { MetadataMode } from '../types.ts'

/**
 * Apply metadata mode to a loaded PDFDocument.
 *
 * "neutralize" clears / replaces every field pdf-lib's Info-dict API exposes
 * with an empty or BlackLayer-branded value AND drops the XMP metadata stream
 * from the catalog. XMP is the noisier of the two: many producers write an
 * edit history (xmpMM:History), a stable document UUID (xmpMM:DocumentID),
 * and application traces (xmp:CreatorTool) that leak more than the Info dict.
 *
 * "preserve" is a no-op.
 */
export function applyMetadataMode(pdf: PDFDocument, mode: MetadataMode): void {
  if (mode === 'preserve') return

  // Info dictionary
  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setKeywords([])
  pdf.setProducer('BlackLayer')
  pdf.setCreator('BlackLayer')
  const now = new Date(0) // epoch; predictable and neutral
  pdf.setCreationDate(now)
  pdf.setModificationDate(now)

  // XMP metadata stream
  removeXmpMetadata(pdf)
}

/**
 * Delete the /Metadata entry from the document catalog and from each page dict
 * if present. Also deletes the underlying indirect stream object from the PDF
 * context so unreferenced XMP bytes do not survive save.
 *
 * XMP holds edit history, application traces, and stable document IDs. Losing
 * everything in the packet is the honest neutralize behaviour; nothing
 * BlackLayer needs from XMP.
 */
function removeXmpMetadata(pdf: PDFDocument): void {
  const metadataKey = PDFName.of('Metadata')

  const dropFrom = (dict: PDFDict): void => {
    const entry = dict.get(metadataKey)
    if (!entry) return
    dict.delete(metadataKey)
    if (entry instanceof PDFRef) {
      pdf.context.delete(entry)
    }
  }

  dropFrom(pdf.catalog)
  for (const page of pdf.getPages()) {
    dropFrom(page.node)
  }
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
