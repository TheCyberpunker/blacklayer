export const DOCUMENT_TYPES = [
  'identity',
  'passport',
  'driving_licence',
  'contract',
  'payslip',
  'invoice',
  'financial',
  'unknown',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export type IdSubtype = 'dni' | 'nie' | 'tie' | 'passport' | 'driving_licence' | null
export type Country = 'ES' | 'EU' | 'other' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'

export interface DetectionResult {
  type: DocumentType
  subtype: IdSubtype
  country: Country
  confidence: Confidence
  reasons: string[]
  /** True when the current result came from an explicit manual pick, not heuristics. */
  manual: boolean
}

export const UNKNOWN_DETECTION: DetectionResult = {
  type: 'unknown',
  subtype: null,
  country: 'unknown',
  confidence: 'unknown',
  reasons: [],
  manual: false,
}
