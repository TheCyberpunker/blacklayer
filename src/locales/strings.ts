import type { Lang } from '../hooks/use-lang.ts'
import type { ProtectionLevel } from '../core/types.ts'
import type { DocumentType } from '../core/detect/types.ts'

export interface Strings {
  header: {
    langLabel: string
    themeLabel: string
    themeSystem: string
    themeLight: string
    themeDark: string
    navHowItWorks: string
    navPrivacy: string
    navSource: string
    skipToMain: string
  }
  dialogs: {
    howItWorksTitle: string
    howItWorksSub: string
    howSteps: { title: string; body: string }[]
    howClose: string
    privacyTitle: string
    privacySub: string
    privacyBullets: string[]
    privacyLimits: string
    privacyLimitBullets: string[]
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
    stepAbout: string
    stepProtection: string
    stepRedact: string
    stepAdvanced: string
    heroFirstRunLink: string
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
    redactSectionTitle: string
    redactHint: string
    redactStart: string
    redactStop: string
    redactUndo: string
    redactClear: string
    redactCount: (n: number) => string
    redactPdfLimitation: string
    redactModeLabel: string
    redactModeSolid: string
    redactModeBlur: string
    redactModePixelate: string
    redactModeHint: string
    compareLabel: string
    compareProtected: string
    compareSlider: string
    compareOriginal: string
    pageStripLabel: string
    pageStripCapped: (rendered: number, total: number) => string
    pageStripCurrent: (current: number, total: number) => string
    detected: (label: string) => string
    detectedLow: string
    detectedManual: string
    detectionLabel: Record<DocumentType, string>
    detectionSubtypeDni: string
    detectionSubtypeNie: string
    detectionSubtypeTie: string
    detectionSubtypePassport: string
    detectionSubtypeDrivingLicence: string
    changeDetection: string
    recommendedFor: (docLabel: string) => string
    applyRecommended: string
    purposeSuggestionsLabel: string
    customizeText: string
    customTextLabel: string
    customTextHint: string
    advancedTitle: string
    patternCrosshatchLabel: string
    patternCrosshatchHint: string
    patternFrameLabel: string
    patternFrameHint: string
    appliedCrosshatch: string
    appliedFrame: string
    presetsLabel: string
    presetsEmptyHint: string
    presetsSave: string
    presetsSavePromptTitle: string
    presetsSavePromptDefault: string
    presetsDeleteOne: string
    presetsClearAll: string
    presetsClearAllConfirm: string
    deleteLocalSettings: string
    deleteLocalSettingsHint: string
    deleteLocalSettingsConfirm: string
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
    appliedRedactions: (n: number) => string
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
    navHowItWorks: 'How it works',
    navPrivacy: 'Privacy',
    navSource: 'Source',
    skipToMain: 'Skip to main content',
  },
  dialogs: {
    howItWorksTitle: 'How BlackLayer works',
    howItWorksSub: 'Four short steps. Everything runs on your device.',
    howSteps: [
      {
        title: '1. Drop your document',
        body: 'Choose or drag in a PDF, JPG, PNG, or WebP. The file is read directly from your device. Nothing is uploaded.',
      },
      {
        title: '2. Tell us the context',
        body: 'Enter who this copy is for and why. BlackLayer builds a purpose-bound watermark from your answers, and the live preview updates as you type.',
      },
      {
        title: '3. Optionally hide sensitive areas',
        body: 'Draw rectangles over anything the recipient does not need to see. Solid fill is safest; blur and pixelate are available but weaker.',
      },
      {
        title: '4. Download the protected copy',
        body: 'A new file is generated in your browser and offered as a download. Your original is never modified.',
      },
    ],
    howClose: 'Got it',
    privacyTitle: 'Privacy scope',
    privacySub: 'What BlackLayer does with your document, and what it does not.',
    privacyBullets: [
      'Documents are read and processed locally. They never leave your device via this application.',
      'No account, no login, no email is required.',
      'No analytics, telemetry, or third-party trackers are included.',
      'Fonts, icons, and libraries are bundled locally. The runtime does not fetch anything from third-party CDNs.',
      'Hidden metadata (author, timestamps, GPS on images) is neutralized when you choose Recommended or Maximum protection.',
      'Presets and preferences (theme, language) are stored only in your browser. A "Delete all local settings" button in Advanced wipes them.',
    ],
    privacyLimits: 'What BlackLayer does not promise',
    privacyLimitBullets: [
      'Watermarks are not "unremovable". Modern AI-driven inpainting or a determined attacker can still remove or reconstruct protected content. BlackLayer raises the cost; it does not make the cost infinite.',
      'Screenshots, photos of the screen, or a camera pointed at a printed copy will always work.',
      'Once you share a copy with someone, its downstream use is out of scope.',
      'BlackLayer is an open-source tool provided as-is. See the LICENSE file.',
    ],
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
    stepAbout: 'About this copy',
    stepProtection: 'Protection level',
    stepRedact: 'Hide sensitive information',
    stepAdvanced: 'Advanced',
    heroFirstRunLink: 'New here? See how it works',
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
    redactSectionTitle: 'Hide sensitive information',
    redactHint: 'Draw over anything you do not want the recipient to see. Hidden areas are permanently removed on download.',
    redactStart: 'Start hiding',
    redactStop: 'Done hiding',
    redactUndo: 'Undo last',
    redactClear: 'Clear all',
    redactCount: (n) => `${n} region${n === 1 ? '' : 's'} hidden`,
    redactPdfLimitation: 'Hidden regions apply to the page you are viewing. Switch pages to hide regions on others.',
    redactModeLabel: 'Hide style',
    redactModeSolid: 'Solid',
    redactModeBlur: 'Blur',
    redactModePixelate: 'Pixelate',
    redactModeHint: 'Solid is safest. Blur and pixelate may partially reveal what is under them.',
    compareLabel: 'View',
    compareProtected: 'Protected',
    compareSlider: 'Compare',
    compareOriginal: 'Original',
    pageStripLabel: 'Pages',
    pageStripCapped: (rendered, total) => `Showing first ${rendered} of ${total} pages`,
    pageStripCurrent: (current, total) => `Page ${current} of ${total}`,
    detected: (label) => `${label} detected`,
    detectedLow: 'This may be an identity document. Please confirm.',
    detectedManual: 'Document type set manually',
    detectionLabel: {
      identity: 'Identity document',
      passport: 'Passport',
      driving_licence: 'Driving licence',
      contract: 'Contract',
      payslip: 'Payslip',
      invoice: 'Invoice',
      financial: 'Financial document',
      unknown: 'Document',
    },
    detectionSubtypeDni: 'Spanish DNI',
    detectionSubtypeNie: 'Spanish NIE',
    detectionSubtypeTie: 'Spanish TIE',
    detectionSubtypePassport: 'Passport',
    detectionSubtypeDrivingLicence: 'Driving licence',
    changeDetection: 'Change type',
    recommendedFor: (docLabel) => `Recommended for ${docLabel.toLowerCase()}`,
    applyRecommended: 'Apply recommended',
    purposeSuggestionsLabel: 'Suggestions',
    customizeText: 'Customize watermark text',
    customTextLabel: 'Watermark text',
    customTextHint: 'One line per row. Leave empty to use the default recipient + purpose text.',
    advancedTitle: 'Advanced',
    patternCrosshatchLabel: 'Add crosshatch security pattern',
    patternCrosshatchHint: 'Thin diagonal lines across the whole page. Makes automated watermark removal harder.',
    patternFrameLabel: 'Add border frame',
    patternFrameHint: 'Two thin borders around the page.',
    appliedCrosshatch: 'Crosshatch pattern applied',
    appliedFrame: 'Border frame applied',
    presetsLabel: 'Presets',
    presetsEmptyHint: 'Save the current recipient, purpose, and protection level as a preset for next time.',
    presetsSave: 'Save current as preset',
    presetsSavePromptTitle: 'Name this preset',
    presetsSavePromptDefault: 'My preset',
    presetsDeleteOne: 'Delete preset',
    presetsClearAll: 'Delete all presets',
    presetsClearAllConfirm: 'Delete every saved preset?',
    deleteLocalSettings: 'Delete all local settings',
    deleteLocalSettingsHint: 'Wipes presets, theme, and language stored on this device. Loaded documents are already local-only.',
    deleteLocalSettingsConfirm: 'Delete every BlackLayer setting stored on this device? This cannot be undone.',
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
    appliedRedactions: (n) => `${n} region${n === 1 ? '' : 's'} permanently hidden`,
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
    navHowItWorks: 'Cómo funciona',
    navPrivacy: 'Privacidad',
    navSource: 'Código',
    skipToMain: 'Ir al contenido principal',
  },
  dialogs: {
    howItWorksTitle: 'Cómo funciona BlackLayer',
    howItWorksSub: 'Cuatro pasos. Todo se procesa en tu dispositivo.',
    howSteps: [
      {
        title: '1. Arrastra tu documento',
        body: 'Elige o arrastra un PDF, JPG, PNG o WebP. El archivo se lee directamente en tu dispositivo. No se sube nada.',
      },
      {
        title: '2. Cuéntanos el contexto',
        body: 'Indica para quién es esta copia y para qué. BlackLayer construye una marca vinculada a esos datos, y la vista previa se actualiza mientras escribes.',
      },
      {
        title: '3. Oculta lo que no necesites compartir',
        body: 'Dibuja rectángulos sobre lo que el destinatario no necesita ver. Sólido es lo más seguro; desenfoque y pixelado son opciones más débiles.',
      },
      {
        title: '4. Descarga la copia protegida',
        body: 'Se genera un archivo nuevo en tu navegador y se te ofrece descargarlo. El original nunca se modifica.',
      },
    ],
    howClose: 'Entendido',
    privacyTitle: 'Alcance de la privacidad',
    privacySub: 'Qué hace BlackLayer con tu documento, y qué no.',
    privacyBullets: [
      'Los documentos se leen y procesan localmente. Nunca salen del dispositivo a través de esta aplicación.',
      'No requiere cuenta, inicio de sesión ni correo electrónico.',
      'No incluye analítica, telemetría ni rastreadores de terceros.',
      'Las fuentes, iconos y librerías se empaquetan localmente. En tiempo de ejecución no se obtiene nada de CDNs externas.',
      'La información oculta (autor, fechas, GPS en imágenes) se elimina al elegir protección Recomendada o Máxima.',
      'Los ajustes y preferencias (tema, idioma) se guardan solo en tu navegador. Hay un botón "Eliminar toda la configuración local" en Avanzado.',
    ],
    privacyLimits: 'Lo que BlackLayer no promete',
    privacyLimitBullets: [
      'Las marcas no son "imposibles de eliminar". Herramientas modernas basadas en IA o un atacante decidido pueden eliminar o reconstruir el contenido. BlackLayer aumenta el coste; no lo hace infinito.',
      'Las capturas de pantalla, fotos del monitor o una cámara apuntando a una copia impresa siempre serán posibles.',
      'Cuando compartes una copia con alguien, su uso posterior queda fuera del alcance.',
      'BlackLayer es una herramienta de código abierto, provista "tal cual". Consulta el archivo LICENSE.',
    ],
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
    stepAbout: 'Sobre esta copia',
    stepProtection: 'Nivel de protección',
    stepRedact: 'Ocultar información sensible',
    stepAdvanced: 'Avanzado',
    heroFirstRunLink: '¿Primera vez? Mira cómo funciona',
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
    redactSectionTitle: 'Ocultar información sensible',
    redactHint: 'Dibuja sobre lo que no quieres que vea el destinatario. Las zonas ocultas se eliminan de forma permanente al descargar.',
    redactStart: 'Empezar a ocultar',
    redactStop: 'Terminar',
    redactUndo: 'Deshacer',
    redactClear: 'Borrar todo',
    redactCount: (n) => `${n} zona${n === 1 ? '' : 's'} oculta${n === 1 ? '' : 's'}`,
    redactPdfLimitation: 'Las zonas ocultas se aplican a la página que estás viendo. Cambia de página para ocultar zonas en otras.',
    redactModeLabel: 'Estilo de ocultación',
    redactModeSolid: 'Sólido',
    redactModeBlur: 'Desenfoque',
    redactModePixelate: 'Pixelado',
    redactModeHint: 'Sólido es lo más seguro. Desenfoque y pixelado pueden revelar parte de lo que hay debajo.',
    compareLabel: 'Vista',
    compareProtected: 'Protegido',
    compareSlider: 'Comparar',
    compareOriginal: 'Original',
    pageStripLabel: 'Páginas',
    pageStripCapped: (rendered, total) => `Mostrando las primeras ${rendered} de ${total} páginas`,
    pageStripCurrent: (current, total) => `Página ${current} de ${total}`,
    detected: (label) => `${label} detectado`,
    detectedLow: 'Podría ser un documento de identidad. Confírmalo por favor.',
    detectedManual: 'Tipo de documento definido manualmente',
    detectionLabel: {
      identity: 'Documento de identidad',
      passport: 'Pasaporte',
      driving_licence: 'Permiso de conducir',
      contract: 'Contrato',
      payslip: 'Nómina',
      invoice: 'Factura',
      financial: 'Documento financiero',
      unknown: 'Documento',
    },
    detectionSubtypeDni: 'DNI español',
    detectionSubtypeNie: 'NIE',
    detectionSubtypeTie: 'TIE',
    detectionSubtypePassport: 'Pasaporte',
    detectionSubtypeDrivingLicence: 'Permiso de conducir',
    changeDetection: 'Cambiar tipo',
    recommendedFor: (docLabel) => `Recomendado para ${docLabel.toLowerCase()}`,
    applyRecommended: 'Aplicar recomendación',
    purposeSuggestionsLabel: 'Sugerencias',
    customizeText: 'Personalizar texto de la marca',
    customTextLabel: 'Texto de la marca',
    customTextHint: 'Una línea por renglón. Deja vacío para usar destinatario y motivo por defecto.',
    advancedTitle: 'Avanzado',
    patternCrosshatchLabel: 'Añadir patrón de seguridad de trama',
    patternCrosshatchHint: 'Líneas diagonales finas sobre toda la página. Dificulta la eliminación automática de la marca.',
    patternFrameLabel: 'Añadir marco',
    patternFrameHint: 'Dos bordes finos alrededor de la página.',
    appliedCrosshatch: 'Patrón de trama aplicado',
    appliedFrame: 'Marco aplicado',
    presetsLabel: 'Ajustes guardados',
    presetsEmptyHint: 'Guarda el destinatario, motivo y nivel actuales como un ajuste para la próxima vez.',
    presetsSave: 'Guardar como ajuste',
    presetsSavePromptTitle: 'Nombre para este ajuste',
    presetsSavePromptDefault: 'Mi ajuste',
    presetsDeleteOne: 'Eliminar ajuste',
    presetsClearAll: 'Eliminar todos los ajustes',
    presetsClearAllConfirm: '¿Eliminar todos los ajustes guardados?',
    deleteLocalSettings: 'Eliminar toda la configuración local',
    deleteLocalSettingsHint: 'Elimina los ajustes, el tema y el idioma guardados en este dispositivo. Los documentos cargados ya son locales.',
    deleteLocalSettingsConfirm: '¿Eliminar toda la configuración de BlackLayer en este dispositivo? Esta acción no se puede deshacer.',
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
    appliedRedactions: (n) => `${n} zona${n === 1 ? '' : 's'} oculta${n === 1 ? '' : 's'} de forma permanente`,
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

