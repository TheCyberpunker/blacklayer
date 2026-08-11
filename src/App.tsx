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
import { Contrast, Crop, RotateCcw, RotateCw, Search } from 'lucide-react'
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

export function App(): JSX.Element {
  const { lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const { presets, save: savePreset, remove: removePreset, clear: clearPresets } = usePresets()
  const t = useMemo(() => getStrings(lang), [lang])
  const [howOpen, setHowOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

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
  const [crosshatchOverride, setCrosshatchOverride] = useState<boolean | null>(null)
  const [frameOverride, setFrameOverride] = useState<boolean | null>(null)
  const [opacityOverride, setOpacityOverride] = useState<number | null>(null)
  const [rotationOverride, setRotationOverride] = useState<number | null>(null)
  const [fontSizeOverride, setFontSizeOverride] = useState<number | null>(null)
  const [colorOverride, setColorOverride] = useState<string | null>(null)
  const [redactSolidColor, setRedactSolidColor] = useState<string>('#000000')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchSummary, setSearchSummary] = useState<{ matches: number; pages: number } | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  // Image adjustments live as flags on top of an immutable original file.
  // Every toggle re-derives the working file from the original, so grayscale is
  // reversible and rotations always start from the same base.
  const [originalImageFile, setOriginalImageFile] = useState<File | null>(null)
  const [imageRotationDeg, setImageRotationDeg] = useState<number>(0)
  const [imageGrayscale, setImageGrayscale] = useState<boolean>(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
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
          opacity: opacityOverride ?? undefined,
          rotationDeg: rotationOverride ?? undefined,
          fontSize: fontSizeOverride ?? undefined,
          color: colorOverride ? hexToRgb01(colorOverride) : undefined,
        },
      ),
    [level, debouncedRecipient, debouncedPurpose, lang, effectiveCustom, docSeed, crosshatchOverride, frameOverride, opacityOverride, rotationOverride, fontSizeOverride, colorOverride],
  )

  const activePageRedactions = redactionsByPage.get(activePageIndex) ?? []
  const totalRedactionsCount = useMemo(() => {
    let n = 0
    for (const arr of redactionsByPage.values()) n += arr.length
    return n
  }, [redactionsByPage])

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

  // Live redraw of the composite (protected view).
  useEffect(() => {
    if (!loaded || !activePage || !canvasRef.current) return
    composite({
      target: canvasRef.current,
      page: activePage,
      options: previewProfile.watermark,
      lang,
      redactions: activePageRedactions,
      activeRect,
    })
  }, [loaded, activePage, previewProfile, lang, activePageRedactions, activeRect])

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
  }, [])

  // Low-level loader used both by fresh drops and by the adjustments effect.
  // Does everything a fresh drop does *except* touch originalImageFile / the
  // adjustment flags — those are the responsibility of the caller.
  const loadFileIntoState = useCallback(
    async (f: File, kind: 'pdf' | 'image', resetAdjustmentDependent: boolean) => {
      setLoading(true)
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
          } catch {
            setDetection(UNKNOWN_DETECTION)
          }
        })()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`${t.errors.failed}: ${msg}`)
      } finally {
        setLoading(false)
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
  }, [])

  const onSaveCurrentPreset = useCallback(() => {
    const rec = recipient.trim()
    const pur = purpose.trim()
    if (!rec && !pur) return
    const defaultName = rec || pur || t.workspace.presetsSavePromptDefault
    const name = window.prompt(t.workspace.presetsSavePromptTitle, defaultName)
    if (!name || !name.trim()) return
    savePreset({
      name: name.trim(),
      recipient: rec,
      purpose: pur,
      level,
      crosshatch: crosshatchOverride,
      frame: frameOverride,
    })
  }, [recipient, purpose, level, crosshatchOverride, frameOverride, savePreset, t])

  const onClearAllPresets = useCallback(() => {
    if (!presets.length) return
    if (!window.confirm(t.workspace.presetsClearAllConfirm)) return
    clearPresets()
  }, [presets.length, clearPresets, t])

  const onDeleteAllLocalSettings = useCallback(() => {
    if (!window.confirm(t.workspace.deleteLocalSettingsConfirm)) return
    clearAllLocalSettings()
    clearPresets()
    // Restore in-memory defaults so the running session looks reset too.
    setTheme('system')
    setLang(navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en')
  }, [clearPresets, setTheme, setLang, t])

  const overrideDetection = useCallback((type: DocumentType) => {
    setDetection((prev) => ({
      ...prev,
      type,
      subtype: null,
      country: prev.country,
      confidence: 'medium',
      manual: true,
      reasons: ['manual override'],
    }))
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
          opacity: opacityOverride ?? undefined,
          rotationDeg: rotationOverride ?? undefined,
          fontSize: fontSizeOverride ?? undefined,
          color: colorOverride ? hexToRgb01(colorOverride) : undefined,
        },
      )
      let blob: Blob
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
        blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
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
      }
      clearOutput()
      const url = URL.createObjectURL(blob)
      setOutputUrl(url)
      setOutputName(suggestOutputName(loaded.file.name, loaded.kind))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${t.errors.failed}: ${msg}`)
    } finally {
      setWorking(false)
    }
  }, [loaded, level, recipient, purpose, lang, customEnabled, customText, redactionsByPage, docSeed, crosshatchOverride, frameOverride, opacityOverride, rotationOverride, fontSizeOverride, colorOverride, t, clearOutput])

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
          { crosshatch: crosshatchOverride ?? undefined, frame: frameOverride ?? undefined },
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
  }, [batch, batchZipUrl, level, recipient, purpose, lang, customEnabled, customText, crosshatchOverride, frameOverride])

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

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!loaded || compareMode !== 'protected') return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      if (cropMode) {
        e.preventDefault()
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        dragStartRef.current = p
        setCropRect({ x: p.x, y: p.y, w: 0, h: 0 })
        return
      }
      if (!redactMode) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      dragStartRef.current = p
      setActiveRect({ id: 'active', x: p.x, y: p.y, w: 0, h: 0, mode: redactStyle })
    },
    [redactMode, cropMode, loaded, canvasToNormalized, compareMode, redactStyle],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragStartRef.current) return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      const start = dragStartRef.current
      const rect = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      }
      if (cropMode) {
        setCropRect(rect)
        return
      }
      if (!redactMode) return
      setActiveRect({
        id: 'active',
        ...rect,
        mode: redactStyle,
      })
    },
    [redactMode, cropMode, canvasToNormalized, redactStyle],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      dragStartRef.current = null
      if (cropMode) {
        // Keep the selection for review; user confirms via Apply.
        return
      }
      if (!redactMode) return
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
    },
    [redactMode, cropMode, activeRect, activePageIndex, redactStyle, redactSolidColor],
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
  }, [])

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

      const pagesTouched = new Set(matches.map((m) => m.pageIndex)).size
      setSearchSummary({ matches: matches.length, pages: pagesTouched })
    } catch {
      setSearchSummary({ matches: 0, pages: 0 })
    } finally {
      setSearching(false)
    }
  }, [loaded, searchQuery, redactStyle, redactSolidColor])

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
      if (!window.confirm(t.workspace.adjustConfirmClearRedactions)) return
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
  }, [cropMode, cropRect, loaded, anyRedactions, t, loadFileIntoState])

  const applyAdjust = useCallback(
    async (kind: 'rotate-left' | 'rotate-right' | 'grayscale') => {
      if (!loaded || loaded.kind !== 'image' || !originalImageFile) return

      // Compute the target adjustment values without mutating state yet, so
      // the derivation always runs from the immutable original.
      const willRotate = kind !== 'grayscale'
      if (willRotate && anyRedactions) {
        if (!window.confirm(t.workspace.adjustConfirmClearRedactions)) return
      }
      const nextRotation = willRotate
        ? (imageRotationDeg + (kind === 'rotate-right' ? 90 : 270)) % 360
        : imageRotationDeg
      const nextGrayscale = kind === 'grayscale' ? !imageGrayscale : imageGrayscale

      setAdjusting(true)
      try {
        const mod = await import('./core/image/adjust.ts')
        let file: File = originalImageFile
        if (nextRotation !== 0) {
          const r = await mod.rotateImageFile(file, nextRotation)
          file = mod.fileFromBlob(r.blob, r.filename, '')
        }
        if (nextGrayscale) {
          const r = await mod.grayscaleImageFile(file)
          file = mod.fileFromBlob(r.blob, r.filename, '')
        }
        setImageRotationDeg(nextRotation)
        setImageGrayscale(nextGrayscale)
        if (willRotate && anyRedactions) setRedactionsByPage(new Map())
        await loadFileIntoState(file, 'image', false)
      } finally {
        setAdjusting(false)
      }
    },
    [loaded, originalImageFile, imageRotationDeg, imageGrayscale, anyRedactions, t, loadFileIntoState],
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

        <main id="main" className="flex-1 w-full max-w-6xl mx-auto px-6 pt-6 pb-16">
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
            onClear={() => {
              if (batch.length && !window.confirm(t.workspace.batchClearAllConfirm)) return
              clearBatch()
            }}
            onAddMore={onFiles}
            onProtectAll={protectBatch}
            onBuildZip={buildZip}
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
            onCrosshatchChange={(v) => setCrosshatchOverride(v)}
            onFrameChange={(v) => setFrameOverride(v)}
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
            onApplyRecommended={applyRecommendedLevel}
            onLevelChange={setLevelManual}
            onRecipient={setRecipient}
            onPurpose={setPurpose}
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
            crosshatchOn={previewProfile.watermark.patterns.crosshatch}
            frameOn={previewProfile.watermark.patterns.frame}
            onCrosshatchChange={(v) => setCrosshatchOverride(v)}
            onFrameChange={(v) => setFrameOverride(v)}
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
            cropMode={cropMode}
            cropRect={cropRect}
            onStartCrop={startCropMode}
            onCancelCrop={cancelCropMode}
            onApplyCrop={applyCrop}
            presets={presets}
            onApplyPreset={applyPreset}
            onSavePreset={onSaveCurrentPreset}
            onDeletePreset={removePreset}
            onClearAllPresets={onClearAllPresets}
            onDeleteAllLocalSettings={onDeleteAllLocalSettings}
            canSavePreset={!!recipient.trim() || !!purpose.trim()}
            onOutputNameChange={setOutputName}
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

      <HowItWorksDialog open={howOpen} onOpenChange={setHowOpen} strings={t} />
      <PrivacyDialog open={privacyOpen} onOpenChange={setPrivacyOpen} strings={t} />
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
          'px-6 py-16 sm:py-20',
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

      <div className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <Shield className="h-3 w-3" />
          {strings.hero.privacy}
        </span>
        <span aria-hidden="true">·</span>
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
  onApplyRecommended: () => void
  onLevelChange: (l: ProtectionLevel) => void
  onRecipient: (v: string) => void
  onPurpose: (v: string) => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
  crosshatchOn: boolean
  frameOn: boolean
  onCrosshatchChange: (v: boolean) => void
  onFrameChange: (v: boolean) => void
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
  cropMode: boolean
  cropRect: { x: number; y: number; w: number; h: number } | null
  onStartCrop: () => void
  onCancelCrop: () => void
  onApplyCrop: () => void
  presets: Preset[]
  onApplyPreset: (p: Preset) => void
  onSavePreset: () => void
  onDeletePreset: (id: string) => void
  onClearAllPresets: () => void
  onDeleteAllLocalSettings: () => void
  canSavePreset: boolean
  onOutputNameChange: (v: string) => void
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
    onApplyRecommended,
    onLevelChange,
    onRecipient,
    onPurpose,
    advancedOpen,
    onToggleAdvanced,
    crosshatchOn,
    frameOn,
    onCrosshatchChange,
    onFrameChange,
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
    cropMode,
    cropRect,
    onStartCrop,
    onCancelCrop,
    onApplyCrop,
    presets,
    onApplyPreset,
    onSavePreset,
    onDeletePreset,
    onClearAllPresets,
    onDeleteAllLocalSettings,
    canSavePreset,
    onOutputNameChange,
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8 animate-fade-in">
      {/* Preview */}
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
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
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" />
            {strings.workspace.clear}
          </Button>
        </div>

        <DetectionBadge
          detection={detection}
          strings={strings}
          onOverride={onOverrideDetection}
        />

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
              {loaded.kind === 'image' && (
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onAdjust('rotate-left')}
                        disabled={adjusting}
                        aria-label={strings.workspace.adjustRotateLeft}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{strings.workspace.adjustRotateLeft}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onAdjust('rotate-right')}
                        disabled={adjusting}
                        aria-label={strings.workspace.adjustRotateRight}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{strings.workspace.adjustRotateRight}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={grayscaleActive ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => onAdjust('grayscale')}
                        disabled={adjusting}
                        aria-label={strings.workspace.adjustGrayscale}
                        aria-pressed={grayscaleActive}
                      >
                        <Contrast className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{strings.workspace.adjustGrayscale}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={cropMode ? 'default' : 'ghost'}
                        size="icon"
                        onClick={cropMode ? onCancelCrop : onStartCrop}
                        disabled={adjusting}
                        aria-label={strings.workspace.adjustCrop}
                        aria-pressed={cropMode}
                      >
                        <Crop className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{strings.workspace.adjustCrop}</TooltipContent>
                  </Tooltip>
                </div>
              )}
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                {isMultiPage
                  ? strings.workspace.pageStripCurrent(activePageIndex + 1, loaded.base.totalPages)
                  : ''}
              </span>
            </div>
          </div>

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
                pageLoading ? 'opacity-50' : 'opacity-100',
              )}
              style={{
                visibility: compareMode === 'original' ? 'hidden' : 'visible',
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
            {pageLoading && (
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
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-5">
        <PresetBar
          presets={presets}
          onApply={onApplyPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
          onClearAll={onClearAllPresets}
          canSave={canSavePreset}
          strings={strings}
        />

        <section className="space-y-4" aria-label={strings.workspace.stepAbout}>
          <StepHeading step={1} title={strings.workspace.stepAbout} />
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
              <div className="pt-1.5">
                <div className="flex flex-wrap gap-1.5">
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
              </div>
            )}
          </div>
        </section>

        <section className="space-y-2 pt-4 border-t border-border/60" aria-label={strings.workspace.stepProtection}>
          <StepHeading step={2} title={strings.workspace.stepProtection} />
          <LevelPicker level={level} onChange={onLevelChange} strings={strings} />
          <p className="text-xs text-muted-foreground pt-0.5 leading-relaxed">
            {strings.workspace.levelDescription[level]}
          </p>
          {previewMetadataMode === 'neutralize' && (
            <p className="text-xs text-muted-foreground/80 font-mono">
              {strings.workspace.metadataNoteRemoved}
            </p>
          )}
          {showRecommendationCallout && (
            <button
              type="button"
              onClick={onApplyRecommended}
              className="mt-2 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover:border-foreground/40 hover:bg-muted/50 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        {template && (
          <TemplatePanel
            template={template}
            side={templateSide}
            onSideChange={onTemplateSideChange}
            activeFieldIds={activeTemplateFieldIds}
            onToggleField={onToggleTemplateField}
            onApplyProfile={onApplyProfile}
            onClear={onClearTemplate}
            lang={strings.header.langLabel === 'Idioma' ? 'es' : 'en'}
            strings={strings}
          />
        )}

        {/* Redaction */}
        <section className="space-y-2 pt-4 border-t border-border/60" aria-label={strings.workspace.stepRedact}>
          <div className="flex items-center justify-between">
            <StepHeading step={3} title={strings.workspace.stepRedact} optional />
            {redactionsCount > 0 && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {strings.workspace.redactCount(redactionsCount)}
              </span>
            )}
          </div>
          <RedactStylePicker
            value={redactStyle}
            onChange={onRedactStyleChange}
            strings={strings}
          />
          {redactStyle === 'solid' && (
            <label className="flex items-center justify-between pt-1">
              <span className="text-xs text-foreground">{strings.workspace.redactSolidColor}</span>
              <span className="inline-flex items-center gap-2">
                <input
                  type="color"
                  value={redactSolidColor}
                  onChange={(e) => onRedactSolidColorChange(e.target.value)}
                  aria-label={strings.workspace.redactSolidColor}
                  className="h-6 w-9 rounded border border-input bg-background cursor-pointer"
                />
                <span className="font-mono text-[11px] text-muted-foreground uppercase">
                  {redactSolidColor}
                </span>
              </span>
            </label>
          )}
          {redactStyle !== 'solid' && (
            <p className="text-[11px] text-muted-foreground/80">
              {strings.workspace.redactModeHint}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              variant={redactMode ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleRedactMode}
              className="flex-1"
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onUndoRedaction}
                  disabled={activePageRedactionsCount === 0}
                  aria-label={strings.workspace.redactUndo}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{strings.workspace.redactUndo}</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearRedactions}
              disabled={redactionsCount === 0}
            >
              {strings.workspace.redactClear}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {redactMode ? strings.workspace.redactHint : ''}
          </p>
          {isMultiPage && (
            <p className="text-[11px] text-muted-foreground/80 font-mono">
              {strings.workspace.redactPdfLimitation}
            </p>
          )}

          {isPdf && (
            <TextSearchPanel
              query={searchQuery}
              onQueryChange={onSearchQueryChange}
              searching={searching}
              summary={searchSummary}
              onRun={onRunSearch}
              onClear={onClearSearch}
              strings={strings}
            />
          )}
        </section>

        {/* Advanced */}
        <section className="space-y-2 pt-4 border-t border-border/60">
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="flex items-center justify-between w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-expanded={advancedOpen}
          >
            <StepHeading step={4} title={strings.workspace.stepAdvanced} optional />
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                advancedOpen ? 'rotate-180' : '',
              )}
            />
          </button>
          {advancedOpen && (
            <div className="space-y-4">
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
              <CustomTextBlock
                enabled={customEnabled}
                onToggle={onToggleCustom}
                value={customText}
                onChange={onCustomText}
                strings={strings}
              />
              <div className="pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={onDeleteAllLocalSettings}
                  className="mt-2 w-full flex items-center gap-2 text-left text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{strings.workspace.deleteLocalSettings}</span>
                </button>
                <p className="mt-1 text-xs text-muted-foreground pl-5 leading-relaxed">
                  {strings.workspace.deleteLocalSettingsHint}
                </p>
              </div>
            </div>
          )}
        </section>

        {loaded.kind === 'pdf' && loaded.hasSignature && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{strings.workspace.signatureWarning}</span>
          </div>
        )}

        <Button onClick={onProtect} disabled={!canProtect} size="lg" className="w-full">
          {working ? strings.workspace.working : strings.workspace.protect}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {outputUrl && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3 animate-fade-in">
            <div>
              <p className="text-sm font-semibold">{strings.result.ready}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{strings.result.readySub}</p>
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
              <p className="text-[11px] text-muted-foreground">{strings.workspace.downloadNameHint}</p>
            </div>
            <a
              href={outputUrl}
              download={(outputName && outputName.trim()) || undefined}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 h-10 px-4',
                'rounded-md bg-primary text-primary-foreground text-sm font-medium',
                'hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <Download className="h-4 w-4" />
              {strings.result.download}
            </a>
            <ul className="text-xs text-muted-foreground space-y-1 pt-1">
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
              {redactionsCount > 0 && (
                <AppliedItem>{strings.result.appliedRedactions(redactionsCount)}</AppliedItem>
              )}
              <AppliedItem>{strings.result.appliedLocalOnly}</AppliedItem>
            </ul>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
              {strings.result.originalNote}
            </p>
          </div>
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
}: {
  detection: DetectionResult
  strings: Strings
  onOverride: (type: DocumentType) => void
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

  return (
    <div className="mb-3 flex items-center gap-2 flex-wrap">
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
    </div>
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
  onCrosshatchChange: (v: boolean) => void
  onFrameChange: (v: boolean) => void
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
    onCrosshatchChange,
    onFrameChange,
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
}): JSX.Element {
  const label = lang === 'es' ? template.labelEs : template.labelEn
  const fields = template.fields.filter((f) => f.side === side)
  const anyActive = fields.some((f) => activeFieldIds.has(f.id))

  return (
    <section className="space-y-3 pt-4 border-t border-border/60" aria-label={strings.workspace.templateTitle(label)}>
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
  step,
  title,
  optional,
}: {
  step: number
  title: string
  optional?: boolean
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className="text-[11px] font-mono text-muted-foreground tabular-nums"
      >
        {String(step).padStart(2, '0')}
      </span>
      <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      {optional && (
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          optional
        </span>
      )}
    </div>
  )
}

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bookmark className="h-3.5 w-3.5" />
          <span>{strings.workspace.presetsLabel}</span>
        </div>
        {hasAny && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            {strings.workspace.presetsClearAll}
          </button>
        )}
      </div>
      {hasAny ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <PresetChip key={p.id} preset={p} onApply={onApply} onDelete={onDelete} strings={strings} />
          ))}
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-dashed transition-colors',
              canSave
                ? 'border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground'
                : 'border-border/40 text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            <Plus className="h-3 w-3" />
            {strings.workspace.presetsSave}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground/80 flex-1">
            {strings.workspace.presetsEmptyHint}
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-dashed transition-colors',
              canSave
                ? 'border-border hover:border-foreground/50 text-muted-foreground hover:text-foreground'
                : 'border-border/40 text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            <Plus className="h-3 w-3" />
            {strings.workspace.presetsSave}
          </button>
        </div>
      )}
    </div>
  )
}

function PresetChip({
  preset,
  onApply,
  onDelete,
  strings,
}: {
  preset: Preset
  onApply: (p: Preset) => void
  onDelete: (id: string) => void
  strings: Strings
}): JSX.Element {
  return (
    <span className="group inline-flex items-center rounded-full border border-border bg-muted/30 pl-2.5 pr-1 py-0.5">
      <button
        type="button"
        onClick={() => onApply(preset)}
        className="text-[11px] font-medium text-foreground hover:text-foreground"
        title={`${preset.recipient} · ${preset.purpose}`}
      >
        {preset.name}
      </button>
      <button
        type="button"
        onClick={() => onDelete(preset.id)}
        aria-label={strings.workspace.presetsDeleteOne}
        title={strings.workspace.presetsDeleteOne}
        className="ml-1 h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
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

function RedactStylePicker({
  value,
  onChange,
  strings,
}: {
  value: RedactionMode
  onChange: (m: RedactionMode) => void
  strings: Strings
}): JSX.Element {
  const labels: Record<RedactionMode, string> = {
    solid: strings.workspace.redactModeSolid,
    blur: strings.workspace.redactModeBlur,
    pixelate: strings.workspace.redactModePixelate,
  }
  return (
    <div className="space-y-1.5 pt-1">
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {strings.workspace.redactModeLabel}
      </span>
      <div
        role="radiogroup"
        aria-label={strings.workspace.redactModeLabel}
        className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted"
      >
        {REDACT_MODES.map((m) => {
          const selected = m === value
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(m)}
              className={cn(
                'h-7 text-xs font-medium rounded transition-colors',
                selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {labels[m]}
            </button>
          )
        })}
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

function TextSearchPanel({
  query,
  onQueryChange,
  searching,
  summary,
  onRun,
  onClear,
  strings,
}: {
  query: string
  onQueryChange: (v: string) => void
  searching: boolean
  summary: { matches: number; pages: number } | null
  onRun: () => void
  onClear: () => void
  strings: Strings
}): JSX.Element {
  const tooShort = query.trim().length > 0 && query.trim().length < 2
  return (
    <div className="pt-3 mt-2 border-t border-border/60 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{strings.workspace.searchTitle}</span>
      </div>
      <div className="flex gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !searching && !tooShort && query.trim()) {
              e.preventDefault()
              onRun()
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
          onClick={onRun}
          disabled={searching || tooShort || !query.trim()}
        >
          {searching ? strings.workspace.searchWorking : strings.workspace.searchRun}
        </Button>
      </div>
      {tooShort && (
        <p className="text-[11px] text-muted-foreground/80">{strings.workspace.searchTooShort}</p>
      )}
      {summary && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground font-mono">
            {summary.matches > 0
              ? strings.workspace.searchResults(summary.matches, summary.pages)
              : strings.workspace.searchNoResults}
          </span>
          {summary.matches > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              {strings.workspace.searchClear}
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/80">{strings.workspace.searchLimitationsPdfOnly}</p>
    </div>
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
