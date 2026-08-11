import type { DocumentTemplate, FieldRect, TemplateProfile } from './types.ts'

/**
 * Spanish driving licence (Permiso de Conducir) approximate field layout.
 *
 * Same ID-1 card size as the DNI (aspect ~1.586). Fields differ: date of birth
 * on the front, address on the back, category grid on the back.
 *
 * Coordinates are approximate for a straight-on landscape photo. Users can
 * move / resize any rectangle after a template profile is applied.
 */
const FIELDS: FieldRect[] = [
  // ---------- Anverso (front) ----------
  { id: 'photo', side: 'anverso', labelEn: 'Photo', labelEs: 'Fotografía', x: 0.03, y: 0.24, w: 0.28, h: 0.68 },
  { id: 'apellidos', side: 'anverso', labelEn: 'Surnames', labelEs: 'Apellidos', x: 0.34, y: 0.20, w: 0.60, h: 0.09 },
  { id: 'nombre', side: 'anverso', labelEn: 'Name', labelEs: 'Nombre', x: 0.34, y: 0.31, w: 0.60, h: 0.08 },
  { id: 'fecha_nacimiento', side: 'anverso', labelEn: 'Date of birth', labelEs: 'Fecha de nacimiento', x: 0.34, y: 0.42, w: 0.35, h: 0.07 },
  { id: 'lugar_nacimiento', side: 'anverso', labelEn: 'Place of birth', labelEs: 'Lugar de nacimiento', x: 0.34, y: 0.51, w: 0.45, h: 0.07 },
  { id: 'fecha_expedicion', side: 'anverso', labelEn: 'Issue date', labelEs: 'Fecha de expedición', x: 0.34, y: 0.60, w: 0.25, h: 0.07 },
  { id: 'fecha_caducidad', side: 'anverso', labelEn: 'Expiry date', labelEs: 'Fecha de caducidad', x: 0.60, y: 0.60, w: 0.25, h: 0.07 },
  { id: 'autoridad', side: 'anverso', labelEn: 'Issuing authority', labelEs: 'Autoridad expedidora', x: 0.34, y: 0.69, w: 0.45, h: 0.07 },
  { id: 'numero_permiso', side: 'anverso', labelEn: 'Licence number', labelEs: 'Nº de permiso', x: 0.34, y: 0.78, w: 0.35, h: 0.08 },
  { id: 'firma', side: 'anverso', labelEn: 'Signature', labelEs: 'Firma', x: 0.62, y: 0.78, w: 0.34, h: 0.14 },

  // ---------- Reverso (back) ----------
  { id: 'categorias', side: 'reverso', labelEn: 'Categories & expiries', labelEs: 'Categorías y caducidades', x: 0.03, y: 0.08, w: 0.94, h: 0.55 },
  { id: 'domicilio', side: 'reverso', labelEn: 'Address', labelEs: 'Domicilio', x: 0.03, y: 0.66, w: 0.60, h: 0.12 },
  { id: 'restricciones', side: 'reverso', labelEn: 'Restrictions', labelEs: 'Restricciones', x: 0.65, y: 0.66, w: 0.32, h: 0.12 },
  { id: 'firma_reverso', side: 'reverso', labelEn: 'Signature', labelEs: 'Firma', x: 0.03, y: 0.80, w: 0.35, h: 0.14 },
]

const PROFILES: TemplateProfile[] = [
  {
    id: 'car_rental',
    labelEn: 'Car rental',
    labelEs: 'Alquiler de coche',
    descriptionEn: 'For rental agencies that need identity + categories',
    descriptionEs: 'Para agencias de alquiler que necesitan identidad y categorías',
    fieldIds: ['numero_permiso', 'firma', 'firma_reverso', 'domicilio', 'lugar_nacimiento', 'restricciones', 'autoridad'],
  },
  {
    id: 'hotel',
    labelEn: 'Hotel check-in',
    labelEs: 'Registro en hotel',
    descriptionEn: 'For hotels that accept the licence as ID',
    descriptionEs: 'Para hoteles que aceptan el permiso como identificación',
    fieldIds: ['numero_permiso', 'firma', 'firma_reverso', 'domicilio', 'categorias', 'restricciones', 'autoridad', 'fecha_expedicion'],
  },
  {
    id: 'age_verification',
    labelEn: 'Age verification',
    labelEs: 'Verificación de edad',
    descriptionEn: 'For services that only need to confirm age',
    descriptionEs: 'Para servicios que sólo necesitan confirmar la edad',
    fieldIds: ['numero_permiso', 'firma', 'firma_reverso', 'domicilio', 'lugar_nacimiento', 'autoridad', 'categorias', 'restricciones', 'fecha_expedicion', 'fecha_caducidad'],
  },
  {
    id: 'insurance',
    labelEn: 'Insurance',
    labelEs: 'Seguro',
    descriptionEn: 'For insurance policies and claims',
    descriptionEs: 'Para pólizas y siniestros de seguro',
    fieldIds: ['firma', 'firma_reverso', 'domicilio', 'lugar_nacimiento'],
  },
]

export const DRIVING_LICENCE_ES_TEMPLATE: DocumentTemplate = {
  id: 'driving-licence-es',
  labelEn: 'Driving licence',
  labelEs: 'Permiso de conducir',
  aspect: 1.586,
  fields: FIELDS,
  profiles: PROFILES,
}
