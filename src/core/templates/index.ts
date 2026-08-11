import { DNI_ES_TEMPLATE } from './dni-es.ts'
import type { DocumentTemplate } from './types.ts'
import type { DetectionResult } from '../detect/types.ts'

/**
 * Return the template that matches a detection result, if any. Currently only
 * the Spanish DNI 4.0 layout is supported; passport and driving licence
 * templates land in later iterations.
 */
export function templateFor(det: DetectionResult): DocumentTemplate | null {
  if (det.type === 'identity' && det.subtype === 'dni' && det.country === 'ES') {
    return DNI_ES_TEMPLATE
  }
  return null
}

export { DNI_ES_TEMPLATE }
export type { DocumentTemplate, FieldRect, TemplateProfile, CardSide } from './types.ts'
