export type CardSide = 'anverso' | 'reverso'

export interface FieldRect {
  /** Stable per-document identifier used to sync the checkbox with its redaction rect. */
  id: string
  labelEn: string
  labelEs: string
  side: CardSide
  /** Normalized 0..1 coordinates within the card image. */
  x: number
  y: number
  w: number
  h: number
}

export interface DocumentTemplate {
  id: string
  labelEn: string
  labelEs: string
  aspect: number
  fields: FieldRect[]
  profiles: TemplateProfile[]
}

export interface TemplateProfile {
  id: string
  labelEn: string
  labelEs: string
  descriptionEn: string
  descriptionEs: string
  /** Field IDs this profile marks for censoring. */
  fieldIds: string[]
}
