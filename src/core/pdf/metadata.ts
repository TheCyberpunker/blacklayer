import { PDFDocument, PDFName, PDFDict, PDFRef } from 'pdf-lib'
import type { CustomMetadata, MetadataMode } from '../types.ts'

/**
 * Apply metadata mode to a loaded PDFDocument.
 *
 * "neutralize" clears / replaces every Info-dict field with an empty or
 * BlackLayer-branded value AND drops the XMP metadata stream from the catalog.
 * XMP holds edit history (xmpMM:History), a stable document UUID
 * (xmpMM:DocumentID) and app traces that leak more than the Info dict.
 *
 * "custom" writes user-supplied values into the Info dict (still drops XMP).
 * Empty fields become empty strings. CreationDate and ModDate are pinned to
 * epoch either way; forging document dates is out of scope.
 *
 * "preserve" is a no-op.
 */
export function applyMetadataMode(
  pdf: PDFDocument,
  mode: MetadataMode,
  custom?: CustomMetadata,
): void {
  if (mode === 'preserve') return

  const isCustom = mode === 'custom' && custom !== undefined
  pdf.setTitle(isCustom ? custom.title ?? '' : '')
  pdf.setAuthor(isCustom ? custom.author ?? '' : '')
  pdf.setSubject(isCustom ? custom.subject ?? '' : '')
  pdf.setKeywords(isCustom ? custom.keywords ?? [] : [])
  pdf.setProducer(isCustom ? custom.creator ?? 'BlackLayer' : 'BlackLayer')
  pdf.setCreator(isCustom ? custom.creator ?? 'BlackLayer' : 'BlackLayer')
  const now = new Date(0)
  pdf.setCreationDate(now)
  pdf.setModificationDate(now)

  // XMP metadata stream: dropped in both neutralize and custom modes.
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
 * Read Info-dict metadata from a source PDF (bytes). Returns a snapshot with
 * empty strings for missing fields. Used by the "Ver / editar metadatos"
 * dialog so the user can see what is currently embedded before deciding what
 * to keep, clear, or replace.
 */
export async function readPdfMetadata(
  sourceBytes: ArrayBuffer,
): Promise<{
  title: string
  author: string
  subject: string
  keywords: string[]
  creator: string
  producer: string
  creationDate: string
  modificationDate: string
}> {
  // Copy bytes because pdf-lib's parser may consume the underlying buffer.
  const copy = new Uint8Array(sourceBytes.byteLength)
  copy.set(new Uint8Array(sourceBytes))
  const pdf = await PDFDocument.load(copy, { updateMetadata: false })
  const fmt = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '')
  return {
    title: pdf.getTitle() ?? '',
    author: pdf.getAuthor() ?? '',
    subject: pdf.getSubject() ?? '',
    keywords: (pdf.getKeywords() ?? '').split(',').map((k) => k.trim()).filter(Boolean),
    creator: pdf.getCreator() ?? '',
    producer: pdf.getProducer() ?? '',
    creationDate: fmt(pdf.getCreationDate()),
    modificationDate: fmt(pdf.getModificationDate()),
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
