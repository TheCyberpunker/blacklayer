import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Bookmark,
  Check,
  ChevronDown,
  Download,
  Eraser,
  FileText,
  Code2,
  HelpCircle,
  ImageIcon,
  Languages,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { profileFor, type ProtectionLevel, type RedactionMode, type RedactionRect, type WatermarkText } from './core/types.ts'
import { releaseBase, type RenderedBase, type RenderedPage, type RenderedThumb } from './core/preview/render.ts'
import { composite, drawOriginal } from './core/preview/composite.ts'
import type { DetectionResult, DocumentType } from './core/detect/types.ts'
import { UNKNOWN_DETECTION } from './core/detect/types.ts'
import { purposesFor, recommendedLevel } from './core/detect/templates.ts'
import { templateFor, type CardSide, type DocumentTemplate, type FieldRect, type TemplateProfile } from './core/templates/index.ts'
import { generateSeed } from './core/random/seed.ts'
import { hexToRgb01, rgb01ToHex } from './lib/color.ts'
import { Contrast, Crop, ImagePlus, RotateCcw, RotateCw, ScanText, Search, SlidersHorizontal } from 'lucide-react'
import { Button } from './components/ui/button.tsx'
import { Input } from './components/ui/input.tsx'
import { Label } from './components/ui/label.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.tsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip.tsx'
import {
  ConfirmDialog,
  PromptDialog,
  ToastRegion,
  type ConfirmOptions,
  type PromptOptions,
  type Toast,
} from './components/ui/notifications.tsx'
import { useTheme, type Theme } from './hooks/use-theme.ts'
import { useLang } from './hooks/use-lang.ts'
import { useDebounced } from './hooks/use-debounced.ts'
import { usePresets, clearAllLocalSettings, type Preset } from './hooks/use-presets.ts'
import { getStrings, type Strings } from './locales/strings.ts'
import { cn } from './lib/utils.ts'

type LoadedFile = {
  file: File
  kind: 'pdf' | 'image'
  base: RenderedBase
  hasSignature: boolean
}

type BatchItemStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error'

interface BatchItem {
  id: string
  file: File
  kind: 'pdf' | 'image'
  status: BatchItemStatus
  error?: string
  outputBlob?: Blob
  outputName?: string
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const LEVELS: ProtectionLevel[] = ['basic', 'recommended', 'maximum']
const OVERRIDE_TYPES: DocumentType[] = ['identity', 'passport', 'driving_licence', 'contract', 'payslip', 'invoice', 'financial', 'unknown']
const REDACT_MODES: RedactionMode[] = ['solid', 'blur', 'pixelate']
type CompareMode = 'protected' | 'slider' | 'original'
const MIN_RECT = 0.008

const detectKind = (file: File): 'pdf' | 'image' | null => {
  const t = file.type.toLowerCase()
  if (t === 'application/pdf') return 'pdf'
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return 'image'
  return null
}

const suggestOutputName = (name: string, kind: 'pdf' | 'image'): string => {
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  const ext = kind === 'pdf' ? 'pdf' : dot >= 0 ? name.slice(dot + 1) : 'png'
  return `${base}-blacklayer.${ext}`
}

const todayIso = (): string => {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const nextId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`

function subtypeLabel(det: DetectionResult, strings: Strings): string | null {
  switch (det.subtype) {
    case 'dni': return strings.workspace.detectionSubtypeDni
    case 'nie': return strings.workspace.detectionSubtypeNie
    case 'tie': return strings.workspace.detectionSubtypeTie
    case 'passport': return null // covered by type label
    case 'driving_licence': return null
    default: return null
  }
}

function buildWatermarkText(
  recipient: string,
  purpose: string,
  lang: 'en' | 'es',
  custom?: readonly string[],
): WatermarkText {
  return {
    recipient: recipient.trim() || (lang === 'es' ? 'DESTINATARIO' : 'RECIPIENT'),
    purpose: purpose.trim() || (lang === 'es' ? 'MOTIVO' : 'PURPOSE'),
    date: todayIso(),
    custom,
  }
}

/**
 * Rotate a redaction rect stored in normalized [0,1] coords by 90° in the
 * given direction, so that after the underlying image is rotated the rect
 * still covers the same document content. Width and height swap.
 */
function rotateRect90(r: RedactionRect, dir: 'cw' | 'ccw'): RedactionRect {
  const { x, y, w, h } = r
  if (dir === 'cw') {
    return { ...r, x: 1 - y - h, y: x, w: h, h: w }
  }
  return { ...r, x: y, y: 1 - x - w, w: h, h: w }
}

export function App(): JSX.Element {
  const { lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const { presets, save: savePreset, remove: removePreset, clear: clearPresets } = usePresets()
  const t = useMemo(() => getStrings(lang), [lang])
  const [howOpen, setHowOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  // First-run onboarding: auto-open the "How it works" dialog once per browser,
  // shortly after mount so the UI settles first. Marking `seen-intro` the
  // moment the dialog opens (not on close) so a reload before closing does
  // not re-trigger it — the user has already been shown the intro.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.localStorage.getItem('blacklayer.seen-intro') === '1') return
    } catch {
      return
    }
    const id = window.setTimeout(() => {
      setHowOpen(true)
      try {
        window.localStorage.setItem('blacklayer.seen-intro', '1')
      } catch {
        // storage disabled or quota full — accept the intro re-showing next time
      }
    }, 600)
    return () => window.clearTimeout(id)
  }, [])

  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchZipUrl, setBatchZipUrl] = useState<string | null>(null)
  const [activePageIndex, setActivePageIndex] = useState(0)
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [level, setLevel] = useState<ProtectionLevel>('recommended')
  const [levelTouched, setLevelTouched] = useState(false)
  const [detection, setDetection] = useState<DetectionResult>(UNKNOWN_DETECTION)
  const [customEnabled, setCustomEnabled] = useState(false)
  const [customText, setCustomText] = useState('')
  const [docSeed, setDocSeed] = useState<number>(() => generateSeed())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Output format only applies to PDF workspaces. When the loaded doc is an
  // image, output already matches the input format (JPG/PNG/WebP). For PDFs
  // (including ones combined from two images via "Add another photo"), the
  // user can now choose between a single PDF or a zip of PNGs, one per page.
  const [outputFormat, setOutputFormat] = useState<'pdf' | 'images'>('pdf')
  const [crosshatchOverride, setCrosshatchOverride] = useState<boolean | null>(null)
  const [frameOverride, setFrameOverride] = useState<boolean | null>(null)
  const [iridescentOverride, setIridescentOverride] = useState<boolean | null>(null)
  const [guillocheOverride, setGuillocheOverride] = useState<boolean | null>(null)
  const [moireOverride, setMoireOverride] = useState<boolean | null>(null)
  const [opacityOverride, setOpacityOverride] = useState<number | null>(null)
  const [rotationOverride, setRotationOverride] = useState<number | null>(null)
  const [fontSizeOverride, setFontSizeOverride] = useState<number | null>(null)
  const [colorOverride, setColorOverride] = useState<string | null>(null)
  const [redactSolidColor, setRedactSolidColor] = useState<string>('#000000')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchSummary, setSearchSummary] = useState<{ matches: number; pages: number } | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrPhase, setOcrPhase] = useState<'loading' | 'analyzing'>('loading')
  // Image adjustments live as flags on top of an immutable original file.
  // Every toggle re-derives the working file from the original, so grayscale is
  // reversible and rotations always start from the same base.
  const [originalImageFile, setOriginalImageFile] = useState<File | null>(null)
  const [imageRotationDeg, setImageRotationDeg] = useState<number>(0)
  const [imageGrayscale, setImageGrayscale] = useState<boolean>(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [imageBrightness, setImageBrightness] = useState<number>(0)
  const [imageContrast, setImageContrast] = useState<number>(0)
  const [tuneOpen, setTuneOpen] = useState<boolean>(false)
  // The "add another photo?" prompt appears once per single-image load and
  // stays until the user either adds a photo or dismisses it. Reset on drop.
  const [addAnotherPromptOpen, setAddAnotherPromptOpen] = useState(false)
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null)
  const [highlightedRectIds, setHighlightedRectIds] = useState<ReadonlySet<string>>(() => new Set())
  // Drag interaction on the preview canvas has four possible modes: creating a
  // new redaction rect, moving an existing one, resizing an existing one via
  // its bottom-right handle, or drawing a crop selection. Only one at a time.
  const dragModeRef = useRef<null | 'draw' | 'move' | 'resize' | 'crop'>(null)
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const [redactionsByPage, setRedactionsByPage] = useState<Map<number, RedactionRect[]>>(new Map())
  const [redactMode, setRedactMode] = useState(false)
  const [redactStyle, setRedactStyle] = useState<RedactionMode>('solid')
  const [templateSide, setTemplateSide] = useState<CardSide>('anverso')
  const [activeRect, setActiveRect] = useState<RedactionRect | null>(null)
  const [compareMode, setCompareMode] = useState<CompareMode>('protected')
  const [dividerX, setDividerX] = useState(0.5)
  const [dragActive, setDragActive] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string>('')

  // Toast + confirm + prompt infrastructure. Replaces the previous window.confirm
  // and window.prompt calls, which broke the design system and had no way to
  // signal success afterwards.
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const [confirmState, setConfirmState] = useState<
    | (ConfirmOptions & { open: boolean; resolve: (ok: boolean) => void })
    | null
  >(null)
  const [promptState, setPromptState] = useState<
    | (PromptOptions & { open: boolean; resolve: (v: string | null) => void })
    | null
  >(null)

  const pushToast = useCallback((message: string, tone: 'default' | 'destructive' = 'default') => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3200)
  }, [])
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const confirmAction = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, open: true, resolve })
    })
  }, [])
  const handleConfirmResult = useCallback((ok: boolean) => {
    setConfirmState((prev) => {
      prev?.resolve(ok)
      return null
    })
  }, [])

  const promptText = useCallback((opts: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...opts, open: true, resolve })
    })
  }, [])
  const handlePromptResult = useCallback((v: string | null) => {
    setPromptState((prev) => {
      prev?.resolve(v)
      return null
    })
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const originalCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const sliderDragging = useRef(false)
  const [activePage, setActivePage] = useState<RenderedPage | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const debouncedRecipient = useDebounced(recipient, 80)
  const debouncedPurpose = useDebounced(purpose, 80)
  const debouncedCustom = useDebounced(customText, 80)

  const effectiveCustom = customEnabled ? debouncedCustom.split(/\r?\n/) : undefined

  const previewProfile = useMemo(
    () =>
      profileFor(
        level,
        buildWatermarkText(debouncedRecipient, debouncedPurpose, lang, effectiveCustom),
        docSeed,
        {
          crosshatch: crosshatchOverride ?? undefined,
          frame: frameOverride ?? undefined,
          iridescent: iridescentOverride ?? undefined,
          guilloche: guillocheOverride ?? undefined,
          moire: moireOverride ?? undefined,
          opacity: opacityOverride ?? undefined,
          rotationDeg: rotationOverride ?? undefined,
          fontSize: fontSizeOverride ?? undefined,
          color: colorOverride ? hexToRgb01(colorOverride) : undefined,
        },
      ),
    [level, debouncedRecipient, debouncedPurpose, lang, effectiveCustom, docSeed, crosshatchOverride, frameOverride, iridescentOverride, guillocheOverride, moireOverride, opacityOverride, rotationOverride, fontSizeOverride, colorOverride],
  )

  const activePageRedactions = redactionsByPage.get(activePageIndex) ?? []
  const totalRedactionsCount = useMemo(() => {
    let n = 0
    for (const arr of redactionsByPage.values()) n += arr.length
    return n
  }, [redactionsByPage])

  // Auto-switch the DNI/licence template side based on the active page so a
  // combined front + back document lands the right rectangles automatically.
  useEffect(() => {
    if (!loaded || loaded.base.totalPages < 2) return
    const wantSide = activePageIndex === 0 ? 'anverso' : 'reverso'
    setTemplateSide((prev) => (prev === wantSide ? prev : wantSide))
  }, [loaded, activePageIndex])

  // Load the active page on demand from the RenderedBase provider.
  useEffect(() => {
    if (!loaded) {
      setActivePage(null)
      return
    }
    let cancelled = false
    setPageLoading(true)
    loaded.base
      .getPage(activePageIndex)
      .then((page) => {
        if (cancelled) return
        setActivePage(page)
      })
      .catch(() => {
        if (cancelled) return
        setActivePage(null)
      })
      .finally(() => {
        if (cancelled) return
        setPageLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loaded, activePageIndex])

  // Live redraw of the composite (protected view). Depends only on activePage,
  // not on `loaded`, so a fresh base swap does not force a redraw with the old
  // activePage bitmap while the new page is still loading (which would resize
  // the canvas twice and look like a flash on rotate/crop).
  useEffect(() => {
    if (!activePage || !canvasRef.current) return
    composite({
      target: canvasRef.current,
      page: activePage,
      options: previewProfile.watermark,
      lang,
      redactions: activePageRedactions,
      activeRect,
      selectedRectId,
      highlightRectIds: highlightedRectIds,
    })
  }, [activePage, previewProfile, lang, activePageRedactions, activeRect, selectedRectId, highlightedRectIds])

  // Draw the untouched original into the overlay canvas whenever compare mode
  // shows it or the active page changes.
  useEffect(() => {
    if (compareMode === 'protected') return
    if (!activePage || !originalCanvasRef.current) return
    drawOriginal(originalCanvasRef.current, activePage)
  }, [compareMode, activePage])

  const clearOutput = useCallback(() => {
    setOutputUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setOutputName('')
    setSelectedRectId(null)
  }, [])

  // Low-level loader used both by fresh drops and by the adjustments effect.
  // Does everything a fresh drop does *except* touch originalImageFile / the
  // adjustment flags — those are the responsibility of the caller.
  const loadFileIntoState = useCallback(
    async (f: File, kind: 'pdf' | 'image', resetAdjustmentDependent: boolean) => {
      // Only show the full "Loading document…" spinner on a fresh load. Image
      // adjustments (rotate, grayscale, brightness/contrast, crop) pass
      // resetAdjustmentDependent=false and stay mounted so the preview does
      // not appear to "refresh" on every button press.
      const isFreshLoad = resetAdjustmentDependent
      if (isFreshLoad) setLoading(true)
      try {
        const { renderBase } = await import('./core/preview/render.ts')
        const base = await renderBase(f)
        let hasSignature = false
        if (kind === 'pdf') {
          try {
            const { inspectPdf } = await import('./core/pdf/watermark.ts')
            const info = await inspectPdf(await f.arrayBuffer())
            hasSignature = info.hasSignature
          } catch {
            // best-effort
          }
        }
        const loadedFile: LoadedFile = { file: f, kind, base, hasSignature }
        setLoaded(loadedFile)
        setActivePageIndex(0)

        if (resetAdjustmentDependent) {
          setRedactionsByPage(new Map())
          setRedactMode(false)
          setRedactStyle('solid')
          setTemplateSide('anverso')
          setCustomEnabled(false)
          setCustomText('')
          setLevelTouched(false)
          setLevel('recommended')
          setDocSeed(generateSeed())
          setAdvancedOpen(false)
          setCrosshatchOverride(null)
          setFrameOverride(null)
          setIridescentOverride(null)
          setOpacityOverride(null)
          setRotationOverride(null)
          setFontSizeOverride(null)
          setColorOverride(null)
          setRedactSolidColor('#000000')
        }

        // Detection can be re-run for every load; it is cheap enough.
        void (async () => {
          try {
            const { detectDocument } = await import('./core/detect/detect.ts')
            const result = await detectDocument(f, base)
            setDetection(result)
            // Warm up the OCR runtime for image documents so the first
            // Analyze-text click doesn't pay the ~800 KB module download.
            if (kind === 'image' && result.confidence !== 'high') {
              const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
                .requestIdleCallback
              const warm = async () => {
                const { preloadOcr } = await import('./core/ocr/ocr.ts')
                preloadOcr()
              }
              if (idle) idle(() => void warm())
              else window.setTimeout(() => void warm(), 400)
            }
          } catch {
            setDetection(UNKNOWN_DETECTION)
          }
        })()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`${t.errors.failed}: ${msg}`)
      } finally {
        if (isFreshLoad) setLoading(false)
      }
    },
    [t],
  )

  const onFiles = useCallback(
    async (list: FileList | null | undefined) => {
      if (!list || list.length === 0) return
      setError(null)
      clearOutput()

      // Multi-file drop or picker → batch mode.
      if (list.length > 1) {
        const items: BatchItem[] = []
        const rejected: string[] = []
        for (const f of Array.from(list)) {
          const kind = detectKind(f)
          if (!kind) {
            rejected.push(f.name)
            continue
          }
          items.push({ id: nextId(), file: f, kind, status: 'idle' })
        }
        if (!items.length) {
          setError(t.errors.unsupported)
          return
        }
        if (batchZipUrl) URL.revokeObjectURL(batchZipUrl)
        setBatchZipUrl(null)
        setBatch((prev) => {
          // If already in batch mode, append; otherwise replace.
          if (prev.length > 0) return [...prev, ...items]
          return items
        })
        setBatchProgress(null)
        if (rejected.length) {
          setError(`${t.errors.unsupported} (${rejected.join(', ')})`)
        }
        // Do not populate `loaded` for batch mode.
        return
      }

      const f = list[0]!
      const kind = detectKind(f)
      if (!kind) {
        setError(t.errors.unsupported)
        return
      }
      // Fresh drop: capture the original (for reversible image adjustments) and
      // reset the adjustment flags. Also reset the extras that are not covered
      // by loadFileIntoState's reset path.
      setOriginalImageFile(kind === 'image' ? f : null)
      setImageRotationDeg(0)
      setImageGrayscale(false)
      setImageBrightness(0)
      setImageContrast(0)
      setTuneOpen(false)
      setAddAnotherPromptOpen(kind === 'image')
      setCropMode(false)
      setCropRect(null)
      setCompareMode('protected')
      setDividerX(0.5)
      await loadFileIntoState(f, kind, true)
    },
    [t, clearOutput, loadFileIntoState],
  )

  const clearBatch = useCallback(() => {
    setBatch([])
    if (batchZipUrl) URL.revokeObjectURL(batchZipUrl)
    setBatchZipUrl(null)
    setBatchProgress(null)
    setError(null)
  }, [batchZipUrl])

  const [combining, setCombining] = useState(false)

  const [frontBackDetected, setFrontBackDetected] = useState<boolean>(false)

  // Whenever the batch contents change, re-check for a front/back filename
  // pattern so we can recommend the combine flow at exactly the right moment.
  useEffect(() => {
    if (batch.length !== 2 || batch.some((it) => it.kind !== 'image')) {
      setFrontBackDetected(false)
      return
    }
    void (async () => {
      const { detectFrontBack } = await import('./core/pdf/combine-images.ts')
      const d = detectFrontBack(batch.map((it) => it.file))
      setFrontBackDetected(d.detected)
    })()
  }, [batch])

  const combineBatchToPdf = useCallback(async () => {
    if (!batch.length) return
    if (batch.some((it) => it.kind !== 'image')) {
      setError(t.workspace.batchCombineOnlyImages)
      return
    }
    setError(null)
    setCombining(true)
    try {
      const { combineImagesToPdf, detectFrontBack } = await import('./core/pdf/combine-images.ts')
      // Sort front-first when the pattern is detected so page 1 is always the
      // anverso, matching the DNI template's auto side-switch.
      const inputFiles = batch.map((it) => it.file)
      const { ordered } = detectFrontBack(inputFiles)
      const files = ordered.length ? [...ordered] : inputFiles
      const pdfBlob = await combineImagesToPdf(files)
      const name = `${
        files[0]?.name.replace(/\.[^.]+$/, '') ?? 'combined'
      }-combined.pdf`
      const combinedFile = new File([pdfBlob], name, {
        type: 'application/pdf',
        lastModified: Date.now(),
      })
      clearBatch()
      const dt = new DataTransfer()
      dt.items.add(combinedFile)
      await onFiles(dt.files)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${t.errors.failed}: ${msg}`)
    } finally {
      setCombining(false)
    }
  }, [batch, clearBatch, onFiles, t])

  const removeBatchItem = useCallback((id: string) => {
    setBatch((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target?.outputBlob) {
        // no explicit revoke needed for blob-only refs
      }
      return prev.filter((it) => it.id !== id)
    })
    if (batchZipUrl) {
      URL.revokeObjectURL(batchZipUrl)
      setBatchZipUrl(null)
    }
  }, [batchZipUrl])

  const clearDoc = useCallback(() => {
    releaseBase(loaded?.base)
    setLoaded(null)
    setOriginalImageFile(null)
    setImageRotationDeg(0)
    setImageGrayscale(false)
    setImageBrightness(0)
    setImageContrast(0)
    setTuneOpen(false)
    setAddAnotherPromptOpen(false)
    setCropMode(false)
    setCropRect(null)
    setActivePageIndex(0)
    setRecipient('')
    setPurpose('')
    setLevel('recommended')
    setLevelTouched(false)
    setDetection(UNKNOWN_DETECTION)
    setCustomEnabled(false)
    setCustomText('')
    setRedactionsByPage(new Map())
    setRedactMode(false)
    setRedactStyle('solid')
    setCompareMode('protected')
    setDividerX(0.5)
    setAdvancedOpen(false)
    setCrosshatchOverride(null)
    setFrameOverride(null)
    setIridescentOverride(null)
    setGuillocheOverride(null)
    setOpacityOverride(null)
    setRotationOverride(null)
    setFontSizeOverride(null)
    setColorOverride(null)
    setRedactSolidColor('#000000')
    clearOutput()
    setError(null)
  }, [loaded, clearOutput])

  const setLevelManual = useCallback((l: ProtectionLevel) => {
    setLevel(l)
    setLevelTouched(true)
  }, [])

  const applyRecommendedLevel = useCallback(() => {
    setLevel(recommendedLevel(detection))
    setLevelTouched(true)
  }, [detection])

  const applyPreset = useCallback((p: Preset) => {
    setRecipient(p.recipient)
    setPurpose(p.purpose)
    setLevel(p.level)
    setLevelTouched(true)
    setCrosshatchOverride(p.crosshatch)
    setFrameOverride(p.frame)
    setIridescentOverride(p.iridescent)
    setGuillocheOverride(p.guilloche)
    setMoireOverride(p.moire)
    setOpacityOverride(p.opacity)
    setRotationOverride(p.rotationDeg)
    setFontSizeOverride(p.fontSize)
    setColorOverride(p.colorHex)
    pushToast(t.workspace.toastPresetApplied(p.name))
  }, [pushToast, t])

  const onSaveCurrentPreset = useCallback(async () => {
    const rec = recipient.trim()
    const pur = purpose.trim()
    if (!rec && !pur) return
    const defaultName = rec || pur || t.workspace.presetsSavePromptDefault
    const name = await promptText({
      title: t.workspace.presetsSaveTitle,
      body: t.workspace.presetsSavePromptTitle,
      inputLabel: t.workspace.presetsSaveInputLabel,
      defaultValue: defaultName,
      placeholder: defaultName,
      confirmLabel: t.workspace.presetsSave,
      cancelLabel: t.workspace.commonCancel,
    })
    if (!name) return
    const saved = savePreset({
      name,
      recipient: rec,
      purpose: pur,
      level,
      crosshatch: crosshatchOverride,
      frame: frameOverride,
      iridescent: iridescentOverride,
      guilloche: guillocheOverride,
      moire: moireOverride,
      opacity: opacityOverride,
      rotationDeg: rotationOverride,
      fontSize: fontSizeOverride,
      colorHex: colorOverride,
    })
    if (saved) pushToast(t.workspace.toastPresetSaved(saved.name))
  }, [
    recipient,
    purpose,
    level,
    crosshatchOverride,
    frameOverride,
    iridescentOverride,
    guillocheOverride,
    moireOverride,
    opacityOverride,
    rotationOverride,
    fontSizeOverride,
    colorOverride,
    savePreset,
    promptText,
    pushToast,
    t,
  ])

  const onClearAllPresets = useCallback(async () => {
    if (!presets.length) return
    const ok = await confirmAction({
      title: t.workspace.presetsClearAllTitle,
      body: t.workspace.presetsClearAllConfirm,
      confirmLabel: t.workspace.commonDelete,
      cancelLabel: t.workspace.commonCancel,
      destructive: true,
    })
    if (!ok) return
    clearPresets()
    pushToast(t.workspace.toastPresetsCleared)
  }, [presets.length, clearPresets, t, confirmAction, pushToast])

  const onDeleteAllLocalSettings = useCallback(async () => {
    const ok = await confirmAction({
      title: t.workspace.deleteLocalSettingsTitle,
      body: t.workspace.deleteLocalSettingsConfirm,
      confirmLabel: t.workspace.commonDelete,
      cancelLabel: t.workspace.commonCancel,
      destructive: true,
    })
    if (!ok) return
    clearAllLocalSettings()
    clearPresets()
    // Restore in-memory defaults so the running session looks reset too.
    setTheme('system')
    setLang(navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en')
    pushToast(t.workspace.toastLocalSettingsCleared)
  }, [clearPresets, setTheme, setLang, t, confirmAction, pushToast])

  const runOcrDetection = useCallback(async () => {
    if (!loaded || ocrRunning) return
    // For PDFs we need a rendered page bitmap: OCR the currently visible page.
    if (loaded.kind === 'pdf' && !activePage) return
    setOcrRunning(true)
    setOcrProgress(0)
    try {
      const { runOcr, runOcrOnBitmap } = await import('./core/ocr/ocr.ts')
      const { detectFromOcrText } = await import('./core/detect/detect.ts')
      const onProgress = (p: { status: string; progress: number }) => {
        // Two phases fire status callbacks: "loading language traineddata"
        // (0..1) and "recognizing text" (0..1). Splice into a single 0..1
        // bar so the user always sees motion. Track the phase so the UI can
        // switch label between "downloading engine" and "analyzing text".
        if (p.status === 'loading language traineddata') {
          setOcrPhase('loading')
          setOcrProgress(Math.max(0, Math.min(0.5, p.progress * 0.5)))
        } else if (p.status === 'recognizing text') {
          setOcrPhase('analyzing')
          setOcrProgress(Math.max(0.5, Math.min(1, 0.5 + p.progress * 0.5)))
        } else if (typeof p.progress === 'number' && p.progress > 0) {
          setOcrProgress((prev) => Math.max(prev, Math.min(0.15, p.progress)))
        }
      }
      let result: { text: string; confidence: number }
      if (loaded.kind === 'image') {
        result = await runOcr(loaded.file, lang, onProgress)
      } else {
        const cacheBase = `${loaded.file.name}:${loaded.file.size}:${loaded.file.lastModified}:${activePageIndex}`
        result = await runOcrOnBitmap(activePage!.bitmap, cacheBase, lang, onProgress)
      }
      const next = detectFromOcrText(detection, result.text)
      setDetection(next)
      pushToast(
        next.type !== 'unknown' && next.confidence === 'high'
          ? t.workspace.toastOcrConfident(t.workspace.detectionLabel[next.type])
          : t.workspace.toastOcrInconclusive,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      pushToast(`${t.errors.failed}: ${msg}`, 'destructive')
    } finally {
      setOcrRunning(false)
      setOcrProgress(0)
      setOcrPhase('loading')
    }
  }, [loaded, ocrRunning, activePage, activePageIndex, lang, detection, pushToast, t])

  const overrideDetection = useCallback((type: DocumentType) => {
    setDetection((prev) => {
      // When overriding to identity or driving licence we assume Spain — those
      // are the only ES-specific templates shipped. Passport template is
      // country-agnostic. This keeps templateFor() strict without breaking the
      // manual-override path.
      const country =
        type === 'identity' || type === 'driving_licence'
          ? 'ES'
          : type === 'passport'
            ? prev.country === 'unknown'
              ? 'other'
              : prev.country
            : prev.country
      return {
        ...prev,
        type,
        subtype: null,
        country,
        confidence: 'medium',
        manual: true,
        reasons: ['manual override'],
      }
    })
  }, [])

  const protect = useCallback(async () => {
    if (!loaded) return
    setWorking(true)
    setError(null)
    try {
      const custom = customEnabled ? customText.split(/\r?\n/) : undefined
      const profile = profileFor(
        level,
        buildWatermarkText(recipient, purpose, lang, custom),
        docSeed,
        {
          crosshatch: crosshatchOverride ?? undefined,
          frame: frameOverride ?? undefined,
          iridescent: iridescentOverride ?? undefined,
          guilloche: guillocheOverride ?? undefined,
          moire: moireOverride ?? undefined,
          opacity: opacityOverride ?? undefined,
          rotationDeg: rotationOverride ?? undefined,
          fontSize: fontSizeOverride ?? undefined,
          color: colorOverride ? hexToRgb01(colorOverride) : undefined,
        },
      )
      let blob: Blob
      let outputName: string
      if (loaded.kind === 'pdf') {
        const buf = await loaded.file.arrayBuffer()
        const activeMap = new Map<number, readonly RedactionRect[]>()
        for (const [idx, arr] of redactionsByPage.entries()) {
          if (arr.length) activeMap.set(idx, arr)
        }
        const { applyPdfWatermark } = await import('./core/pdf/watermark.ts')
        const { bytes } = await applyPdfWatermark({
          source: buf,
          profile,
          lang,
          redactionsByPage: activeMap.size ? activeMap : undefined,
        })
        if (outputFormat === 'images') {
          // Render each page of the protected PDF as PNG and pack into a zip.
          // Useful when the user combined front+back photos of an ID and now
          // wants two independent images back rather than a single 2-page PDF.
          const [{ rasterizeAllPagesToPng }, { zipSync }] = await Promise.all([
            import('./core/pdf/rasterize-all.ts'),
            import('fflate'),
          ])
          const pages = await rasterizeAllPagesToPng(new Uint8Array(bytes))
          const dot = loaded.file.name.lastIndexOf('.')
          const base = dot >= 0 ? loaded.file.name.slice(0, dot) : loaded.file.name
          const zipInput: Record<string, Uint8Array> = {}
          pages.forEach((png, i) => {
            zipInput[`${base}-${String(i + 1).padStart(2, '0')}-blacklayer.png`] = new Uint8Array(png)
          })
          const zipBytes = zipSync(zipInput)
          blob = new Blob([zipBytes as unknown as ArrayBuffer], { type: 'application/zip' })
          outputName = `${base}-blacklayer.zip`
        } else {
          blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
          outputName = suggestOutputName(loaded.file.name, loaded.kind)
        }
      } else {
        const outType =
          loaded.file.type === 'image/jpeg'
            ? 'image/jpeg'
            : loaded.file.type === 'image/webp'
              ? 'image/webp'
              : 'image/png'
        const { applyImageWatermark } = await import('./core/image/watermark.ts')
        const imageRects = redactionsByPage.get(0) ?? []
        blob = await applyImageWatermark({
          source: loaded.file,
          profile,
          lang,
          redactions: imageRects,
          outputType: outType,
        })
        outputName = suggestOutputName(loaded.file.name, loaded.kind)
      }
      clearOutput()
      const url = URL.createObjectURL(blob)
      setOutputUrl(url)
      setOutputName(outputName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${t.errors.failed}: ${msg}`)
    } finally {
      setWorking(false)
    }
  }, [loaded, level, recipient, purpose, lang, customEnabled, customText, redactionsByPage, docSeed, crosshatchOverride, frameOverride, iridescentOverride, guillocheOverride, moireOverride, opacityOverride, rotationOverride, fontSizeOverride, colorOverride, t, clearOutput, outputFormat])

  const protectBatch = useCallback(async () => {
    if (!batch.length) return
    setError(null)
    if (batchZipUrl) {
      URL.revokeObjectURL(batchZipUrl)
      setBatchZipUrl(null)
    }
    setBatch((prev) => prev.map((it) => ({ ...it, status: 'queued', error: undefined, outputBlob: undefined, outputName: undefined })))
    setBatchProgress({ done: 0, total: batch.length })

    // Read the current batch snapshot (state may be async).
    const items = batch
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      setBatch((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'processing' } : it)))
      setBatchProgress({ done: i, total: items.length })

      try {
        // Each file gets its own random seed so batch outputs are not identical.
        const perSeed = (await import('./core/random/seed.ts')).generateSeed()
        const custom = customEnabled ? customText.split(/\r?\n/) : undefined
        const profile = profileFor(
          level,
          buildWatermarkText(recipient, purpose, lang, custom),
          perSeed,
          {
            crosshatch: crosshatchOverride ?? undefined,
            frame: frameOverride ?? undefined,
            iridescent: iridescentOverride ?? undefined,
            guilloche: guillocheOverride ?? undefined,
            moire: moireOverride ?? undefined,
          },
        )

        let blob: Blob
        if (item.kind === 'pdf') {
          const buf = await item.file.arrayBuffer()
          const { applyPdfWatermark } = await import('./core/pdf/watermark.ts')
          const { bytes } = await applyPdfWatermark({ source: buf, profile, lang })
          blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
        } else {
          const outType =
            item.file.type === 'image/jpeg'
              ? 'image/jpeg'
              : item.file.type === 'image/webp'
                ? 'image/webp'
                : 'image/png'
          const { applyImageWatermark } = await import('./core/image/watermark.ts')
          blob = await applyImageWatermark({ source: item.file, profile, lang, outputType: outType })
        }

        const outputName = suggestOutputName(item.file.name, item.kind)
        setBatch((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: 'done', outputBlob: blob, outputName } : it,
          ),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setBatch((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'error', error: msg } : it)),
        )
      }
    }

    setBatchProgress(null)
  }, [batch, batchZipUrl, level, recipient, purpose, lang, customEnabled, customText, crosshatchOverride, frameOverride, iridescentOverride, guillocheOverride, moireOverride])

  const buildZip = useCallback(async () => {
    const done = batch.filter((it) => it.status === 'done' && it.outputBlob)
    if (!done.length) return
    const { bundleZip } = await import('./core/batch/zip.ts')
    const entries = await Promise.all(
      done.map(async (it) => ({
        filename: it.outputName ?? it.file.name,
        bytes: new Uint8Array(await it.outputBlob!.arrayBuffer()),
      })),
    )
    const zip = bundleZip(entries)
    if (batchZipUrl) URL.revokeObjectURL(batchZipUrl)
    const blob = new Blob([zip as unknown as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    setBatchZipUrl(url)
  }, [batch, batchZipUrl])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      setDragActive(false)
      onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  // ---------- Redaction pointer handlers ----------

  const canvasToNormalized = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      // The <canvas> uses `object-contain`, so the internal buffer is fitted into
      // the element bounds preserving aspect ratio. That leaves letterbox/pillarbox
      // padding around the actual document image. Normalizing against the raw element
      // rect (which we used to do) meant every click was offset by the padding, and
      // the drawn rectangle landed somewhere the user did not click.
      const bufW = canvas.width
      const bufH = canvas.height
      if (!bufW || !bufH) return null
      const bufAspect = bufW / bufH
      const elemAspect = rect.width / rect.height
      let displayedW: number
      let displayedH: number
      let offsetX = 0
      let offsetY = 0
      if (bufAspect > elemAspect) {
        // Buffer wider than element → letterboxed top and bottom.
        displayedW = rect.width
        displayedH = rect.width / bufAspect
        offsetY = (rect.height - displayedH) / 2
      } else {
        // Buffer taller than element → pillarboxed left and right.
        displayedH = rect.height
        displayedW = rect.height * bufAspect
        offsetX = (rect.width - displayedW) / 2
      }
      const localX = clientX - rect.left - offsetX
      const localY = clientY - rect.top - offsetY
      return {
        x: Math.max(0, Math.min(1, localX / displayedW)),
        y: Math.max(0, Math.min(1, localY / displayedH)),
      }
    },
    [],
  )

  // Aspect-ratio-aware hit test that returns a rect if p lies inside it, and
  // whether it lies inside the bottom-right handle (resize) or the body (move).
  const hitTestRects = useCallback(
    (p: { x: number; y: number }) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rects = activePageRedactions
      // Handle size in normalized units, converted from the fixed canvas-pixel
      // handle drawn by composite (matches drawSelectionOverlay).
      const w = canvas.width || 1
      const h = canvas.height || 1
      // Iterate in reverse so the most recently added rect (drawn on top) wins.
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i]!
        const rw = r.w * w
        const rh = r.h * h
        const handlePx = Math.max(10, Math.min(20, Math.min(rw, rh) / 4))
        const handleNormX = handlePx / w
        const handleNormY = handlePx / h
        const withinX = p.x >= r.x && p.x <= r.x + r.w
        const withinY = p.y >= r.y && p.y <= r.y + r.h
        if (!withinX || !withinY) continue
        const inHandle = p.x >= r.x + r.w - handleNormX && p.y >= r.y + r.h - handleNormY
        return { rect: r, target: inHandle ? ('resize' as const) : ('move' as const) }
      }
      return null
    },
    [activePageRedactions],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!loaded || compareMode !== 'protected') return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return

      if (cropMode) {
        e.preventDefault()
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        dragStartRef.current = p
        dragModeRef.current = 'crop'
        setCropRect({ x: p.x, y: p.y, w: 0, h: 0 })
        return
      }

      // Try to grab an existing rect first (works whether or not redact mode is on).
      const hit = hitTestRects(p)
      if (hit) {
        e.preventDefault()
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        setSelectedRectId(hit.rect.id)
        dragModeRef.current = hit.target
        dragOffsetRef.current = { dx: p.x - hit.rect.x, dy: p.y - hit.rect.y }
        return
      }

      // Empty area: clear selection.
      if (selectedRectId) setSelectedRectId(null)

      if (!redactMode) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      dragStartRef.current = p
      dragModeRef.current = 'draw'
      setActiveRect({ id: 'active', x: p.x, y: p.y, w: 0, h: 0, mode: redactStyle })
    },
    [
      redactMode,
      cropMode,
      loaded,
      canvasToNormalized,
      compareMode,
      redactStyle,
      hitTestRects,
      selectedRectId,
    ],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = dragModeRef.current
      if (!mode) return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return

      if (mode === 'crop') {
        const start = dragStartRef.current
        if (!start) return
        setCropRect({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
        })
        return
      }

      if (mode === 'draw') {
        const start = dragStartRef.current
        if (!start) return
        setActiveRect({
          id: 'active',
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
          mode: redactStyle,
        })
        return
      }

      if ((mode === 'move' || mode === 'resize') && selectedRectId) {
        setRedactionsByPage((prev) => {
          const arr = prev.get(activePageIndex)
          if (!arr) return prev
          const idx = arr.findIndex((r) => r.id === selectedRectId)
          if (idx < 0) return prev
          const r = arr[idx]!
          let updated = r
          if (mode === 'move') {
            const offset = dragOffsetRef.current
            const nx = Math.max(0, Math.min(1 - r.w, p.x - offset.dx))
            const ny = Math.max(0, Math.min(1 - r.h, p.y - offset.dy))
            updated = { ...r, x: nx, y: ny }
          } else {
            const nw = Math.max(MIN_RECT, Math.min(1 - r.x, p.x - r.x))
            const nh = Math.max(MIN_RECT, Math.min(1 - r.y, p.y - r.y))
            updated = { ...r, w: nw, h: nh }
          }
          const nextArr = arr.slice()
          nextArr[idx] = updated
          const next = new Map(prev)
          next.set(activePageIndex, nextArr)
          return next
        })
      }
    },
    [canvasToNormalized, redactStyle, selectedRectId, activePageIndex],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      const mode = dragModeRef.current
      dragModeRef.current = null
      dragStartRef.current = null

      if (mode === 'crop') return
      if (mode === 'move' || mode === 'resize') return

      if (mode !== 'draw') return
      const rect = activeRect
      setActiveRect(null)
      if (!rect) return
      if (rect.w < MIN_RECT || rect.h < MIN_RECT) return
      const finalRect: RedactionRect = {
        ...rect,
        id: nextId(),
        mode: redactStyle,
        color: redactStyle === 'solid' ? hexToRgb01(redactSolidColor) : undefined,
      }
      setRedactionsByPage((prev) => {
        const next = new Map(prev)
        const arr = next.get(activePageIndex) ?? []
        next.set(activePageIndex, [...arr, finalRect])
        return next
      })
      setSelectedRectId(finalRect.id)
    },
    [activeRect, activePageIndex, redactStyle, redactSolidColor],
  )

  const undoRedaction = useCallback(() => {
    setRedactionsByPage((prev) => {
      const next = new Map(prev)
      const arr = next.get(activePageIndex) ?? []
      if (!arr.length) return prev
      const trimmed = arr.slice(0, -1)
      if (trimmed.length) next.set(activePageIndex, trimmed)
      else next.delete(activePageIndex)
      return next
    })
  }, [activePageIndex])

  const clearRedactions = useCallback(() => {
    setRedactionsByPage(new Map())
    setActiveRect(null)
    setSelectedRectId(null)
  }, [])

  const deleteSelectedRect = useCallback(() => {
    if (!selectedRectId) return
    setRedactionsByPage((prev) => {
      const arr = prev.get(activePageIndex)
      if (!arr) return prev
      const kept = arr.filter((r) => r.id !== selectedRectId)
      const next = new Map(prev)
      if (kept.length) next.set(activePageIndex, kept)
      else next.delete(activePageIndex)
      return next
    })
    setSelectedRectId(null)
  }, [selectedRectId, activePageIndex])

  // Global keyboard shortcuts for the selected rect: Delete/Backspace removes,
  // Escape deselects. Skipped while the user is typing in an input.
  useEffect(() => {
    if (!selectedRectId) return
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelectedRect()
      } else if (e.key === 'Escape') {
        setSelectedRectId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedRectId, deleteSelectedRect])

  // ---------- Template rect wiring ----------

  const templateRectId = (fieldId: string, pageIndex: number): string =>
    `template:${fieldId}:${pageIndex}`

  const activeTemplate = useMemo<DocumentTemplate | null>(() => templateFor(detection), [detection])

  const toggleTemplateField = useCallback(
    (field: FieldRect) => {
      const rectId = templateRectId(field.id, activePageIndex)
      setRedactionsByPage((prev) => {
        const next = new Map(prev)
        const arr = next.get(activePageIndex) ?? []
        const existingIdx = arr.findIndex((r) => r.id === rectId)
        if (existingIdx >= 0) {
          const filtered = arr.filter((_, i) => i !== existingIdx)
          if (filtered.length) next.set(activePageIndex, filtered)
          else next.delete(activePageIndex)
        } else {
          next.set(activePageIndex, [
            ...arr,
            {
              id: rectId,
              x: field.x,
              y: field.y,
              w: field.w,
              h: field.h,
              mode: redactStyle,
            },
          ])
        }
        return next
      })
    },
    [activePageIndex, redactStyle],
  )

  const activeFieldIds = useMemo(() => {
    const rects = redactionsByPage.get(activePageIndex) ?? []
    const active = new Set<string>()
    for (const r of rects) {
      if (r.id.startsWith('template:')) {
        // template:<fieldId>:<pageIndex>
        const fieldId = r.id.split(':')[1]
        if (fieldId) active.add(fieldId)
      }
    }
    return active
  }, [redactionsByPage, activePageIndex])

  const applyProfile = useCallback(
    (profile: TemplateProfile, template: DocumentTemplate) => {
      if (!template) return
      // Clear any template rects on the active page first, then add the profile's fields
      // scoped to the current side. Manual rects (non-template) are untouched.
      const relevantFields = template.fields.filter(
        (f) => profile.fieldIds.includes(f.id) && f.side === templateSide,
      )
      setRedactionsByPage((prev) => {
        const next = new Map(prev)
        const arr = next.get(activePageIndex) ?? []
        const withoutTemplate = arr.filter((r) => !r.id.startsWith('template:'))
        const additions = relevantFields.map((f) => ({
          id: templateRectId(f.id, activePageIndex),
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          mode: redactStyle,
        }))
        const merged = [...withoutTemplate, ...additions]
        if (merged.length) next.set(activePageIndex, merged)
        else next.delete(activePageIndex)
        return next
      })
    },
    [activePageIndex, templateSide, redactStyle],
  )

  const clearTemplate = useCallback(() => {
    setRedactionsByPage((prev) => {
      const next = new Map(prev)
      const arr = next.get(activePageIndex) ?? []
      const kept = arr.filter((r) => !r.id.startsWith('template:'))
      if (kept.length) next.set(activePageIndex, kept)
      else next.delete(activePageIndex)
      return next
    })
  }, [activePageIndex])

  // ---------- Text search redaction ----------

  const runTextSearch = useCallback(async () => {
    if (!loaded || loaded.kind !== 'pdf') return
    const q = searchQuery.trim()
    if (q.length < 2) return
    setSearching(true)
    setSearchSummary(null)
    try {
      const { findTextMatches } = await import('./core/pdf/text-search.ts')
      const buf = await loaded.file.arrayBuffer()
      const matches = await findTextMatches({ sourceBytes: buf, query: q })

      // Clear any previous search rects across all pages first.
      setRedactionsByPage((prev) => {
        const next = new Map<number, RedactionRect[]>()
        for (const [idx, arr] of prev) {
          const kept = arr.filter((r) => !r.id.startsWith('search:'))
          if (kept.length) next.set(idx, kept)
        }
        // Apply the new search rects grouped by page.
        const grouped = new Map<number, RedactionRect[]>()
        matches.forEach((m, i) => {
          const rect: RedactionRect = {
            id: `search:${i}:${m.pageIndex}`,
            x: Math.max(0, m.x),
            y: Math.max(0, m.y),
            w: Math.max(0.001, m.w),
            h: Math.max(0.001, m.h),
            mode: redactStyle,
            color: redactStyle === 'solid' ? hexToRgb01(redactSolidColor) : undefined,
          }
          const list = grouped.get(m.pageIndex) ?? []
          list.push(rect)
          grouped.set(m.pageIndex, list)
        })
        for (const [idx, list] of grouped) {
          const existing = next.get(idx) ?? []
          next.set(idx, [...existing, ...list])
        }
        return next
      })

      const touchedPages = matches.map((m) => m.pageIndex)
      const pagesTouched = new Set(touchedPages).size
      setSearchSummary({ matches: matches.length, pages: pagesTouched })
      pushToast(t.workspace.toastSearchDone(matches.length, pagesTouched))

      // Highlight the newly added search rects for a few seconds and, if the
      // user is on a page with no matches, jump to the first matched page so
      // they can immediately see the result.
      if (matches.length) {
        const newIds = new Set(matches.map((_, i) => `search:${i}:${matches[i]!.pageIndex}`))
        setHighlightedRectIds(newIds)
        const firstPage = Math.min(...touchedPages)
        if (!touchedPages.includes(activePageIndex)) {
          setActivePageIndex(firstPage)
          setActiveRect(null)
        }
        window.setTimeout(() => setHighlightedRectIds(new Set()), 2000)
      } else {
        setHighlightedRectIds(new Set())
      }
    } catch {
      setSearchSummary({ matches: 0, pages: 0 })
    } finally {
      setSearching(false)
    }
  }, [loaded, searchQuery, redactStyle, redactSolidColor, activePageIndex, pushToast, t])

  const clearSearchRedactions = useCallback(() => {
    setRedactionsByPage((prev) => {
      const next = new Map<number, RedactionRect[]>()
      for (const [idx, arr] of prev) {
        const kept = arr.filter((r) => !r.id.startsWith('search:'))
        if (kept.length) next.set(idx, kept)
      }
      return next
    })
    setSearchSummary(null)
    setSearchQuery('')
  }, [])

  // ---------- Image adjust ----------

  const anyRedactions = useMemo(() => {
    for (const arr of redactionsByPage.values()) if (arr.length) return true
    return false
  }, [redactionsByPage])

  const startCropMode = useCallback(() => {
    setCropMode(true)
    setCropRect(null)
    // Turning on crop turns off redaction to avoid ambiguous pointer intent.
    setRedactMode(false)
  }, [])

  const cancelCropMode = useCallback(() => {
    setCropMode(false)
    setCropRect(null)
  }, [])

  const applyCrop = useCallback(async () => {
    if (!cropMode || !cropRect || !loaded || loaded.kind !== 'image') return
    if (cropRect.w < MIN_RECT * 2 || cropRect.h < MIN_RECT * 2) return
    // Warn if there are redactions; crop baked-in changes normalized coords.
    if (anyRedactions) {
      const ok = await confirmAction({
        title: t.workspace.adjustClearRedactionsTitle,
        body: t.workspace.adjustConfirmClearRedactions,
        confirmLabel: t.workspace.commonContinue,
        cancelLabel: t.workspace.commonCancel,
        destructive: true,
      })
      if (!ok) return
    }
    setAdjusting(true)
    try {
      const { cropImageFile, fileFromBlob } = await import('./core/image/adjust.ts')
      // Crop the CURRENT loaded file (post rotation + grayscale). Reset the
      // adjustment flags because those transforms are now baked into the crop.
      const r = await cropImageFile(loaded.file, cropRect)
      const newOriginal = fileFromBlob(r.blob, r.filename, '')
      setOriginalImageFile(newOriginal)
      setImageRotationDeg(0)
      setImageGrayscale(false)
      setCropMode(false)
      setCropRect(null)
      if (anyRedactions) setRedactionsByPage(new Map())
      await loadFileIntoState(newOriginal, 'image', false)
    } finally {
      setAdjusting(false)
    }
  }, [cropMode, cropRect, loaded, anyRedactions, t, loadFileIntoState, confirmAction])

  // Single derivation helper: takes the target flag values, always applies them
  // to the immutable originalImageFile, and reloads. Used by rotate, grayscale,
  // and brightness / contrast so they compose cleanly.
  const rederiveImage = useCallback(
    async (target: {
      rotationDeg?: number
      grayscale?: boolean
      brightness?: number
      contrast?: number
    }) => {
      if (!originalImageFile) return
      const nextRotation = target.rotationDeg ?? imageRotationDeg
      const nextGrayscale = target.grayscale ?? imageGrayscale
      const nextBrightness = target.brightness ?? imageBrightness
      const nextContrast = target.contrast ?? imageContrast
      setAdjusting(true)
      try {
        const mod = await import('./core/image/adjust.ts')
        let file: File = originalImageFile
        if (nextRotation !== 0) {
          const r = await mod.rotateImageFile(file, nextRotation)
          file = mod.fileFromBlob(r.blob, r.filename, '')
        }
        if (nextBrightness !== 0 || nextContrast !== 0) {
          const r = await mod.tuneImageFile(file, nextBrightness, nextContrast)
          file = mod.fileFromBlob(r.blob, r.filename, '')
        }
        if (nextGrayscale) {
          const r = await mod.grayscaleImageFile(file)
          file = mod.fileFromBlob(r.blob, r.filename, '')
        }
        setImageRotationDeg(nextRotation)
        setImageGrayscale(nextGrayscale)
        setImageBrightness(nextBrightness)
        setImageContrast(nextContrast)
        await loadFileIntoState(file, 'image', false)
      } finally {
        setAdjusting(false)
      }
    },
    [originalImageFile, imageRotationDeg, imageGrayscale, imageBrightness, imageContrast, loadFileIntoState],
  )

  const applyAdjust = useCallback(
    async (kind: 'rotate-left' | 'rotate-right' | 'grayscale') => {
      if (!loaded || loaded.kind !== 'image' || !originalImageFile) return
      if (kind === 'grayscale') {
        await rederiveImage({ grayscale: !imageGrayscale })
        return
      }
      // Rotate: transform any existing redactions by the same delta so they
      // land on the same pixels of the document after the image is rotated,
      // instead of being wiped.
      const delta = kind === 'rotate-right' ? 90 : 270
      const nextRotation = (imageRotationDeg + delta) % 360
      if (anyRedactions) {
        setRedactionsByPage((prev) => {
          const next = new Map<number, RedactionRect[]>()
          for (const [idx, arr] of prev) {
            next.set(idx, arr.map((r) => rotateRect90(r, kind === 'rotate-right' ? 'cw' : 'ccw')))
          }
          return next
        })
      }
      await rederiveImage({ rotationDeg: nextRotation })
    },
    [loaded, originalImageFile, imageRotationDeg, imageGrayscale, anyRedactions, rederiveImage],
  )

  // Debounced re-derivation on brightness / contrast slider release.
  const debouncedBrightness = useDebounced(imageBrightness, 120)
  const debouncedContrast = useDebounced(imageContrast, 120)
  const initialTuneRef = useRef(true)
  useEffect(() => {
    if (!originalImageFile) return
    if (initialTuneRef.current) {
      initialTuneRef.current = false
      return
    }
    void rederiveImage({ brightness: debouncedBrightness, contrast: debouncedContrast })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedBrightness, debouncedContrast])

  const resetTune = useCallback(() => {
    setImageBrightness(0)
    setImageContrast(0)
  }, [])

  // "Add another photo" flow — the discoverable single-step way to end up
  // with a 2-page combined document without knowing OS multi-select shortcuts.
  // Reads the second file from a hidden file input, combines with the current
  // image via the same code path as the batch combine, hands the PDF back to
  // the normal single-file loader.
  const addAnotherPhotoInputRef = useRef<HTMLInputElement>(null)

  const requestAddAnotherPhoto = useCallback(async () => {
    if (!loaded || loaded.kind !== 'image') return
    if (anyRedactions) {
      const ok = await confirmAction({
        title: t.workspace.addAnotherClearTitle,
        body: t.workspace.addAnotherPhotoConfirmClear,
        confirmLabel: t.workspace.commonContinue,
        cancelLabel: t.workspace.commonCancel,
        destructive: true,
      })
      if (!ok) return
    }
    addAnotherPhotoInputRef.current?.click()
  }, [loaded, anyRedactions, t, confirmAction])

  const onAddAnotherPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const secondFile = e.target.files?.[0]
      // Always reset the input so picking the same file twice still fires onChange.
      if (e.target.value) e.target.value = ''
      if (!secondFile || !loaded || loaded.kind !== 'image') return
      const secondKind = detectKind(secondFile)
      if (secondKind !== 'image') {
        setError(t.errors.unsupported)
        return
      }
      setError(null)
      setAddAnotherPromptOpen(false)
      setCombining(true)
      try {
        const { combineImagesToPdf, detectFrontBack } = await import('./core/pdf/combine-images.ts')
        const currentFile = loaded.file
        const inputs = [currentFile, secondFile]
        const { ordered } = detectFrontBack(inputs)
        const files = ordered.length ? [...ordered] : inputs
        const pdfBlob = await combineImagesToPdf(files)
        const name = `${files[0]?.name.replace(/\.[^.]+$/, '') ?? 'combined'}-combined.pdf`
        const combinedFile = new File([pdfBlob], name, {
          type: 'application/pdf',
          lastModified: Date.now(),
        })
        const dt = new DataTransfer()
        dt.items.add(combinedFile)
        await onFiles(dt.files)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`${t.errors.failed}: ${msg}`)
      } finally {
        setCombining(false)
      }
    },
    [loaded, t, onFiles],
  )

  // ---------- Slider divider handlers ----------

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    sliderDragging.current = true
  }, [])

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!sliderDragging.current) return
    const container = (e.currentTarget as HTMLElement).parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    setDividerX(Math.max(0, Math.min(1, x)))
  }, [])

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    sliderDragging.current = false
  }, [])

  const canProtect = !!loaded && !!recipient.trim() && !!purpose.trim() && !working

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-1.5 focus:rounded-md focus:text-sm"
        >
          {t.header.skipToMain}
        </a>

        <Header
          lang={lang}
          onLangChange={setLang}
          theme={theme}
          onThemeChange={setTheme}
          strings={t}
          onOpenHow={() => setHowOpen(true)}
          onOpenPrivacy={() => setPrivacyOpen(true)}
        />

        <main id="main" className="flex-1 w-full max-w-6xl mx-auto px-6 pt-6 pb-24 lg:pb-16">
        {!loaded && !loading && batch.length === 0 && (
          <HeroDrop
            dragActive={dragActive}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={() => setDragActive(false)}
            onFiles={onFiles}
            strings={t}
            error={error}
            onOpenHow={() => setHowOpen(true)}
          />
        )}

        {batch.length > 0 && !loaded && (
          <BatchWorkspace
            items={batch}
            progress={batchProgress}
            zipUrl={batchZipUrl}
            zipFilename={t.workspace.batchZipFilename}
            onRemove={removeBatchItem}
            onClear={async () => {
              if (batch.length) {
                const ok = await confirmAction({
                  title: t.workspace.batchClearAllTitle,
                  body: t.workspace.batchClearAllConfirm,
                  confirmLabel: t.workspace.commonDelete,
                  cancelLabel: t.workspace.commonCancel,
                  destructive: true,
                })
                if (!ok) return
              }
              clearBatch()
            }}
            onAddMore={onFiles}
            onProtectAll={protectBatch}
            onBuildZip={buildZip}
            onCombineToPdf={combineBatchToPdf}
            combining={combining}
            allImages={batch.length > 0 && batch.every((it) => it.kind === 'image')}
            frontBackDetected={frontBackDetected}
            recipient={recipient}
            purpose={purpose}
            level={level}
            onLevelChange={setLevelManual}
            onRecipient={setRecipient}
            onPurpose={setPurpose}
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
            crosshatchOn={previewProfile.watermark.patterns.crosshatch}
            frameOn={previewProfile.watermark.patterns.frame}
            iridescentOn={previewProfile.watermark.patterns.iridescent}
            guillocheOn={previewProfile.watermark.patterns.guilloche}
            moireOn={previewProfile.watermark.patterns.moire}
            onCrosshatchChange={(v) => setCrosshatchOverride(v)}
            onFrameChange={(v) => setFrameOverride(v)}
            onIridescentChange={(v) => setIridescentOverride(v)}
            onGuillocheChange={(v) => setGuillocheOverride(v)}
            onMoireChange={(v) => setMoireOverride(v)}
            customEnabled={customEnabled}
            customText={customText}
            onToggleCustom={() => setCustomEnabled((v) => !v)}
            onCustomText={setCustomText}
            error={error}
            strings={t}
          />
        )}

        {loading && (
          <div className="flex items-center justify-center py-32">
            <div className="text-sm text-muted-foreground animate-pulse">
              {lang === 'es' ? 'Cargando documento…' : 'Loading document…'}
            </div>
          </div>
        )}

        {loaded && !loading && batch.length === 0 && (
          <Workspace
            loaded={loaded}
            activePage={activePage}
            activePageIndex={activePageIndex}
            pageLoading={pageLoading}
            onSelectPage={(i) => {
              setActivePageIndex(i)
              setActiveRect(null)
            }}
            canvasRef={canvasRef}
            originalCanvasRef={originalCanvasRef}
            compareMode={compareMode}
            onCompareModeChange={setCompareMode}
            dividerX={dividerX}
            onDividerPointerDown={onDividerPointerDown}
            onDividerPointerMove={onDividerPointerMove}
            onDividerPointerUp={onDividerPointerUp}
            redactStyle={redactStyle}
            onRedactStyleChange={setRedactStyle}
            recipient={recipient}
            purpose={purpose}
            level={level}
            levelTouched={levelTouched}
            detection={detection}
            onOverrideDetection={overrideDetection}
            onAnalyzeText={runOcrDetection}
            ocrRunning={ocrRunning}
            ocrProgress={ocrProgress}
            ocrPhase={ocrPhase}
            onApplyRecommended={applyRecommendedLevel}
            onLevelChange={setLevelManual}
            onRecipient={setRecipient}
            onPurpose={setPurpose}
            crosshatchOn={previewProfile.watermark.patterns.crosshatch}
            frameOn={previewProfile.watermark.patterns.frame}
            iridescentOn={previewProfile.watermark.patterns.iridescent}
            guillocheOn={previewProfile.watermark.patterns.guilloche}
            moireOn={previewProfile.watermark.patterns.moire}
            onCrosshatchChange={(v) => setCrosshatchOverride(v)}
            onFrameChange={(v) => setFrameOverride(v)}
            onIridescentChange={(v) => setIridescentOverride(v)}
            onGuillocheChange={(v) => setGuillocheOverride(v)}
            onMoireChange={(v) => setMoireOverride(v)}
            opacity={previewProfile.watermark.opacity}
            rotationDeg={previewProfile.watermark.rotationDeg}
            fontSize={previewProfile.watermark.fontSize}
            colorHex={rgb01ToHex(previewProfile.watermark.color)}
            onOpacityChange={setOpacityOverride}
            onRotationChange={setRotationOverride}
            onFontSizeChange={setFontSizeOverride}
            onColorChange={setColorOverride}
            onResetStyle={() => {
              setOpacityOverride(null)
              setRotationOverride(null)
              setFontSizeOverride(null)
              setColorOverride(null)
            }}
            redactSolidColor={redactSolidColor}
            onRedactSolidColorChange={setRedactSolidColor}
            isPdf={loaded.kind === 'pdf'}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searching={searching}
            searchSummary={searchSummary}
            onRunSearch={runTextSearch}
            onClearSearch={clearSearchRedactions}
            adjusting={adjusting}
            onAdjust={applyAdjust}
            grayscaleActive={imageGrayscale}
            tuneOpen={tuneOpen}
            onToggleTune={() => setTuneOpen((v) => !v)}
            brightness={imageBrightness}
            contrast={imageContrast}
            onBrightnessChange={setImageBrightness}
            onContrastChange={setImageContrast}
            onResetTune={resetTune}
            cropMode={cropMode}
            cropRect={cropRect}
            onStartCrop={startCropMode}
            onCancelCrop={cancelCropMode}
            onApplyCrop={applyCrop}
            onAddAnotherPhoto={requestAddAnotherPhoto}
            addAnotherPhotoInputRef={addAnotherPhotoInputRef}
            onAddAnotherPhotoPicked={onAddAnotherPhoto}
            addAnotherPromptOpen={addAnotherPromptOpen}
            onDismissAddAnotherPrompt={() => setAddAnotherPromptOpen(false)}
            presets={presets}
            onApplyPreset={applyPreset}
            onSavePreset={onSaveCurrentPreset}
            onDeletePreset={(id) => { removePreset(id); pushToast(t.workspace.toastPresetDeleted) }}
            onClearAllPresets={onClearAllPresets}
            onDeleteAllLocalSettings={onDeleteAllLocalSettings}
            canSavePreset={!!recipient.trim() || !!purpose.trim()}
            onOutputNameChange={setOutputName}
            onClearOutput={clearOutput}
            outputFormat={outputFormat}
            onOutputFormatChange={setOutputFormat}
            customEnabled={customEnabled}
            customText={customText}
            onToggleCustom={() => {
              setCustomEnabled((v) => {
                if (!v) {
                  // Seed the textarea with current auto-generated lines when enabling
                  const lines = previewProfile.watermark.text.custom
                    ? previewProfile.watermark.text.custom
                    : [
                        lang === 'es'
                          ? `COPIA PARA ${(recipient.trim() || 'DESTINATARIO').toUpperCase()}`
                          : `COPY FOR ${(recipient.trim() || 'RECIPIENT').toUpperCase()}`,
                        lang === 'es'
                          ? `SOLO PARA ${(purpose.trim() || 'MOTIVO').toUpperCase()}`
                          : `FOR ${(purpose.trim() || 'PURPOSE').toUpperCase()} ONLY`,
                        todayIso(),
                      ]
                  setCustomText(lines.join('\n'))
                }
                return !v
              })
            }}
            onCustomText={setCustomText}
            onClear={clearDoc}
            onProtect={protect}
            canProtect={canProtect}
            working={working}
            outputUrl={outputUrl}
            outputName={outputName}
            error={error}
            strings={t}
            previewMetadataMode={previewProfile.metadata}
            redactMode={redactMode}
            onToggleRedactMode={() => setRedactMode((v) => !v)}
            redactionsCount={totalRedactionsCount}
            activePageRedactionsCount={activePageRedactions.length}
            onUndoRedaction={undoRedaction}
            onClearRedactions={clearRedactions}
            selectedRectId={selectedRectId}
            onDeleteSelectedRect={deleteSelectedRect}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            redactionsByPageMap={redactionsByPage}
            template={activeTemplate}
            templateSide={templateSide}
            onTemplateSideChange={setTemplateSide}
            activeTemplateFieldIds={activeFieldIds}
            onToggleTemplateField={toggleTemplateField}
            onApplyProfile={applyProfile}
            onClearTemplate={clearTemplate}
          />
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted-foreground gap-3 flex-wrap">
          <span className="font-mono tracking-tight">BlackLayer</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setHowOpen(true)}
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {t.header.navHowItWorks}
            </button>
            <button
              type="button"
              onClick={() => setPrivacyOpen(true)}
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {t.header.navPrivacy}
            </button>
            <span>{t.footer.tagline}</span>
          </div>
        </div>
      </footer>

      {loaded && !loading && batch.length === 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 lg:hidden border-t border-border bg-background/95 backdrop-blur px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
          role="region"
          aria-label={t.workspace.protect}
        >
          {outputUrl ? (
            <a
              href={outputUrl}
              download={(outputName && outputName.trim()) || undefined}
              className="inline-flex w-full items-center justify-center gap-2 h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              {t.result.download}
            </a>
          ) : (
            <Button onClick={protect} disabled={!canProtect} size="lg" className="w-full">
              {working ? t.workspace.working : t.workspace.protect}
            </Button>
          )}
        </div>
      )}
      <HowItWorksDialog open={howOpen} onOpenChange={setHowOpen} strings={t} />
      <PrivacyDialog open={privacyOpen} onOpenChange={setPrivacyOpen} strings={t} />
      <ConfirmDialog
        open={!!confirmState?.open}
        options={confirmState}
        onResult={handleConfirmResult}
      />
      <PromptDialog
        open={!!promptState?.open}
        options={promptState}
        onResult={handlePromptResult}
      />
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
    </TooltipProvider>
  )
}

// ---------- Header ----------

interface HeaderProps {
  lang: 'en' | 'es'
  onLangChange: (l: 'en' | 'es') => void
  theme: Theme
  onThemeChange: (t: Theme) => void
  strings: Strings
  onOpenHow: () => void
  onOpenPrivacy: () => void
}

function Header({
  lang,
  onLangChange,
  theme,
  onThemeChange,
  strings,
  onOpenHow,
  onOpenPrivacy,
}: HeaderProps): JSX.Element {
  return (
    <header className="border-b border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-bold tracking-tight">BlackLayer</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-2 py-0.5">
            <Shield className="h-3 w-3" />
            Local
          </span>
        </div>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onOpenHow}>
            <HelpCircle className="h-4 w-4" />
            {strings.header.navHowItWorks}
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenPrivacy}>
            <ShieldCheck className="h-4 w-4" />
            {strings.header.navPrivacy}
          </Button>
          <a
            href="https://github.com/TheCyberpunker/blacklayer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Code2 className="h-4 w-4" />
            <span>{strings.header.navSource}</span>
          </a>
        </nav>

        <div className="flex items-center gap-1">
          {/* Mobile nav triggers as icon-only */}
          <div className="flex md:hidden items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={strings.header.navHowItWorks} onClick={onOpenHow}>
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{strings.header.navHowItWorks}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={strings.header.navPrivacy} onClick={onOpenPrivacy}>
                  <ShieldCheck className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{strings.header.navPrivacy}</TooltipContent>
            </Tooltip>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={strings.header.langLabel}>
                <Languages className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase">{lang}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onLangChange('en')}>English</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onLangChange('es')}>Español</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={strings.header.themeLabel}>
                {theme === 'dark' ? (
                  <Moon className="h-4 w-4" />
                ) : theme === 'light' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Monitor className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onThemeChange('system')}>
                <Monitor className="h-4 w-4 mr-2" />
                {strings.header.themeSystem}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onThemeChange('light')}>
                <Sun className="h-4 w-4 mr-2" />
                {strings.header.themeLight}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onThemeChange('dark')}>
                <Moon className="h-4 w-4 mr-2" />
                {strings.header.themeDark}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

// ---------- Dialogs ----------

function HowItWorksDialog({
  open,
  onOpenChange,
  strings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  strings: Strings
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.dialogs.howItWorksTitle}</DialogTitle>
          <DialogDescription>{strings.dialogs.howItWorksSub}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-4 pt-2">
          {strings.dialogs.howSteps.map((s) => (
            <li key={s.title} className="space-y-1">
              <p className="font-medium text-sm">{s.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{strings.dialogs.howClose}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PrivacyDialog({
  open,
  onOpenChange,
  strings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  strings: Strings
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.dialogs.privacyTitle}</DialogTitle>
          <DialogDescription>{strings.dialogs.privacySub}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 pt-2 text-sm">
          {strings.dialogs.privacyBullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="h-4 w-4 shrink-0 mt-0.5 text-foreground/70" />
              <span className="leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-4 border-t border-border/60 space-y-2">
          <p className="text-sm font-medium">{strings.dialogs.privacyLimits}</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {strings.dialogs.privacyLimitBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/70" />
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{strings.dialogs.howClose}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Hero drop ----------

interface HeroDropProps {
  dragActive: boolean
  onDrop: (e: React.DragEvent<HTMLElement>) => void
  onDragOver: (e: React.DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onFiles: (list: FileList | null | undefined) => void
  strings: Strings
  error: string | null
  onOpenHow: () => void
}

function HeroDrop({
  dragActive,
  onDrop,
  onDragOver,
  onDragLeave,
  onFiles,
  strings,
  error,
  onOpenHow,
}: HeroDropProps): JSX.Element {
  return (
    <div className="max-w-2xl mx-auto pt-12 pb-8 text-center animate-fade-in">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
        {strings.hero.title}
      </h1>
      <p className="mt-3 text-muted-foreground text-base sm:text-lg text-balance">
        {strings.hero.subtitle}
      </p>

      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'mt-10 group block cursor-pointer rounded-2xl border-2 border-dashed transition-colors',
          'px-6 py-14 sm:py-16',
          dragActive
            ? 'border-foreground bg-muted/60'
            : 'border-border hover:border-foreground/40 hover:bg-muted/30',
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-foreground/70 group-hover:text-foreground transition-colors">
            <Upload className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-medium">{strings.hero.dropTitle}</p>
            <p className="text-sm text-muted-foreground mt-1">{strings.hero.dropSub}</p>
          </div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
            {strings.hero.supported}
          </p>
        </div>
        <input
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      {/* Trust row: three concrete promises. Non-technical users need to
          understand this doesn't send their document anywhere before they
          dare drop it. Keep to three, keep the icons monochrome. */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
          <Shield className="h-4 w-4 shrink-0 mt-0.5 text-foreground/70" />
          <div>
            <p className="text-xs font-medium text-foreground">{strings.hero.trustLocalTitle}</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{strings.hero.trustLocalBody}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
          <Eraser className="h-4 w-4 shrink-0 mt-0.5 text-foreground/70" />
          <div>
            <p className="text-xs font-medium text-foreground">{strings.hero.trustNoAccountTitle}</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{strings.hero.trustNoAccountBody}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-foreground/70" />
          <div>
            <p className="text-xs font-medium text-foreground">{strings.hero.trustOfflineTitle}</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{strings.hero.trustOfflineBody}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
        <button
          type="button"
          onClick={onOpenHow}
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <HelpCircle className="h-3 w-3" />
          {strings.workspace.heroFirstRunLink}
        </button>
      </div>

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------- Workspace ----------

interface WorkspaceProps {
  loaded: LoadedFile
  activePage: RenderedPage | null
  activePageIndex: number
  pageLoading: boolean
  onSelectPage: (i: number) => void
  canvasRef: React.RefObject<HTMLCanvasElement>
  originalCanvasRef: React.RefObject<HTMLCanvasElement>
  compareMode: CompareMode
  onCompareModeChange: (m: CompareMode) => void
  dividerX: number
  onDividerPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onDividerPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onDividerPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  redactStyle: RedactionMode
  onRedactStyleChange: (m: RedactionMode) => void
  recipient: string
  purpose: string
  level: ProtectionLevel
  levelTouched: boolean
  detection: DetectionResult
  onOverrideDetection: (type: DocumentType) => void
  onAnalyzeText: () => void
  ocrRunning: boolean
  ocrProgress: number
  ocrPhase: 'loading' | 'analyzing'
  onApplyRecommended: () => void
  onLevelChange: (l: ProtectionLevel) => void
  onRecipient: (v: string) => void
  onPurpose: (v: string) => void
  crosshatchOn: boolean
  frameOn: boolean
  iridescentOn: boolean
  guillocheOn: boolean
  moireOn: boolean
  onCrosshatchChange: (v: boolean) => void
  onFrameChange: (v: boolean) => void
  onIridescentChange: (v: boolean) => void
  onGuillocheChange: (v: boolean) => void
  onMoireChange: (v: boolean) => void
  opacity: number
  rotationDeg: number
  fontSize: number
  colorHex: string
  onOpacityChange: (v: number) => void
  onRotationChange: (v: number) => void
  onFontSizeChange: (v: number) => void
  onColorChange: (v: string) => void
  onResetStyle: () => void
  redactSolidColor: string
  onRedactSolidColorChange: (v: string) => void
  isPdf: boolean
  searchQuery: string
  onSearchQueryChange: (v: string) => void
  searching: boolean
  searchSummary: { matches: number; pages: number } | null
  onRunSearch: () => void
  onClearSearch: () => void
  adjusting: boolean
  onAdjust: (kind: 'rotate-left' | 'rotate-right' | 'grayscale') => void
  grayscaleActive: boolean
  tuneOpen: boolean
  onToggleTune: () => void
  brightness: number
  contrast: number
  onBrightnessChange: (v: number) => void
  onContrastChange: (v: number) => void
  onResetTune: () => void
  cropMode: boolean
  cropRect: { x: number; y: number; w: number; h: number } | null
  onStartCrop: () => void
  onCancelCrop: () => void
  onApplyCrop: () => void
  onAddAnotherPhoto: () => void
  addAnotherPhotoInputRef: React.RefObject<HTMLInputElement>
  onAddAnotherPhotoPicked: (e: React.ChangeEvent<HTMLInputElement>) => void
  addAnotherPromptOpen: boolean
  onDismissAddAnotherPrompt: () => void
  presets: Preset[]
  onApplyPreset: (p: Preset) => void
  onSavePreset: () => void
  onDeletePreset: (id: string) => void
  onClearAllPresets: () => void
  onDeleteAllLocalSettings: () => void
  canSavePreset: boolean
  onOutputNameChange: (v: string) => void
  onClearOutput: () => void
  outputFormat: 'pdf' | 'images'
  onOutputFormatChange: (v: 'pdf' | 'images') => void
  customEnabled: boolean
  customText: string
  onToggleCustom: () => void
  onCustomText: (v: string) => void
  onClear: () => void
  onProtect: () => void
  canProtect: boolean
  working: boolean
  outputUrl: string | null
  outputName: string
  error: string | null
  strings: Strings
  previewMetadataMode: 'preserve' | 'neutralize'
  redactMode: boolean
  onToggleRedactMode: () => void
  redactionsCount: number
  activePageRedactionsCount: number
  onUndoRedaction: () => void
  onClearRedactions: () => void
  selectedRectId: string | null
  onDeleteSelectedRect: () => void
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void
  redactionsByPageMap: ReadonlyMap<number, RedactionRect[]>
  template: DocumentTemplate | null
  templateSide: CardSide
  onTemplateSideChange: (s: CardSide) => void
  activeTemplateFieldIds: ReadonlySet<string>
  onToggleTemplateField: (field: FieldRect) => void
  onApplyProfile: (profile: TemplateProfile, template: DocumentTemplate) => void
  onClearTemplate: () => void
}

function Workspace(props: WorkspaceProps): JSX.Element {
  const {
    loaded,
    activePageIndex,
    pageLoading,
    onSelectPage,
    canvasRef,
    originalCanvasRef,
    compareMode,
    onCompareModeChange,
    dividerX,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
    redactStyle,
    onRedactStyleChange,
    recipient,
    purpose,
    level,
    levelTouched,
    detection,
    onOverrideDetection,
    onAnalyzeText,
    ocrRunning,
    ocrProgress,
    ocrPhase,
    onApplyRecommended,
    onLevelChange,
    onRecipient,
    onPurpose,
    crosshatchOn,
    frameOn,
    iridescentOn,
    guillocheOn,
    moireOn,
    onCrosshatchChange,
    onFrameChange,
    onIridescentChange,
    onGuillocheChange,
    onMoireChange,
    opacity,
    rotationDeg,
    fontSize,
    colorHex,
    onOpacityChange,
    onRotationChange,
    onFontSizeChange,
    onColorChange,
    onResetStyle,
    redactSolidColor,
    onRedactSolidColorChange,
    isPdf,
    searchQuery,
    onSearchQueryChange,
    searching,
    searchSummary,
    onRunSearch,
    onClearSearch,
    adjusting,
    onAdjust,
    grayscaleActive,
    tuneOpen,
    onToggleTune,
    brightness,
    contrast,
    onBrightnessChange,
    onContrastChange,
    onResetTune,
    cropMode,
    cropRect,
    onStartCrop,
    onCancelCrop,
    onApplyCrop,
    onAddAnotherPhoto,
    addAnotherPhotoInputRef,
    onAddAnotherPhotoPicked,
    addAnotherPromptOpen,
    onDismissAddAnotherPrompt,
    presets,
    onApplyPreset,
    onSavePreset,
    onDeletePreset,
    onClearAllPresets,
    onDeleteAllLocalSettings,
    canSavePreset,
    onOutputNameChange,
    onClearOutput,
    outputFormat,
    onOutputFormatChange,
    customEnabled,
    customText,
    onToggleCustom,
    onCustomText,
    onClear,
    onProtect,
    canProtect,
    working,
    outputUrl,
    outputName,
    error,
    strings,
    previewMetadataMode,
    redactMode,
    onToggleRedactMode,
    redactionsCount,
    activePageRedactionsCount,
    onUndoRedaction,
    onClearRedactions,
    selectedRectId,
    onDeleteSelectedRect,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    redactionsByPageMap,
    template,
    templateSide,
    onTemplateSideChange,
    activeTemplateFieldIds,
    onToggleTemplateField,
    onApplyProfile,
    onClearTemplate,
  } = props

  const sizeKb = (loaded.file.size / 1024).toFixed(1)
  const isMultiPage = loaded.base.totalPages > 1
  const suggestions = purposesFor(detection.type, strings.header.langLabel === 'Idioma' ? 'es' : 'en')
  const suggestedLevel = recommendedLevel(detection)
  const showRecommendationCallout = detection.type !== 'unknown' && !levelTouched && suggestedLevel !== level
  // Sidebar tab. The sidebar is a persistent drawer with 4 tabs; each tab's
  // full content is visible without scrolling, and switching between tabs is
  // instant. Presets, signature warning, Protect and result stay outside the
  // tab area, always visible.
  type SidebarTab = 'copia' | 'proteccion' | 'plantilla' | 'avanzado'
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('copia')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8 animate-fade-in">
      {/* Preview */}
      <section className="min-w-0">
        {/* Single meta row: file identity + detection + OCR + clear. Merged
            from two rows to give the canvas more vertical real estate. */}
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm min-w-0 max-w-full">
            {loaded.kind === 'pdf' ? (
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium truncate" title={loaded.file.name}>
              {loaded.file.name}
            </span>
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {loaded.kind === 'pdf' ? `${strings.workspace.pageCount(loaded.base.totalPages)} · ` : ''}
              {strings.workspace.fileSize(sizeKb)}
            </span>
          </div>
          <DetectionBadge
            detection={detection}
            strings={strings}
            onOverride={onOverrideDetection}
            inline
          />
          {!detection.manual &&
            detection.confidence !== 'high' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onAnalyzeText}
                    disabled={ocrRunning}
                    className="h-7 gap-1.5 text-[11px]"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    {ocrRunning
                      ? `${ocrPhase === 'loading' ? strings.workspace.ocrLoading : strings.workspace.ocrRunning}${ocrProgress > 0 ? ` ${Math.round(ocrProgress * 100)}%` : ''}`
                      : strings.workspace.ocrAnalyze}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{strings.workspace.ocrHint}</TooltipContent>
              </Tooltip>
            )}
          <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
            <X className="h-4 w-4" />
            {strings.workspace.clear}
          </Button>
        </div>

        {addAnotherPromptOpen &&
          loaded.kind === 'image' &&
          loaded.base.totalPages === 1 &&
          // Only surface the "add another photo" prompt when the loaded doc
          // is likely an identity card with a front and a back side. Passports
          // are a single data page, invoices are one photo, etc. Otherwise
          // this reads as noise.
          (detection.type === 'identity' || detection.type === 'driving_licence') && (
          <div className="mb-3 rounded-lg border border-foreground/60 bg-foreground/5 p-3 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
            <p className="text-sm">
              {strings.workspace.addAnotherPromptTitle}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={onDismissAddAnotherPrompt}>
                {strings.workspace.addAnotherPromptDismiss}
              </Button>
              <Button size="sm" onClick={onAddAnotherPhoto}>
                <ImagePlus className="h-4 w-4" />
                {strings.workspace.addAnotherPromptAction}
              </Button>
            </div>
          </div>
        )}

        <div
          className={cn(
            'rounded-xl border bg-muted/30 p-3 sm:p-4 transition-colors',
            redactMode ? 'border-foreground/60' : 'border-border',
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <ComparePicker
              value={compareMode}
              onChange={onCompareModeChange}
              strings={strings}
            />
            <div className="flex items-center gap-2">
              {(() => {
                const isImage = loaded.kind === 'image'
                const imageOnlyTip = strings.workspace.imageToolsPdfNote
                return (
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onAdjust('rotate-left')}
                        disabled={adjusting || !isImage}
                        aria-label={strings.workspace.adjustRotateLeft}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isImage ? strings.workspace.adjustRotateLeft : imageOnlyTip}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onAdjust('rotate-right')}
                        disabled={adjusting || !isImage}
                        aria-label={strings.workspace.adjustRotateRight}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isImage ? strings.workspace.adjustRotateRight : imageOnlyTip}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={grayscaleActive ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => onAdjust('grayscale')}
                        disabled={adjusting || !isImage}
                        aria-label={strings.workspace.adjustGrayscale}
                        aria-pressed={grayscaleActive}
                      >
                        <Contrast className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isImage ? strings.workspace.adjustGrayscale : imageOnlyTip}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={cropMode ? 'default' : 'ghost'}
                        size="icon"
                        onClick={cropMode ? onCancelCrop : onStartCrop}
                        disabled={adjusting || !isImage}
                        aria-label={cropMode ? strings.workspace.adjustCropCancel : strings.workspace.adjustCrop}
                        aria-pressed={cropMode}
                      >
                        <Crop className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!isImage
                        ? imageOnlyTip
                        : cropMode
                          ? strings.workspace.adjustCropCancel
                          : strings.workspace.adjustCrop}
                    </TooltipContent>
                  </Tooltip>
                  {isImage && cropMode && (
                    <Button
                      size="sm"
                      onClick={onApplyCrop}
                      disabled={
                        adjusting ||
                        !cropRect ||
                        cropRect.w < MIN_RECT * 2 ||
                        cropRect.h < MIN_RECT * 2
                      }
                      className="ml-1 h-9"
                    >
                      {strings.workspace.adjustCropApply}
                    </Button>
                  )}
                  <div className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={tuneOpen ? 'default' : 'ghost'}
                          size="icon"
                          onClick={onToggleTune}
                          disabled={adjusting || !isImage}
                          aria-label={strings.workspace.adjustTuneToggle}
                          aria-pressed={tuneOpen}
                          aria-expanded={tuneOpen}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isImage ? strings.workspace.adjustTuneToggle : imageOnlyTip}
                      </TooltipContent>
                    </Tooltip>
                    {isImage && tuneOpen && (
                      <div
                        role="dialog"
                        aria-label={strings.workspace.adjustTuneToggle}
                        className="absolute right-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-popover-foreground p-3 space-y-3 shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">
                            {strings.workspace.adjustTuneToggle}
                          </span>
                          <button
                            type="button"
                            onClick={onResetTune}
                            disabled={adjusting}
                            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            {strings.workspace.adjustTuneReset}
                          </button>
                        </div>
                        <SliderRow
                          label={strings.workspace.adjustBrightness}
                          value={brightness}
                          min={-100}
                          max={100}
                          step={1}
                          formatValue={(v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)}
                          onChange={onBrightnessChange}
                        />
                        <SliderRow
                          label={strings.workspace.adjustContrast}
                          value={contrast}
                          min={-100}
                          max={100}
                          step={1}
                          formatValue={(v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)}
                          onChange={onContrastChange}
                        />
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onAddAnotherPhoto}
                        disabled={adjusting || !isImage}
                        aria-label={strings.workspace.addAnotherPhoto}
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isImage ? strings.workspace.addAnotherPhoto : imageOnlyTip}
                    </TooltipContent>
                  </Tooltip>
                  <input
                    ref={addAnotherPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={onAddAnotherPhotoPicked}
                  />
                </div>
                )
              })()}
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                {isMultiPage
                  ? strings.workspace.pageStripCurrent(activePageIndex + 1, loaded.base.totalPages)
                  : ''}
              </span>
            </div>
          </div>

          <RedactToolbar
            redactMode={redactMode}
            onToggleRedactMode={onToggleRedactMode}
            redactStyle={redactStyle}
            onRedactStyleChange={onRedactStyleChange}
            redactSolidColor={redactSolidColor}
            onRedactSolidColorChange={onRedactSolidColorChange}
            onUndoRedaction={onUndoRedaction}
            onClearRedactions={onClearRedactions}
            activePageRedactionsCount={activePageRedactionsCount}
            redactionsCount={redactionsCount}
            selectedRectId={selectedRectId}
            onDeleteSelectedRect={onDeleteSelectedRect}
            isPdf={isPdf}
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            searching={searching}
            searchSummary={searchSummary}
            onRunSearch={onRunSearch}
            onClearSearch={onClearSearch}
            isMultiPage={isMultiPage}
            strings={strings}
          />

          <div className="relative w-full aspect-[3/4] sm:aspect-auto sm:min-h-[520px] bg-white rounded-lg overflow-hidden shadow-sm">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={cn(
                'absolute inset-0 w-full h-full object-contain touch-none select-none transition-opacity',
                (redactMode || cropMode) && compareMode === 'protected' ? 'cursor-crosshair' : '',
                // During image adjustments the canvas is redrawn imperceptibly
                // fast; dimming it would look like a jarring flash. Only dim
                // for real cross-page loads.
                pageLoading && !adjusting ? 'opacity-50' : 'opacity-100',
              )}
              style={{
                visibility: compareMode === 'original' ? 'hidden' : 'visible',
                // When the user is looking at the untouched original, drawing
                // or resizing redactions has no visible effect on that view
                // and would create invisible rects. Disable canvas input.
                pointerEvents: compareMode === 'original' ? 'none' : undefined,
              }}
            />
            {cropMode && cropRect && (
              <div
                className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{
                  left: `${cropRect.x * 100}%`,
                  top: `${cropRect.y * 100}%`,
                  width: `${cropRect.w * 100}%`,
                  height: `${cropRect.h * 100}%`,
                  outline: '9999px solid rgba(0,0,0,0.35)',
                  outlineOffset: '-2px',
                }}
              />
            )}
            {cropMode && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
                <Button variant="outline" size="sm" onClick={onCancelCrop} disabled={adjusting}>
                  {strings.workspace.adjustCropCancel}
                </Button>
                <Button
                  size="sm"
                  onClick={onApplyCrop}
                  disabled={
                    adjusting ||
                    !cropRect ||
                    cropRect.w < MIN_RECT * 2 ||
                    cropRect.h < MIN_RECT * 2
                  }
                >
                  {strings.workspace.adjustCropApply}
                </Button>
              </div>
            )}
            {cropMode && !cropRect && (
              <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 rounded bg-black/70 text-white text-[11px] px-3 py-1.5 z-10">
                {strings.workspace.adjustCropHint}
              </div>
            )}
            {pageLoading && !adjusting && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-black/70 text-white text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 animate-pulse">
                  loading page {activePageIndex + 1}…
                </div>
              </div>
            )}
            {compareMode !== 'protected' && (
              <canvas
                ref={originalCanvasRef}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={
                  compareMode === 'slider'
                    ? { clipPath: `inset(0 ${(1 - dividerX) * 100}% 0 0)` }
                    : undefined
                }
              />
            )}
            {compareMode === 'slider' && (
              <div
                className="absolute inset-y-0 z-10"
                style={{ left: `${dividerX * 100}%`, transform: 'translateX(-50%)' }}
                onPointerDown={onDividerPointerDown}
                onPointerMove={onDividerPointerMove}
                onPointerUp={onDividerPointerUp}
                onPointerCancel={onDividerPointerUp}
              >
                <div className="relative h-full w-1 bg-foreground/80 cursor-ew-resize">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center shadow-md">
                    <ChevronDown className="h-4 w-4 -rotate-90" />
                  </div>
                </div>
              </div>
            )}
            {compareMode === 'slider' && (
              <>
                <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 text-white text-[10px] font-mono uppercase tracking-wider px-2 py-1">
                  {strings.workspace.compareOriginal}
                </div>
                <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/70 text-white text-[10px] font-mono uppercase tracking-wider px-2 py-1">
                  {strings.workspace.compareProtected}
                </div>
              </>
            )}
            {compareMode === 'protected' && redactMode && (
              <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 text-white text-[10px] font-mono uppercase tracking-wider px-2 py-1">
                {strings.workspace.redactSectionTitle}
              </div>
            )}
          </div>

          {isMultiPage && (
            <PageStrip
              loaded={loaded}
              activePageIndex={activePageIndex}
              onSelectPage={onSelectPage}
              redactionsByPage={redactionsByPageMap}
              strings={strings}
            />
          )}

        </div>
      </section>

      {/* Controls */}
      <aside className="lg:sticky lg:top-20 lg:self-start flex flex-col gap-3">
        {/* Fixed top row: Presets. */}
        <div className="flex items-center justify-end">
          <PresetBar
            presets={presets}
            onApply={onApplyPreset}
            onSave={onSavePreset}
            onDelete={onDeletePreset}
            onClearAll={onClearAllPresets}
            canSave={canSavePreset}
            strings={strings}
          />
        </div>

        {outputUrl ? (
          // Post-Protect success view. Replaces the tabs+CTA so the moment of
          // "your protected copy is ready" gets the full sidebar. Keeps the
          // Presets row above intact.
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-start gap-3 rounded-xl border border-foreground/20 bg-foreground/[0.03] p-4">
              <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center">
                <Check className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground leading-tight">
                  {strings.result.ready}
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {strings.result.readySub}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="download-name">{strings.workspace.downloadNameLabel}</Label>
              <Input
                id="download-name"
                value={outputName}
                onChange={(e) => onOutputNameChange(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>

            <a
              href={outputUrl}
              download={(outputName && outputName.trim()) || undefined}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 h-12 px-4',
                'rounded-md bg-primary text-primary-foreground text-sm font-semibold',
                'hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <Download className="h-4 w-4" />
              {strings.result.download}
            </a>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <ul className="text-xs text-muted-foreground space-y-1">
                <AppliedItem>{strings.result.appliedRecipient}</AppliedItem>
                <AppliedItem>{strings.result.appliedPurpose}</AppliedItem>
                <AppliedItem>
                  {level === 'basic' ? strings.result.appliedSingle : strings.result.appliedTiled}
                </AppliedItem>
                {previewMetadataMode === 'neutralize' && (
                  <AppliedItem>{strings.result.appliedMetadata}</AppliedItem>
                )}
                {crosshatchOn && <AppliedItem>{strings.workspace.appliedCrosshatch}</AppliedItem>}
                {frameOn && <AppliedItem>{strings.workspace.appliedFrame}</AppliedItem>}
                {iridescentOn && <AppliedItem>{strings.workspace.appliedIridescent}</AppliedItem>}
                {guillocheOn && <AppliedItem>{strings.workspace.appliedGuilloche}</AppliedItem>}
                {moireOn && <AppliedItem>{strings.workspace.appliedMoire}</AppliedItem>}
                {redactionsCount > 0 && (
                  <AppliedItem>{strings.result.appliedRedactions(redactionsCount)}</AppliedItem>
                )}
                <AppliedItem>{strings.result.appliedLocalOnly}</AppliedItem>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs">
              <p className="text-muted-foreground">{strings.result.originalNote}</p>
            </div>
            <button
              type="button"
              onClick={onClearOutput}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              {strings.result.protectAgain}
            </button>
          </div>
        ) : (
        <>
        {/* Tab strip. All tabs sit here, only the active one's content renders below. */}
        <div role="tablist" aria-label="Ajustes del documento" className="grid grid-cols-4 gap-1 p-1 rounded-md bg-muted">
          {([
            { id: 'copia' as const, label: strings.workspace.tabCopia },
            { id: 'proteccion' as const, label: strings.workspace.tabProteccion },
            { id: 'plantilla' as const, label: strings.workspace.tabPlantilla },
            { id: 'avanzado' as const, label: strings.workspace.tabAvanzado },
          ]).map((t) => {
            const selected = sidebarTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSidebarTab(t.id)}
                className={cn(
                  'h-8 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab content. No fixed heights; each tab is short enough to fit within
            the sidebar's sticky viewport without scroll (see individual panels
            below for their compact layouts). */}
        <div className="min-h-0">
          {sidebarTab === 'copia' && (
            <section className="space-y-3" aria-label={strings.workspace.tabCopia}>
              <div className="space-y-1.5">
                <Label htmlFor="recipient">{strings.workspace.recipient}</Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => onRecipient(e.target.value)}
                  placeholder={strings.workspace.recipientPh}
                  autoComplete="off"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purpose">{strings.workspace.purpose}</Label>
                <Input
                  id="purpose"
                  value={purpose}
                  onChange={(e) => onPurpose(e.target.value)}
                  placeholder={strings.workspace.purposePh}
                  autoComplete="off"
                  maxLength={80}
                />
                {suggestions.length > 0 && (
                  <div className="pt-1.5 flex flex-wrap gap-1.5">
                    {suggestions.slice(0, 4).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onPurpose(s.label)}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          purpose === s.label
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {sidebarTab === 'proteccion' && (
            <section className="space-y-3" aria-label={strings.workspace.tabProteccion}>
              <LevelPicker level={level} onChange={onLevelChange} strings={strings} />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {strings.workspace.levelDescription[level]}
              </p>
              {previewMetadataMode === 'neutralize' && (
                <p className="text-[11px] text-muted-foreground/80 font-mono">
                  {strings.workspace.metadataNoteRemoved}
                </p>
              )}
              {showRecommendationCallout && (
                <button
                  type="button"
                  onClick={onApplyRecommended}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover:border-foreground/40 hover:bg-muted/50 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2 text-xs">
                    <Sparkles className="h-3.5 w-3.5 text-foreground/70" />
                    {strings.workspace.recommendedFor(strings.workspace.detectionLabel[detection.type])}
                  </span>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    {strings.workspace.applyRecommended}
                  </span>
                </button>
              )}
            </section>
          )}

          {sidebarTab === 'plantilla' && (() => {
            if (template) {
              const tmplLang = strings.header.langLabel === 'Idioma' ? 'es' : 'en'
              return (
                <TemplatePanel
                  template={template}
                  side={templateSide}
                  onSideChange={onTemplateSideChange}
                  activeFieldIds={activeTemplateFieldIds}
                  onToggleField={onToggleTemplateField}
                  onApplyProfile={onApplyProfile}
                  onClear={onClearTemplate}
                  lang={tmplLang}
                  strings={strings}
                  embedded
                />
              )
            }
            // Empty state: no template because either detection is weak or the
            // document type doesn't have one shipped. Guide the user rather
            // than gating the tab.
            const canRunOcr = !ocrRunning
            return (
              <div className="space-y-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-foreground/60" />
                  <p className="leading-relaxed">
                    {strings.workspace.templateEmpty}
                  </p>
                </div>
                {canRunOcr && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onAnalyzeText}
                    className="gap-1.5 text-xs"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    {strings.workspace.ocrAnalyze}
                  </Button>
                )}
                {/* Manual quick-picks. Works for PDFs too (where OCR is not
                    wired yet) and for images where OCR was inconclusive. Each
                    button flips detection.manual so templateFor unlocks the
                    matching template. */}
                <div className="pt-1 space-y-1.5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/80">
                    {strings.workspace.templateQuickPickLabel}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOverrideDetection('identity')}
                      className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {strings.workspace.detectionSubtypeDni}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOverrideDetection('passport')}
                      className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {strings.workspace.detectionSubtypePassport}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOverrideDetection('driving_licence')}
                      className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {strings.workspace.detectionSubtypeDrivingLicence}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  {strings.workspace.templateEmptyHint}
                </p>
              </div>
            )
          })()}

          {sidebarTab === 'avanzado' && (
            <section className="space-y-4" aria-label={strings.workspace.tabAvanzado}>
              <StyleSliders
                opacity={opacity}
                rotationDeg={rotationDeg}
                fontSize={fontSize}
                colorHex={colorHex}
                onOpacity={onOpacityChange}
                onRotation={onRotationChange}
                onFontSize={onFontSizeChange}
                onColor={onColorChange}
                onReset={onResetStyle}
                strings={strings}
              />
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  {strings.workspace.patternsLabel}
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <PatternPill
                    label={strings.workspace.patternCrosshatchLabel}
                    checked={crosshatchOn}
                    onChange={onCrosshatchChange}
                  />
                  <PatternPill
                    label={strings.workspace.patternFrameLabel}
                    checked={frameOn}
                    onChange={onFrameChange}
                  />
                  <PatternPill
                    label={strings.workspace.patternIridescentLabel}
                    checked={iridescentOn}
                    onChange={onIridescentChange}
                  />
                  <PatternPill
                    label={strings.workspace.patternGuillocheLabel}
                    checked={guillocheOn}
                    onChange={onGuillocheChange}
                  />
                  <PatternPill
                    label={strings.workspace.patternMoireLabel}
                    checked={moireOn}
                    onChange={onMoireChange}
                  />
                </div>
              </div>
              <CustomTextBlock
                enabled={customEnabled}
                onToggle={onToggleCustom}
                value={customText}
                onChange={onCustomText}
                strings={strings}
              />
              <button
                type="button"
                onClick={onDeleteAllLocalSettings}
                className="flex items-center gap-2 text-left text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                <span>{strings.workspace.deleteLocalSettings}</span>
              </button>
            </section>
          )}
        </div>

        {/* Fixed bottom: warning + primary CTA + result. Always visible. */}
        {loaded.kind === 'pdf' && loaded.hasSignature && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{strings.workspace.signatureWarning}</span>
          </div>
        )}

        {/* Output format lives next to the CTA, not in Ajustes, because it is a
            download decision not a protection setting. Only shown when it
            actually offers a choice: a multi-page PDF. */}
        {loaded.kind === 'pdf' && loaded.base.totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">
              {strings.workspace.outputFormatLabel}:
            </span>
            <div
              role="radiogroup"
              aria-label={strings.workspace.outputFormatLabel}
              className="flex-1 grid grid-cols-2 gap-1 p-0.5 rounded-md bg-muted"
            >
              <button
                type="button"
                role="radio"
                aria-checked={outputFormat === 'pdf'}
                onClick={() => onOutputFormatChange('pdf')}
                className={cn(
                  'h-7 text-[11px] font-medium rounded transition-colors',
                  outputFormat === 'pdf'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {strings.workspace.outputFormatPdf}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={outputFormat === 'images'}
                onClick={() => onOutputFormatChange('images')}
                className={cn(
                  'h-7 text-[11px] font-medium rounded transition-colors',
                  outputFormat === 'images'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {strings.workspace.outputFormatImages}
              </button>
            </div>
          </div>
        )}

        <Button onClick={onProtect} disabled={!canProtect} size="lg" className="w-full">
          {working ? strings.workspace.working : strings.workspace.protect}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
        </>
        )}
      </aside>
    </div>
  )
}

// ---------- Detection badge ----------

function DetectionBadge({
  detection,
  strings,
  onOverride,
  inline = false,
}: {
  detection: DetectionResult
  strings: Strings
  onOverride: (type: DocumentType) => void
  /**
   * When true, skip the outer margin+layout wrapper so the caller can compose
   * the badge into a shared row (e.g. next to an OCR button).
   */
  inline?: boolean
}): JSX.Element | null {
  if (detection.type === 'unknown' && !detection.manual && detection.confidence === 'unknown') {
    return null
  }
  const typeLabel = strings.workspace.detectionLabel[detection.type]
  const subLabel = subtypeLabel(detection, strings)
  const primaryText = detection.type === 'unknown'
    ? strings.workspace.detectionLabel.unknown
    : strings.workspace.detected(typeLabel)
  const showLow = detection.confidence === 'low'

  const Wrapper: (props: { children: React.ReactNode }) => JSX.Element = inline
    ? ({ children }) => <>{children}</>
    : ({ children }) => <div className="mb-3 flex items-center gap-2 flex-wrap">{children}</div>

  return (
    <Wrapper>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs',
              'border transition-colors',
              detection.manual
                ? 'border-foreground/50 bg-foreground/5'
                : 'border-border hover:border-foreground/40 bg-muted/30',
            )}
          >
            <Sparkles className="h-3 w-3 text-foreground/70" />
            <span className="font-medium">{primaryText}</span>
            {subLabel && (
              <span className="text-muted-foreground">· {subLabel}</span>
            )}
            <ChevronDown className="h-3 w-3 opacity-60 ml-1" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {OVERRIDE_TYPES.map((tp) => (
            <DropdownMenuItem key={tp} onSelect={() => onOverride(tp)}>
              {strings.workspace.detectionLabel[tp]}
              {detection.type === tp && <Check className="h-3.5 w-3.5 ml-2 opacity-70" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {showLow && (
        <span className="text-[11px] text-muted-foreground">{strings.workspace.detectedLow}</span>
      )}
      {detection.manual && (
        <span className="text-[11px] font-mono text-muted-foreground">
          {strings.workspace.detectedManual}
        </span>
      )}
    </Wrapper>
  )
}

// ---------- Page strip ----------

function PageStrip({
  loaded,
  activePageIndex,
  onSelectPage,
  redactionsByPage,
  strings,
}: {
  loaded: LoadedFile
  activePageIndex: number
  onSelectPage: (i: number) => void
  redactionsByPage: ReadonlyMap<number, RedactionRect[]>
  strings: Strings
}): JSX.Element {
  const thumbnails = loaded.base.thumbnails

  return (
    <div className="mt-3">
      <div
        role="listbox"
        aria-label={strings.workspace.pageStripLabel}
        className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1"
      >
        {thumbnails.map((thumb) => {
          const rects = redactionsByPage.get(thumb.index) ?? []
          return (
            <PageThumb
              key={thumb.index}
              thumb={thumb}
              selected={thumb.index === activePageIndex}
              redactionCount={rects.length}
              onSelect={() => onSelectPage(thumb.index)}
            />
          )
        })}
      </div>
    </div>
  )
}

function PageThumb({
  thumb,
  selected,
  redactionCount,
  onSelect,
}: {
  thumb: RenderedThumb
  selected: boolean
  redactionCount: number
  onSelect: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = thumb.thumbnail.width
    c.height = thumb.thumbnail.height
    const ctx = c.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(thumb.thumbnail, 0, 0)
  }, [thumb.thumbnail])

  const aspect = thumb.thumbnail.width / thumb.thumbnail.height
  const heightPx = 96
  const widthPx = Math.max(48, Math.round(heightPx * aspect))

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'relative shrink-0 rounded-md overflow-hidden border-2 transition-colors bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-foreground' : 'border-border hover:border-foreground/40',
      )}
      style={{ width: widthPx, height: heightPx }}
      title={`Page ${thumb.index + 1}`}
    >
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
      <span
        className={cn(
          'absolute bottom-0.5 left-0.5 text-[10px] font-mono px-1 rounded',
          selected ? 'bg-foreground text-background' : 'bg-black/60 text-white',
        )}
      >
        {thumb.index + 1}
      </span>
      {redactionCount > 0 && (
        <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-foreground border border-background" />
      )}
    </button>
  )
}

interface BatchWorkspaceProps {
  items: BatchItem[]
  progress: { done: number; total: number } | null
  zipUrl: string | null
  zipFilename: string
  onRemove: (id: string) => void
  onClear: () => void
  onAddMore: (list: FileList | null | undefined) => void
  onProtectAll: () => void
  onBuildZip: () => void
  onCombineToPdf: () => void
  combining: boolean
  allImages: boolean
  frontBackDetected: boolean
  recipient: string
  purpose: string
  level: ProtectionLevel
  onLevelChange: (l: ProtectionLevel) => void
  onRecipient: (v: string) => void
  onPurpose: (v: string) => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
  crosshatchOn: boolean
  frameOn: boolean
  iridescentOn: boolean
  guillocheOn: boolean
  moireOn: boolean
  onCrosshatchChange: (v: boolean) => void
  onFrameChange: (v: boolean) => void
  onIridescentChange: (v: boolean) => void
  onGuillocheChange: (v: boolean) => void
  onMoireChange: (v: boolean) => void
  customEnabled: boolean
  customText: string
  onToggleCustom: () => void
  onCustomText: (v: string) => void
  error: string | null
  strings: Strings
}

function BatchWorkspace(props: BatchWorkspaceProps): JSX.Element {
  const {
    items,
    progress,
    zipUrl,
    zipFilename,
    onRemove,
    onClear,
    onAddMore,
    onProtectAll,
    onBuildZip,
    onCombineToPdf,
    combining,
    allImages,
    frontBackDetected,
    recipient,
    purpose,
    level,
    onLevelChange,
    onRecipient,
    onPurpose,
    advancedOpen,
    onToggleAdvanced,
    crosshatchOn,
    frameOn,
    iridescentOn,
    guillocheOn,
    moireOn,
    onCrosshatchChange,
    onFrameChange,
    onIridescentChange,
    onGuillocheChange,
    onMoireChange,
    customEnabled,
    customText,
    onToggleCustom,
    onCustomText,
    error,
    strings,
  } = props

  const totalBytes = items.reduce((n, it) => n + it.file.size, 0)
  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const anyProcessing = items.some((it) => it.status === 'processing' || it.status === 'queued')
  const canProtect = items.length > 0 && !!recipient.trim() && !!purpose.trim() && !anyProcessing
  const canZip = doneCount > 0 && !anyProcessing

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8 animate-fade-in">
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{strings.workspace.batchTitle}</span>
            <span className="text-xs text-muted-foreground font-mono">
              {strings.workspace.batchCount(items.length)} · {strings.workspace.batchTotalSize((totalBytes / 1024).toFixed(1))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <label className="inline-flex items-center gap-1 text-xs px-2.5 h-8 rounded-md border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-ring">
              <Plus className="h-3.5 w-3.5" />
              {strings.workspace.batchAddMore}
              <input
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => onAddMore(e.target.files)}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="h-4 w-4" />
              {strings.workspace.batchClearAll}
            </Button>
          </div>
        </div>

        {/* Combine panel — promoted to the top of the batch when it applies, so
         *  the "two sides of one document" case is the first thing the user
         *  sees. Highlighted as recommended when filename detection lands. */}
        {allImages && items.length >= 2 && (
          <div
            className={cn(
              'mb-3 rounded-lg border p-3 space-y-2 transition-colors',
              frontBackDetected ? 'border-foreground bg-foreground/5' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{strings.workspace.batchCombineTitle}</span>
              </div>
              {frontBackDetected && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-foreground bg-foreground/10 px-1.5 py-0.5 rounded">
                  {strings.workspace.batchCombineRecommended}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {frontBackDetected
                ? strings.workspace.batchCombineTwoSides
                : strings.workspace.batchCombineHint}
            </p>
            <Button
              variant={frontBackDetected ? 'default' : 'outline'}
              size="sm"
              onClick={onCombineToPdf}
              disabled={combining}
            >
              <FileText className="h-4 w-4" />
              {combining ? strings.workspace.batchCombineWorking : strings.workspace.batchCombineButton}
            </Button>
          </div>
        )}

        <div className="rounded-xl border border-border bg-muted/30 p-2">
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <BatchRow
                key={it.id}
                item={it}
                onRemove={() => onRemove(it.id)}
                strings={strings}
              />
            ))}
          </ul>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">{strings.workspace.batchNoRedactionNote}</p>
        {errorCount > 0 && (
          <p className="mt-2 text-xs text-destructive">
            {errorCount} of {items.length} failed. Check individual rows.
          </p>
        )}
      </section>

      <aside className="lg:sticky lg:top-20 lg:self-start space-y-5">
        <section className="space-y-4" aria-label={strings.workspace.stepAbout}>
          <StepHeading step={1} title={strings.workspace.stepAbout} />
          <div className="space-y-1.5">
            <Label htmlFor="batch-recipient">{strings.workspace.recipient}</Label>
            <Input
              id="batch-recipient"
              value={recipient}
              onChange={(e) => onRecipient(e.target.value)}
              placeholder={strings.workspace.recipientPh}
              autoComplete="off"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batch-purpose">{strings.workspace.purpose}</Label>
            <Input
              id="batch-purpose"
              value={purpose}
              onChange={(e) => onPurpose(e.target.value)}
              placeholder={strings.workspace.purposePh}
              autoComplete="off"
              maxLength={80}
            />
          </div>
        </section>

        <section className="space-y-2 pt-4 border-t border-border/60" aria-label={strings.workspace.stepProtection}>
          <StepHeading step={2} title={strings.workspace.stepProtection} />
          <LevelPicker level={level} onChange={onLevelChange} strings={strings} />
          <p className="text-xs text-muted-foreground pt-0.5 leading-relaxed">
            {strings.workspace.levelDescription[level]}
          </p>
          <p className="text-xs text-muted-foreground/80">{strings.workspace.batchHelper}</p>
        </section>

        <section className="space-y-2 pt-4 border-t border-border/60">
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="flex items-center justify-between w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-expanded={advancedOpen}
          >
            <StepHeading step={3} title={strings.workspace.stepAdvanced} optional />
            <ChevronDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', advancedOpen ? 'rotate-180' : '')}
            />
          </button>
          {advancedOpen && (
            <div className="space-y-3">
              <PatternToggle
                label={strings.workspace.patternCrosshatchLabel}
                hint={strings.workspace.patternCrosshatchHint}
                checked={crosshatchOn}
                onChange={onCrosshatchChange}
              />
              <PatternToggle
                label={strings.workspace.patternFrameLabel}
                hint={strings.workspace.patternFrameHint}
                checked={frameOn}
                onChange={onFrameChange}
              />
              <PatternToggle
                label={strings.workspace.patternIridescentLabel}
                hint={strings.workspace.patternIridescentHint}
                checked={iridescentOn}
                onChange={onIridescentChange}
              />
              <PatternToggle
                label={strings.workspace.patternGuillocheLabel}
                hint={strings.workspace.patternGuillocheHint}
                checked={guillocheOn}
                onChange={onGuillocheChange}
              />
              <PatternToggle
                label={strings.workspace.patternMoireLabel}
                hint={strings.workspace.patternMoireHint}
                checked={moireOn}
                onChange={onMoireChange}
              />
              <CustomTextBlock
                enabled={customEnabled}
                onToggle={onToggleCustom}
                value={customText}
                onChange={onCustomText}
                strings={strings}
              />
            </div>
          )}
        </section>

        <Button onClick={onProtectAll} disabled={!canProtect} size="lg" className="w-full">
          {progress
            ? strings.workspace.batchProtectAllProgress(progress.done, progress.total)
            : strings.workspace.batchProtectAll}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {doneCount > 0 && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm font-semibold">
              {doneCount} / {items.length} · {strings.result.ready}
            </p>
            {zipUrl ? (
              <a
                href={zipUrl}
                download={zipFilename}
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 h-10 px-4',
                  'rounded-md bg-primary text-primary-foreground text-sm font-medium',
                  'hover:bg-primary/90 transition-colors',
                )}
              >
                <Archive className="h-4 w-4" />
                {strings.workspace.batchDownloadZip}
              </a>
            ) : (
              <Button onClick={onBuildZip} disabled={!canZip} className="w-full">
                <Archive className="h-4 w-4" />
                {strings.workspace.batchDownloadZip}
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
              {strings.result.originalNote}
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}

function BatchRow({
  item,
  onRemove,
  strings,
}: {
  item: BatchItem
  onRemove: () => void
  strings: Strings
}): JSX.Element {
  const sizeKb = (item.file.size / 1024).toFixed(1)
  const statusLabel: Record<BatchItemStatus, string> = {
    idle: strings.workspace.batchStatusIdle,
    queued: strings.workspace.batchStatusQueued,
    processing: strings.workspace.batchStatusProcessing,
    done: strings.workspace.batchStatusDone,
    error: strings.workspace.batchStatusError,
  }
  const statusClass: Record<BatchItemStatus, string> = {
    idle: 'text-muted-foreground',
    queued: 'text-muted-foreground',
    processing: 'text-foreground',
    done: 'text-foreground',
    error: 'text-destructive',
  }
  return (
    <li className="flex items-center gap-3 px-2 py-2.5">
      {item.kind === 'pdf' ? (
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      ) : (
        <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="text-[11px] text-muted-foreground font-mono">
          {sizeKb} KB · {item.kind.toUpperCase()}
          {item.error ? ` · ${item.error}` : ''}
        </p>
      </div>
      <span className={cn('text-[11px] font-mono uppercase tracking-wider shrink-0 inline-flex items-center gap-1', statusClass[item.status])}>
        {item.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
        {statusLabel[item.status]}
      </span>
      {item.status === 'done' && item.outputBlob && (
        <a
          href={URL.createObjectURL(item.outputBlob)}
          download={item.outputName}
          className="inline-flex items-center gap-1 text-xs px-2 h-7 rounded-md border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-3 w-3" />
          {strings.workspace.batchDownloadOne}
        </a>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={strings.workspace.batchRemoveOne}
            disabled={item.status === 'processing'}
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{strings.workspace.batchRemoveOne}</TooltipContent>
      </Tooltip>
    </li>
  )
}

function TemplatePanel({
  template,
  side,
  onSideChange,
  activeFieldIds,
  onToggleField,
  onApplyProfile,
  onClear,
  lang,
  strings,
  embedded = false,
}: {
  template: DocumentTemplate
  side: CardSide
  onSideChange: (s: CardSide) => void
  activeFieldIds: ReadonlySet<string>
  onToggleField: (field: FieldRect) => void
  onApplyProfile: (profile: TemplateProfile, template: DocumentTemplate) => void
  onClear: () => void
  lang: 'en' | 'es'
  strings: Strings
  /**
   * When embedded in a CollapsibleRow the outer heading + border + top hint
   * paragraph would duplicate the row chrome. Skip them.
   */
  embedded?: boolean
}): JSX.Element {
  const label = lang === 'es' ? template.labelEs : template.labelEn
  const fields = template.fields.filter((f) => f.side === side)
  const anyActive = fields.some((f) => activeFieldIds.has(f.id))

  return (
    <section
      className={embedded ? 'space-y-3' : 'space-y-3 pt-4 border-t border-border/60'}
      aria-label={strings.workspace.templateTitle(label)}
    >
      {!embedded && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Sparkles className="h-3.5 w-3.5 text-foreground/70" />
              <span>{strings.workspace.templateTitle(label)}</span>
            </div>
            {anyActive && (
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
              >
                {strings.workspace.templateClear}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{strings.workspace.templateHint}</p>
        </>
      )}
      {embedded && anyActive && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            {strings.workspace.templateClear}
          </button>
        </div>
      )}

      {/* Side selector */}
      <div
        role="radiogroup"
        aria-label="Card side"
        className="grid grid-cols-2 gap-1 p-1 rounded-md bg-muted"
      >
        {(['anverso', 'reverso'] as CardSide[]).map((s) => {
          const selected = s === side
          const l = s === 'anverso' ? strings.workspace.templateSideAnverso : strings.workspace.templateSideReverso
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSideChange(s)}
              className={cn(
                'h-8 text-xs font-medium rounded transition-colors',
                selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l}
            </button>
          )
        })}
      </div>

      {/* Profile chips */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {strings.workspace.templateProfilesLabel}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {template.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onApplyProfile(p, template)}
              title={lang === 'es' ? p.descriptionEs : p.descriptionEn}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {lang === 'es' ? p.labelEs : p.labelEn}
            </button>
          ))}
        </div>
      </div>

      {/* Field checkboxes */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {strings.workspace.templateFieldsLabel}
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {fields.map((f) => {
            const checked = activeFieldIds.has(f.id)
            const l = lang === 'es' ? f.labelEs : f.labelEn
            return (
              <label
                key={f.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors cursor-pointer text-xs',
                  checked
                    ? 'border-foreground bg-foreground/5 text-foreground'
                    : 'border-border hover:border-foreground/40 text-muted-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleField(f)}
                  className="h-3.5 w-3.5 rounded border-input accent-foreground"
                />
                <span className="truncate">{l}</span>
              </label>
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/80 italic">{strings.workspace.templateInexact}</p>
    </section>
  )
}

function StepHeading({
  title,
  optional,
}: {
  /** Legacy prop kept for callers that still pass it; ignored visually. */
  step?: number
  title: string
  optional?: boolean
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      {optional && (
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          optional
        </span>
      )}
    </div>
  )
}

/**
 * Collapsible sidebar row used by Direction C: a one-line clickable summary
 * that expands into a full panel below it. Keeps default state minimal so
 * non-technical users are not overwhelmed.
 */
function PresetBar({
  presets,
  onApply,
  onSave,
  onDelete,
  onClearAll,
  canSave,
  strings,
}: {
  presets: Preset[]
  onApply: (p: Preset) => void
  onSave: () => void
  onDelete: (id: string) => void
  onClearAll: () => void
  canSave: boolean
  strings: Strings
}): JSX.Element {
  const hasAny = presets.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md border border-border hover:border-foreground/40 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>{strings.workspace.presetsLabel}</span>
          {hasAny && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {presets.length}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {hasAny ? (
          presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-accent"
            >
              <button
                type="button"
                onClick={() => onApply(p)}
                className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate font-medium text-foreground">{p.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {p.recipient || p.purpose || strings.workspace.presetsEmptyHint}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(p.id) }}
                aria-label={strings.workspace.presetsDeleteOne}
                className="shrink-0 p-1 text-muted-foreground hover:text-destructive rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        ) : (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground/80">
            {strings.workspace.presetsEmptyHint}
          </p>
        )}
        <div className="my-1 h-px bg-border" />
        <DropdownMenuItem
          disabled={!canSave}
          onSelect={(e) => { e.preventDefault(); if (canSave) onSave() }}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{strings.workspace.presetsSave}</span>
        </DropdownMenuItem>
        {hasAny && (
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); onClearAll() }}
            className="text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{strings.workspace.presetsClearAll}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ComparePicker({
  value,
  onChange,
  strings,
}: {
  value: CompareMode
  onChange: (m: CompareMode) => void
  strings: Strings
}): JSX.Element {
  const items: { key: CompareMode; label: string }[] = [
    { key: 'protected', label: strings.workspace.compareProtected },
    { key: 'slider', label: strings.workspace.compareSlider },
    { key: 'original', label: strings.workspace.compareOriginal },
  ]
  return (
    <div
      role="radiogroup"
      aria-label={strings.workspace.compareLabel}
      className="inline-flex gap-1 p-0.5 rounded-md bg-muted text-xs"
    >
      {items.map((it) => {
        const selected = it.key === value
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(it.key)}
            className={cn(
              'px-2.5 h-7 rounded font-medium transition-colors',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

function RedactToolbar({
  redactMode,
  onToggleRedactMode,
  redactStyle,
  onRedactStyleChange,
  redactSolidColor,
  onRedactSolidColorChange,
  onUndoRedaction,
  onClearRedactions,
  activePageRedactionsCount,
  redactionsCount,
  selectedRectId,
  onDeleteSelectedRect,
  isPdf,
  searchQuery,
  onSearchQueryChange,
  searching,
  searchSummary,
  onRunSearch,
  onClearSearch,
  isMultiPage,
  strings,
}: {
  redactMode: boolean
  onToggleRedactMode: () => void
  redactStyle: RedactionMode
  onRedactStyleChange: (m: RedactionMode) => void
  redactSolidColor: string
  onRedactSolidColorChange: (v: string) => void
  onUndoRedaction: () => void
  onClearRedactions: () => void
  activePageRedactionsCount: number
  redactionsCount: number
  selectedRectId: string | null
  onDeleteSelectedRect: () => void
  isPdf: boolean
  searchQuery: string
  onSearchQueryChange: (v: string) => void
  searching: boolean
  searchSummary: { matches: number; pages: number } | null
  onRunSearch: () => void
  onClearSearch: () => void
  isMultiPage: boolean
  strings: Strings
}): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false)
  const styleLabels: Record<RedactionMode, string> = {
    solid: strings.workspace.redactModeSolid,
    blur: strings.workspace.redactModeBlur,
    pixelate: strings.workspace.redactModePixelate,
  }
  const tooShort = searchQuery.trim().length > 0 && searchQuery.trim().length < 2

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-2">
      <Button
        variant={redactMode ? 'default' : 'outline'}
        size="sm"
        onClick={onToggleRedactMode}
      >
        {redactMode ? (
          <>
            <Check className="h-4 w-4" />
            {strings.workspace.redactStop}
          </>
        ) : (
          <>
            <Eraser className="h-4 w-4" />
            {strings.workspace.redactStart}
          </>
        )}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {styleLabels[redactStyle]}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {REDACT_MODES.map((m) => (
            <DropdownMenuItem key={m} onSelect={() => onRedactStyleChange(m)}>
              {styleLabels[m]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {redactStyle === 'solid' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="inline-flex items-center gap-1.5 h-9 px-2 rounded-md border border-input hover:border-foreground/40 cursor-pointer">
              <input
                type="color"
                value={redactSolidColor}
                onChange={(e) => onRedactSolidColorChange(e.target.value)}
                aria-label={strings.workspace.redactSolidColor}
                className="h-4 w-4 rounded border border-input bg-transparent cursor-pointer"
              />
              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                {redactSolidColor}
              </span>
            </label>
          </TooltipTrigger>
          <TooltipContent>{strings.workspace.redactSolidColor}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndoRedaction}
            disabled={activePageRedactionsCount === 0}
            aria-label={strings.workspace.redactUndo}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{strings.workspace.redactUndo}</TooltipContent>
      </Tooltip>

      {redactionsCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearRedactions}
        >
          {strings.workspace.redactClear}
        </Button>
      )}

      {selectedRectId && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDeleteSelectedRect}
        >
          <X className="h-4 w-4" />
          {strings.workspace.deleteSelected}
        </Button>
      )}

      {isPdf && (
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={searchOpen ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setSearchOpen((v) => !v)}
                aria-label={strings.workspace.searchTitle}
                aria-expanded={searchOpen}
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{strings.workspace.searchTitle}</TooltipContent>
          </Tooltip>
          {searchOpen && (
            <div
              role="dialog"
              aria-label={strings.workspace.searchTitle}
              className="absolute left-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-popover-foreground p-3 space-y-2 shadow-lg animate-fade-in"
            >
              <div className="flex items-center gap-2 text-xs">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">{strings.workspace.searchTitle}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !searching && !tooShort && searchQuery.trim()) {
                      e.preventDefault()
                      onRunSearch()
                    }
                  }}
                  placeholder={strings.workspace.searchPlaceholder}
                  autoComplete="off"
                  maxLength={120}
                  className="flex-1 h-9 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRunSearch}
                  disabled={searching || tooShort || !searchQuery.trim()}
                >
                  {searching ? strings.workspace.searchWorking : strings.workspace.searchRun}
                </Button>
              </div>
              {tooShort && (
                <p className="text-[11px] text-muted-foreground/80">{strings.workspace.searchTooShort}</p>
              )}
              {searchSummary && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-mono">
                    {searchSummary.matches > 0
                      ? strings.workspace.searchResults(searchSummary.matches, searchSummary.pages)
                      : strings.workspace.searchNoResults}
                  </span>
                  {searchSummary.matches > 0 && (
                    <button
                      type="button"
                      onClick={onClearSearch}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      {strings.workspace.searchClear}
                    </button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                {strings.workspace.searchLimitationsPdfOnly}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
        {redactMode && (
          <span className="text-foreground/70">{strings.workspace.redactHint}</span>
        )}
        {redactionsCount > 0 && (
          <span>{strings.workspace.redactCount(redactionsCount)}</span>
        )}
        {isMultiPage && redactMode && (
          <span title={strings.workspace.redactPdfLimitation} className="text-muted-foreground/70">
            {strings.workspace.redactPdfLimitation}
          </span>
        )}
      </div>
    </div>
  )
}

function LevelPicker({
  level,
  onChange,
  strings,
}: {
  level: ProtectionLevel
  onChange: (l: ProtectionLevel) => void
  strings: Strings
}): JSX.Element {
  const labels: Record<ProtectionLevel, string> = {
    basic: strings.workspace.levelBasic,
    recommended: strings.workspace.levelRecommended,
    maximum: strings.workspace.levelMaximum,
  }
  return (
    <div
      role="radiogroup"
      aria-label={strings.workspace.levelHeading}
      className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted"
    >
      {LEVELS.map((l) => {
        const selected = l === level
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(l)}
            className={cn(
              'h-8 text-xs font-medium rounded transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {labels[l]}
          </button>
        )
      })}
    </div>
  )
}

function AppliedItem({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 h-1 w-1 rounded-full bg-foreground/60 shrink-0" />
      <span>{children}</span>
    </li>
  )
}

function StyleSliders({
  opacity,
  rotationDeg,
  fontSize,
  colorHex,
  onOpacity,
  onRotation,
  onFontSize,
  onColor,
  onReset,
  strings,
}: {
  opacity: number
  rotationDeg: number
  fontSize: number
  colorHex: string
  onOpacity: (v: number) => void
  onRotation: (v: number) => void
  onFontSize: (v: number) => void
  onColor: (v: string) => void
  onReset: () => void
  strings: Strings
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{strings.workspace.styleTitle}</Label>
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {strings.workspace.styleReset}
        </button>
      </div>
      <SliderRow
        label={strings.workspace.styleOpacity}
        value={opacity}
        min={0.05}
        max={1}
        step={0.01}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={onOpacity}
      />
      <SliderRow
        label={strings.workspace.styleRotation}
        value={rotationDeg}
        min={-90}
        max={90}
        step={1}
        formatValue={(v) => `${Math.round(v)}°`}
        onChange={onRotation}
      />
      <SliderRow
        label={strings.workspace.styleFontSize}
        value={fontSize}
        min={8}
        max={48}
        step={1}
        formatValue={(v) => `${Math.round(v)}pt`}
        onChange={onFontSize}
      />
      <label className="flex items-center justify-between">
        <span className="text-xs text-foreground">{strings.workspace.styleColor}</span>
        <span className="inline-flex items-center gap-2">
          <input
            type="color"
            value={colorHex}
            onChange={(e) => onColor(e.target.value)}
            aria-label={strings.workspace.styleColor}
            className="h-6 w-9 rounded border border-input bg-background cursor-pointer"
          />
          <span className="font-mono text-[11px] text-muted-foreground uppercase">{colorHex}</span>
        </span>
      </label>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (v: number) => string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs mb-1">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-foreground"
      />
    </label>
  )
}

function PatternToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
      />
      <div className="flex-1">
        <span className="text-sm font-medium block leading-none">{label}</span>
        <span className="text-[11px] text-muted-foreground block mt-1">{hint}</span>
      </div>
    </label>
  )
}

/**
 * Compact pill-shape toggle used in the Advanced tab's patterns grid. Fits
 * two per row and shows just the label; hint is a native tooltip so the grid
 * stays dense enough for all patterns to be visible without scroll.
 */
function PatternPill({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={label}
      className={cn(
        'text-xs font-medium h-8 px-3 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left truncate',
        checked
          ? 'border-foreground bg-foreground text-background'
          : 'border-border hover:border-foreground/40 bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function CustomTextBlock({
  enabled,
  onToggle,
  value,
  onChange,
  strings,
}: {
  enabled: boolean
  onToggle: () => void
  value: string
  onChange: (v: string) => void
  strings: Strings
}): JSX.Element {
  return (
    <div className="pt-1">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
        />
        <div className="flex-1">
          <span className="text-sm font-medium block leading-none">{strings.workspace.customizeText}</span>
          <span className="text-[11px] text-muted-foreground block mt-1">{strings.workspace.customTextHint}</span>
        </div>
      </label>
      {enabled && (
        <textarea
          aria-label={strings.workspace.customTextLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background resize-y"
        />
      )}
    </div>
  )
}
