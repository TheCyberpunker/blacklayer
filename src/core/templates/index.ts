import { DNI_ES_TEMPLATE } from './dni-es.ts'
import { PASSPORT_TEMPLATE } from './passport.ts'
import { DRIVING_LICENCE_ES_TEMPLATE } from './driving-licence-es.ts'
import type { DocumentTemplate } from './types.ts'
import type { DetectionResult } from '../detect/types.ts'

/**
 * Return the template that matches a detection result, if any.
 *
 * Currently supported:
 *   - Spanish DNI 4.0 (identity + ES / unknown)
 *   - Generic passport (ICAO 9303 TD3 data page)
 *   - Spanish driving licence (ID-1 card, front + back)
 */
export function templateFor(det: DetectionResult): DocumentTemplate | null {
  if (det.type === 'driving_licence') {
    return DRIVING_LICENCE_ES_TEMPLATE
  }
  if (det.type === 'identity' && (det.country === 'ES' || det.country === 'unknown')) {
    return DNI_ES_TEMPLATE
  }
  if (det.type === 'passport') {
    return PASSPORT_TEMPLATE
  }
  return null
}

export { DNI_ES_TEMPLATE, PASSPORT_TEMPLATE, DRIVING_LICENCE_ES_TEMPLATE }
export type { DocumentTemplate, FieldRect, TemplateProfile, CardSide } from './types.ts'
