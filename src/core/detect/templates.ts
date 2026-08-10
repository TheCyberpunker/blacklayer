import type { Lang } from '../../hooks/use-lang.ts'
import type { ProtectionLevel } from '../types.ts'
import type { DetectionResult, DocumentType } from './types.ts'

export interface PurposeTemplate {
  id: string
  label: string
}

const PURPOSES: Record<
  DocumentType,
  { en: PurposeTemplate[]; es: PurposeTemplate[] }
> = {
  identity: {
    en: [
      { id: 'identity_verification', label: 'Identity verification' },
      { id: 'hotel_check_in', label: 'Hotel check-in' },
      { id: 'rental_application', label: 'Rental application' },
      { id: 'bank_verification', label: 'Bank verification' },
      { id: 'legal_procedure', label: 'Legal procedure' },
      { id: 'employment_verification', label: 'Employment verification' },
    ],
    es: [
      { id: 'identity_verification', label: 'Verificación de identidad' },
      { id: 'hotel_check_in', label: 'Registro en hotel' },
      { id: 'rental_application', label: 'Solicitud de alquiler' },
      { id: 'bank_verification', label: 'Verificación bancaria' },
      { id: 'legal_procedure', label: 'Trámite legal' },
      { id: 'employment_verification', label: 'Verificación laboral' },
    ],
  },
  passport: {
    en: [
      { id: 'identity_verification', label: 'Identity verification' },
      { id: 'hotel_check_in', label: 'Hotel check-in' },
      { id: 'travel_booking', label: 'Travel booking' },
      { id: 'visa_application', label: 'Visa application' },
    ],
    es: [
      { id: 'identity_verification', label: 'Verificación de identidad' },
      { id: 'hotel_check_in', label: 'Registro en hotel' },
      { id: 'travel_booking', label: 'Reserva de viaje' },
      { id: 'visa_application', label: 'Solicitud de visado' },
    ],
  },
  driving_licence: {
    en: [
      { id: 'identity_verification', label: 'Identity verification' },
      { id: 'car_rental', label: 'Car rental' },
      { id: 'insurance', label: 'Insurance' },
    ],
    es: [
      { id: 'identity_verification', label: 'Verificación de identidad' },
      { id: 'car_rental', label: 'Alquiler de coche' },
      { id: 'insurance', label: 'Seguro' },
    ],
  },
  contract: {
    en: [
      { id: 'contract_review', label: 'Contract review' },
      { id: 'legal_procedure', label: 'Legal procedure' },
      { id: 'record_keeping', label: 'Record keeping' },
    ],
    es: [
      { id: 'contract_review', label: 'Revisión de contrato' },
      { id: 'legal_procedure', label: 'Trámite legal' },
      { id: 'record_keeping', label: 'Archivo personal' },
    ],
  },
  payslip: {
    en: [
      { id: 'employment_verification', label: 'Employment verification' },
      { id: 'rental_application', label: 'Rental application' },
      { id: 'loan_application', label: 'Loan application' },
    ],
    es: [
      { id: 'employment_verification', label: 'Verificación laboral' },
      { id: 'rental_application', label: 'Solicitud de alquiler' },
      { id: 'loan_application', label: 'Solicitud de préstamo' },
    ],
  },
  invoice: {
    en: [
      { id: 'accounting', label: 'Accounting' },
      { id: 'expense_reimbursement', label: 'Expense reimbursement' },
      { id: 'tax_filing', label: 'Tax filing' },
    ],
    es: [
      { id: 'accounting', label: 'Contabilidad' },
      { id: 'expense_reimbursement', label: 'Reembolso de gastos' },
      { id: 'tax_filing', label: 'Declaración de impuestos' },
    ],
  },
  financial: {
    en: [
      { id: 'rental_application', label: 'Rental application' },
      { id: 'loan_application', label: 'Loan application' },
      { id: 'bank_verification', label: 'Bank verification' },
    ],
    es: [
      { id: 'rental_application', label: 'Solicitud de alquiler' },
      { id: 'loan_application', label: 'Solicitud de préstamo' },
      { id: 'bank_verification', label: 'Verificación bancaria' },
    ],
  },
  unknown: {
    en: [
      { id: 'identity_verification', label: 'Identity verification' },
      { id: 'general_sharing', label: 'General sharing' },
    ],
    es: [
      { id: 'identity_verification', label: 'Verificación de identidad' },
      { id: 'general_sharing', label: 'Envío general' },
    ],
  },
}

export function purposesFor(type: DocumentType, lang: Lang): PurposeTemplate[] {
  const bucket = PURPOSES[type] ?? PURPOSES.unknown
  return lang === 'es' ? bucket.es : bucket.en
}

/**
 * Suggested protection level per detected document type. Callers may or may not
 * apply this automatically; the UI shows it as a recommendation.
 */
export function recommendedLevel(det: DetectionResult): ProtectionLevel {
  switch (det.type) {
    case 'identity':
    case 'passport':
    case 'driving_licence':
    case 'financial':
    case 'payslip':
      return 'recommended'
    case 'contract':
    case 'invoice':
      return 'basic'
    case 'unknown':
    default:
      return 'recommended'
  }
}
