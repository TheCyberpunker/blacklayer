import type { Lang } from '../hooks/use-lang.ts'
import type { ProtectionLevel } from '../core/types.ts'

export interface Strings {
  header: {
    langLabel: string
    themeLabel: string
    themeSystem: string
    themeLight: string
    themeDark: string
  }
  hero: {
    title: string
    subtitle: string
    dropTitle: string
    dropSub: string
    choose: string
    supported: string
    privacy: string
  }
  workspace: {
    documentLabel: string
    documentKindPdf: string
    documentKindImage: string
    pageCount: (n: number) => string
    fileSize: (kb: string) => string
    clear: string
    protectionTitle: string
    protectionHelper: string
    recipient: string
    recipientPh: string
    purpose: string
    purposePh: string
    levelHeading: string
    levelBasic: string
    levelRecommended: string
    levelMaximum: string
    levelDescription: Record<ProtectionLevel, string>
    metadataNoteRemoved: string
    signatureWarning: string
    protect: string
    working: string
  }
  result: {
    ready: string
    readySub: string
    download: string
    protectAnother: string
    originalNote: string
    appliedRecipient: string
    appliedPurpose: string
    appliedTiled: string
    appliedSingle: string
    appliedMetadata: string
    appliedLocalOnly: string
  }
  errors: {
    unsupported: string
    failed: string
  }
  footer: {
    tagline: string
  }
}

export const enStrings: Strings = {
  header: {
    langLabel: 'Language',
    themeLabel: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  hero: {
    title: 'Protect documents before sharing them',
    subtitle: 'Add personalized protection to identity documents, contracts, PDFs and images.',
    dropTitle: 'Drop a document here',
    dropSub: 'or click to choose one',
    choose: 'Choose document',
    supported: 'PDF, JPG, PNG and WebP',
    privacy: 'Your documents never leave this device.',
  },
  workspace: {
    documentLabel: 'Document',
    documentKindPdf: 'PDF',
    documentKindImage: 'Image',
    pageCount: (n) => `${n} page${n === 1 ? '' : 's'}`,
    fileSize: (kb) => `${kb} KB`,
    clear: 'Clear document',
    protectionTitle: 'Prepare your protected copy',
    protectionHelper: 'Tell us who this copy is for and why. Preview updates as you type.',
    recipient: 'Who is this copy for?',
    recipientPh: 'Hotel, lawyer, landlord, company…',
    purpose: 'Why are you sharing it?',
    purposePh: 'Identity verification, hotel check-in…',
    levelHeading: 'Protection level',
    levelBasic: 'Basic',
    levelRecommended: 'Recommended',
    levelMaximum: 'Maximum',
    levelDescription: {
      basic: 'A single visible mark showing who this copy is intended for.',
      recommended: 'Repeated watermark plus hidden metadata removed.',
      maximum: 'Denser watermark and hidden metadata removed.',
    },
    metadataNoteRemoved: 'Hidden metadata will be removed.',
    signatureWarning:
      'This PDF appears to contain a digital signature. Creating a protected copy will invalidate the original signature on the copy.',
    protect: 'Create protected copy',
    working: 'Preparing your copy…',
  },
  result: {
    ready: 'Your protected copy is ready',
    readySub: 'Preview it above or download it now.',
    download: 'Download protected copy',
    protectAnother: 'Protect another document',
    originalNote: 'Your original document has not been changed.',
    appliedRecipient: 'Recipient included',
    appliedPurpose: 'Purpose included',
    appliedTiled: 'Repeated watermark across every page',
    appliedSingle: 'Watermark applied to every page',
    appliedMetadata: 'Hidden metadata removed',
    appliedLocalOnly: 'Processed locally, nothing uploaded',
  },
  errors: {
    unsupported: 'Unsupported file type. Use PDF, JPG, PNG or WebP.',
    failed: 'Could not create protected copy',
  },
  footer: {
    tagline: 'Local-first, open source.',
  },
}

export const esStrings: Strings = {
  header: {
    langLabel: 'Idioma',
    themeLabel: 'Tema',
    themeSystem: 'Sistema',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
  },
  hero: {
    title: 'Protege tus documentos antes de compartirlos',
    subtitle: 'Añade una protección personalizada a documentos de identidad, contratos, PDFs e imágenes.',
    dropTitle: 'Arrastra un documento aquí',
    dropSub: 'o haz clic para seleccionar uno',
    choose: 'Seleccionar documento',
    supported: 'PDF, JPG, PNG y WebP',
    privacy: 'Tus documentos nunca salen de este dispositivo.',
  },
  workspace: {
    documentLabel: 'Documento',
    documentKindPdf: 'PDF',
    documentKindImage: 'Imagen',
    pageCount: (n) => `${n} página${n === 1 ? '' : 's'}`,
    fileSize: (kb) => `${kb} KB`,
    clear: 'Descartar documento',
    protectionTitle: 'Prepara tu copia protegida',
    protectionHelper: 'Indícanos para quién es esta copia y para qué. La vista previa se actualiza mientras escribes.',
    recipient: '¿Para quién es esta copia?',
    recipientPh: 'Hotel, abogado, arrendador, empresa…',
    purpose: '¿Para qué la vas a compartir?',
    purposePh: 'Verificación de identidad, registro en hotel…',
    levelHeading: 'Nivel de protección',
    levelBasic: 'Básica',
    levelRecommended: 'Recomendada',
    levelMaximum: 'Máxima',
    levelDescription: {
      basic: 'Una marca visible que indica para quién es esta copia.',
      recommended: 'Marca repetida y eliminación de información oculta.',
      maximum: 'Marca más densa y eliminación de información oculta.',
    },
    metadataNoteRemoved: 'Se eliminará la información oculta.',
    signatureWarning:
      'Este PDF parece contener una firma digital. Crear una copia protegida invalidará la firma original en la copia.',
    protect: 'Crear copia protegida',
    working: 'Preparando tu copia…',
  },
  result: {
    ready: 'Tu copia protegida está lista',
    readySub: 'Previsualízala arriba o descárgala ahora.',
    download: 'Descargar copia protegida',
    protectAnother: 'Proteger otro documento',
    originalNote: 'El documento original no ha sido modificado.',
    appliedRecipient: 'Destinatario incluido',
    appliedPurpose: 'Motivo incluido',
    appliedTiled: 'Marca repetida en todas las páginas',
    appliedSingle: 'Marca aplicada en todas las páginas',
    appliedMetadata: 'Información oculta eliminada',
    appliedLocalOnly: 'Procesado localmente, sin subidas',
  },
  errors: {
    unsupported: 'Tipo de archivo no soportado. Usa PDF, JPG, PNG o WebP.',
    failed: 'No se pudo crear la copia protegida',
  },
  footer: {
    tagline: 'Local, código abierto.',
  },
}

export function getStrings(lang: Lang): Strings {
  return lang === 'es' ? esStrings : enStrings
}
