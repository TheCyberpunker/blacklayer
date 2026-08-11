import type { DocumentTemplate, FieldRect, TemplateProfile } from './types.ts'

/**
 * Spanish DNI 4.0 approximate field layout.
 *
 * Coordinates are NORMALIZED to a straight-on landscape card image (aspect ~1.586,
 * ISO 7810 ID-1). They will not match every real photo perfectly. Users can add
 * extra manual rectangles for anything the template misses, and untick fields
 * that overshoot on their specific image.
 *
 * The intent is to save 90% of the drawing work in the common case, not to
 * ship pixel-perfect coordinates.
 */
const FIELDS: FieldRect[] = [
  // ---------- Anverso (front) ----------
  { id: 'foto', side: 'anverso', labelEn: 'Photo', labelEs: 'Fotografía', x: 0.028, y: 0.16, w: 0.30, h: 0.72 },
  { id: 'apellidos', side: 'anverso', labelEn: 'Surnames', labelEs: 'Apellidos', x: 0.36, y: 0.24, w: 0.55, h: 0.10 },
  { id: 'nombre', side: 'anverso', labelEn: 'Name', labelEs: 'Nombre', x: 0.36, y: 0.36, w: 0.55, h: 0.08 },
  { id: 'sexo', side: 'anverso', labelEn: 'Sex', labelEs: 'Sexo', x: 0.36, y: 0.48, w: 0.08, h: 0.07 },
  { id: 'nacionalidad', side: 'anverso', labelEn: 'Nationality', labelEs: 'Nacionalidad', x: 0.45, y: 0.48, w: 0.12, h: 0.07 },
  { id: 'fecha_nacimiento', side: 'anverso', labelEn: 'Date of birth', labelEs: 'Fecha de nacimiento', x: 0.58, y: 0.48, w: 0.30, h: 0.07 },
  { id: 'fecha_emision', side: 'anverso', labelEn: 'Issue date', labelEs: 'Fecha de emisión', x: 0.36, y: 0.58, w: 0.20, h: 0.07 },
  { id: 'fecha_caducidad', side: 'anverso', labelEn: 'Expiry date', labelEs: 'Fecha de caducidad', x: 0.58, y: 0.58, w: 0.20, h: 0.07 },
  { id: 'num_soporte', side: 'anverso', labelEn: 'Support number', labelEs: 'Nº de soporte', x: 0.36, y: 0.68, w: 0.20, h: 0.07 },
  { id: 'dni_front', side: 'anverso', labelEn: 'DNI number (front)', labelEs: 'Nº DNI (anverso)', x: 0.58, y: 0.10, w: 0.35, h: 0.08 },
  { id: 'firma', side: 'anverso', labelEn: 'Signature', labelEs: 'Firma', x: 0.55, y: 0.78, w: 0.38, h: 0.15 },
  { id: 'can', side: 'anverso', labelEn: 'CAN', labelEs: 'CAN', x: 0.78, y: 0.10, w: 0.18, h: 0.06 },

  // ---------- Reverso (back) ----------
  { id: 'domicilio', side: 'reverso', labelEn: 'Address', labelEs: 'Domicilio', x: 0.03, y: 0.10, w: 0.62, h: 0.16 },
  { id: 'municipio', side: 'reverso', labelEn: 'Municipality', labelEs: 'Municipio', x: 0.03, y: 0.28, w: 0.30, h: 0.06 },
  { id: 'provincia', side: 'reverso', labelEn: 'Province', labelEs: 'Provincia', x: 0.35, y: 0.28, w: 0.30, h: 0.06 },
  { id: 'lugar_nacimiento', side: 'reverso', labelEn: 'Place of birth', labelEs: 'Lugar de nacimiento', x: 0.03, y: 0.36, w: 0.62, h: 0.06 },
  { id: 'progenitores', side: 'reverso', labelEn: 'Parents', labelEs: 'Nombre padres', x: 0.03, y: 0.44, w: 0.62, h: 0.10 },
  { id: 'equipo_expedidor', side: 'reverso', labelEn: 'Issuing office', labelEs: 'Equipo expedidor', x: 0.03, y: 0.56, w: 0.40, h: 0.06 },
  { id: 'mrz', side: 'reverso', labelEn: 'MRZ (machine-readable zone)', labelEs: 'MRZ (zona legible)', x: 0.02, y: 0.70, w: 0.96, h: 0.26 },
]

const PROFILES: TemplateProfile[] = [
  {
    id: 'travel',
    labelEn: 'Travel',
    labelEs: 'Viajes',
    emoji: '✈️',
    descriptionEn: 'For bookings, ID checks and visas',
    descriptionEs: 'Para reservas, controles de identidad y visados',
    fieldIds: ['num_soporte', 'can', 'firma', 'domicilio', 'lugar_nacimiento', 'progenitores', 'equipo_expedidor'],
  },
  {
    id: 'health',
    labelEn: 'Health',
    labelEs: 'Salud',
    emoji: '🏥',
    descriptionEn: 'For hospitals and clinics',
    descriptionEs: 'Para hospitales y clínicas',
    fieldIds: [
      'num_soporte',
      'can',
      'firma',
      'fecha_emision',
      'fecha_caducidad',
      'domicilio',
      'municipio',
      'provincia',
      'lugar_nacimiento',
      'progenitores',
      'equipo_expedidor',
      'mrz',
    ],
  },
  {
    id: 'legal',
    labelEn: 'Legal / Admin',
    labelEs: 'Administrativo / Legal',
    emoji: '📋',
    descriptionEn: 'For official procedures that need an address',
    descriptionEs: 'Para trámites oficiales que requieren domicilio',
    fieldIds: ['num_soporte', 'can', 'firma', 'progenitores', 'equipo_expedidor', 'mrz'],
  },
  {
    id: 'banking',
    labelEn: 'Banking / KYC',
    labelEs: 'Financiero / Banca',
    emoji: '🏦',
    descriptionEn: 'For bank verifications and KYC',
    descriptionEs: 'Para verificaciones bancarias y KYC',
    fieldIds: ['num_soporte', 'can', 'firma', 'lugar_nacimiento', 'progenitores', 'equipo_expedidor', 'mrz'],
  },
]

export const DNI_ES_TEMPLATE: DocumentTemplate = {
  id: 'dni-es',
  labelEn: 'Spanish DNI',
  labelEs: 'DNI español',
  aspect: 1.586,
  fields: FIELDS,
  profiles: PROFILES,
}
