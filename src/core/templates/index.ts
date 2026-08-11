import { DNI_ES_TEMPLATE } from './dni-es.ts'
import { PASSPORT_TEMPLATE } from './passport.ts'
import type { DocumentTemplate } from './types.ts'
import type { DetectionResult } from '../detect/types.ts'

/**
 * Return the template that matches a detection result, if any.
 *
 * Currently supported:
 *   - Spanish DNI 4.0 (identity + dni + ES)
 *   - Generic passport (ICAO 9303 TD3 data page)
 *
 * Driving licence and other national IDs land in later iterations as data-only
 * additions to this table.
 */
export function templateFor(det: DetectionResult): DocumentTemplate | null {
  // Show the Spanish DNI template whenever detection lands on an identity
  // document that is either explicitly Spanish or of unknown origin. Manual
  // override ("Change type" dropdown) produces country=unknown, so this also
  // covers users who correct the badge to "Identity document" by hand.
  if (det.type === 'identity' && (det.country === 'ES' || det.country === 'unknown')) {
    return DNI_ES_TEMPLATE
  }
  if (det.type === 'passport') {
    return PASSPORT_TEMPLATE
  }
  return null
}

export { DNI_ES_TEMPLATE, PASSPORT_TEMPLATE }
export type { DocumentTemplate, FieldRect, TemplateProfile, CardSide } from './types.ts'
