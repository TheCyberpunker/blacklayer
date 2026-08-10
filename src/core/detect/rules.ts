import type { DocumentType, IdSubtype } from './types.ts'

/**
 * Keyword tables. Case-insensitive matches. Left side is what we look for in
 * filename or text; right side is what we call the document.
 *
 * Keep entries specific. Generic words like "document" or "file" cause false
 * positives. Multi-word phrases beat single tokens.
 */
export interface Rule {
  type: DocumentType
  subtype: IdSubtype
  country: 'ES' | 'EU' | 'other' | 'unknown'
  patterns: string[]
  /** Weight added to the type score when any pattern hits. */
  weight: number
}

export const RULES: Rule[] = [
  // Spanish DNI
  {
    type: 'identity',
    subtype: 'dni',
    country: 'ES',
    weight: 3,
    patterns: [
      'documento nacional de identidad',
      'reino de españa',
      'dni-e',
    ],
  },
  {
    type: 'identity',
    subtype: 'dni',
    country: 'ES',
    weight: 2,
    patterns: ['dni', 'españa', 'espana'],
  },

  // Spanish NIE / TIE
  {
    type: 'identity',
    subtype: 'nie',
    country: 'ES',
    weight: 3,
    patterns: [
      'numero de identidad de extranjero',
      'número de identidad de extranjero',
      'permiso de residencia',
    ],
  },
  {
    type: 'identity',
    subtype: 'nie',
    country: 'ES',
    weight: 2,
    patterns: ['nie ', 'tie ', 'tarjeta de identidad de extranjero'],
  },

  // Passport
  {
    type: 'passport',
    subtype: 'passport',
    country: 'unknown',
    weight: 3,
    patterns: ['passport', 'pasaporte', 'reisepass', 'passeport'],
  },

  // Driving licence
  {
    type: 'driving_licence',
    subtype: 'driving_licence',
    country: 'unknown',
    weight: 3,
    patterns: [
      'permiso de conducir',
      'driving licence',
      'driver license',
      "driver's license",
      'permis de conduire',
      'führerschein',
    ],
  },

  // Contract
  {
    type: 'contract',
    subtype: null,
    country: 'unknown',
    weight: 2,
    patterns: [
      'contrato de',
      'las partes',
      'cláusulas',
      'clausulas',
      'firmado en',
      'agreement between',
      'this agreement',
      'terms and conditions',
    ],
  },
  {
    type: 'contract',
    subtype: null,
    country: 'unknown',
    weight: 1,
    patterns: ['contrato', 'contract'],
  },

  // Payslip
  {
    type: 'payslip',
    subtype: null,
    country: 'unknown',
    weight: 3,
    patterns: [
      'nómina',
      'nomina',
      'recibo de salarios',
      'payslip',
      'pay slip',
      'salary slip',
      'earnings statement',
      'devengos',
    ],
  },
  {
    type: 'payslip',
    subtype: null,
    country: 'unknown',
    weight: 1,
    patterns: ['salario', 'salary', 'gross', 'net pay'],
  },

  // Invoice
  {
    type: 'invoice',
    subtype: null,
    country: 'unknown',
    weight: 3,
    patterns: [
      'factura',
      'invoice number',
      'nº factura',
      'no. factura',
      'tax invoice',
      'proforma',
    ],
  },
  {
    type: 'invoice',
    subtype: null,
    country: 'unknown',
    weight: 1,
    patterns: ['invoice', 'iva ', 'vat '],
  },

  // Generic financial (bank statement, etc)
  {
    type: 'financial',
    subtype: null,
    country: 'unknown',
    weight: 2,
    patterns: [
      'bank statement',
      'extracto bancario',
      'account statement',
      'certificado bancario',
    ],
  },
]

/**
 * Filename-only hints. Users often name files after their content.
 * Weights are lower than in-document text hits.
 */
export interface FilenameHint {
  type: DocumentType
  subtype: IdSubtype
  country: 'ES' | 'EU' | 'other' | 'unknown'
  patterns: string[]
}

export const FILENAME_HINTS: FilenameHint[] = [
  { type: 'identity', subtype: 'dni', country: 'ES', patterns: ['dni', 'documento-identidad', 'documento_identidad'] },
  { type: 'identity', subtype: 'nie', country: 'ES', patterns: ['nie', 'tie'] },
  { type: 'passport', subtype: 'passport', country: 'unknown', patterns: ['passport', 'pasaporte'] },
  { type: 'driving_licence', subtype: 'driving_licence', country: 'unknown', patterns: ['licence', 'license', 'carnet', 'permiso-conducir', 'permiso_conducir'] },
  { type: 'contract', subtype: null, country: 'unknown', patterns: ['contract', 'contrato'] },
  { type: 'payslip', subtype: null, country: 'unknown', patterns: ['payslip', 'nomina', 'nómina', 'salary'] },
  { type: 'invoice', subtype: null, country: 'unknown', patterns: ['invoice', 'factura'] },
  { type: 'financial', subtype: null, country: 'unknown', patterns: ['statement', 'extracto', 'bank', 'banco'] },
]

/**
 * Aspect-ratio hints for images. ID cards fall around 1.586:1 (ISO 7810 ID-1),
 * A4 portraits at ~0.707, passports around 1.42.
 */
export interface AspectHint {
  type: DocumentType
  subtype: IdSubtype
  minAspect: number
  maxAspect: number
  weight: number
}

// Aspect = width / height. Both orientations of a card fall in one of two bands.
export const ASPECT_HINTS: AspectHint[] = [
  { type: 'identity', subtype: null, minAspect: 1.5, maxAspect: 1.7, weight: 2 }, // landscape card
  { type: 'identity', subtype: null, minAspect: 0.58, maxAspect: 0.67, weight: 2 }, // portrait card
]
