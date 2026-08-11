import type { DocumentTemplate, FieldRect, TemplateProfile } from './types.ts'

/**
 * ICAO 9303 TD3 passport data page — approximate normalized layout.
 *
 * The physical data page is 125mm × 88mm (aspect ~1.42). Real photos vary
 * (skew, crop, glare), so these coordinates aim to hit the field in the common
 * case rather than to be pixel-perfect. Users can add manual rectangles for
 * anything the template misses.
 *
 * Only anverso (data page) is modelled — the observation pages (blank + visa)
 * are not standardized enough to template usefully.
 */
const FIELDS: FieldRect[] = [
  { id: 'photo', side: 'anverso', labelEn: 'Photo', labelEs: 'Fotografía', x: 0.045, y: 0.16, w: 0.30, h: 0.56 },
  { id: 'type', side: 'anverso', labelEn: 'Type', labelEs: 'Tipo', x: 0.38, y: 0.16, w: 0.10, h: 0.06 },
  { id: 'country_code', side: 'anverso', labelEn: 'Country code', labelEs: 'Código de país', x: 0.50, y: 0.16, w: 0.14, h: 0.06 },
  { id: 'passport_number', side: 'anverso', labelEn: 'Passport number', labelEs: 'Número de pasaporte', x: 0.66, y: 0.16, w: 0.30, h: 0.06 },
  { id: 'surname', side: 'anverso', labelEn: 'Surname', labelEs: 'Apellidos', x: 0.38, y: 0.24, w: 0.58, h: 0.07 },
  { id: 'given_names', side: 'anverso', labelEn: 'Given names', labelEs: 'Nombres', x: 0.38, y: 0.33, w: 0.58, h: 0.07 },
  { id: 'nationality', side: 'anverso', labelEn: 'Nationality', labelEs: 'Nacionalidad', x: 0.38, y: 0.42, w: 0.32, h: 0.06 },
  { id: 'date_of_birth', side: 'anverso', labelEn: 'Date of birth', labelEs: 'Fecha de nacimiento', x: 0.38, y: 0.50, w: 0.28, h: 0.06 },
  { id: 'sex', side: 'anverso', labelEn: 'Sex', labelEs: 'Sexo', x: 0.68, y: 0.50, w: 0.10, h: 0.06 },
  { id: 'place_of_birth', side: 'anverso', labelEn: 'Place of birth', labelEs: 'Lugar de nacimiento', x: 0.38, y: 0.58, w: 0.42, h: 0.06 },
  { id: 'date_of_issue', side: 'anverso', labelEn: 'Date of issue', labelEs: 'Fecha de expedición', x: 0.38, y: 0.66, w: 0.28, h: 0.06 },
  { id: 'date_of_expiry', side: 'anverso', labelEn: 'Date of expiry', labelEs: 'Fecha de caducidad', x: 0.68, y: 0.66, w: 0.28, h: 0.06 },
  { id: 'authority', side: 'anverso', labelEn: 'Authority', labelEs: 'Autoridad', x: 0.38, y: 0.74, w: 0.42, h: 0.06 },
  { id: 'signature', side: 'anverso', labelEn: 'Signature', labelEs: 'Firma', x: 0.045, y: 0.75, w: 0.30, h: 0.10 },
  { id: 'mrz', side: 'anverso', labelEn: 'MRZ (machine-readable zone)', labelEs: 'MRZ (zona legible)', x: 0.02, y: 0.86, w: 0.96, h: 0.13 },
]

const PROFILES: TemplateProfile[] = [
  {
    id: 'travel',
    labelEn: 'Travel',
    labelEs: 'Viajes',
    descriptionEn: 'For bookings and ID checks',
    descriptionEs: 'Para reservas y controles',
    fieldIds: ['passport_number', 'signature', 'date_of_issue', 'date_of_expiry', 'authority', 'place_of_birth', 'mrz'],
  },
  {
    id: 'hotel',
    labelEn: 'Hotel check-in',
    labelEs: 'Registro en hotel',
    descriptionEn: 'For hotel and accommodation check-in',
    descriptionEs: 'Para registro en hoteles y alojamientos',
    fieldIds: ['passport_number', 'signature', 'date_of_issue', 'authority', 'place_of_birth', 'mrz'],
  },
  {
    id: 'visa',
    labelEn: 'Visa application',
    labelEs: 'Solicitud de visado',
    descriptionEn: 'For visa and immigration paperwork',
    descriptionEs: 'Para solicitudes de visado y trámites migratorios',
    fieldIds: ['signature'],
  },
  {
    id: 'banking',
    labelEn: 'Banking / KYC',
    labelEs: 'Financiero / Banca',
    descriptionEn: 'For bank verifications and KYC',
    descriptionEs: 'Para verificaciones bancarias y KYC',
    fieldIds: ['signature', 'mrz', 'place_of_birth', 'authority'],
  },
]

export const PASSPORT_TEMPLATE: DocumentTemplate = {
  id: 'passport',
  labelEn: 'Passport',
  labelEs: 'Pasaporte',
  aspect: 1.42,
  fields: FIELDS,
  profiles: PROFILES,
}
