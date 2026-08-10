import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronDown,
  Download,
  Eraser,
  FileText,
  ImageIcon,
  Languages,
  Monitor,
  Moon,
  Plus,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { profileFor, type ProtectionLevel, type RedactionMode, type RedactionRect, type WatermarkText } from './core/types.ts'
import { releaseBase, type RenderedBase } from './core/preview/render.ts'
import { composite, drawOriginal } from './core/preview/composite.ts'
import type { DetectionResult, DocumentType } from './core/detect/types.ts'
import { UNKNOWN_DETECTION } from './core/detect/types.ts'
import { purposesFor, recommendedLevel } from './core/detect/templates.ts'
import { generateSeed } from './core/random/seed.ts'
import { Button } from './components/ui/button.tsx'
import { Input } from './components/ui/input.tsx'
import { Label } from './components/ui/label.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'
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

  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
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
  const [redactionsByPage, setRedactionsByPage] = useState<Map<number, RedactionRect[]>>(new Map())
  const [redactMode, setRedactMode] = useState(false)
  const [redactStyle, setRedactStyle] = useState<RedactionMode>('solid')
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
        },
      ),
    [level, debouncedRecipient, debouncedPurpose, lang, effectiveCustom, docSeed, crosshatchOverride, frameOverride],
  )

  const activePage = loaded?.base.pages[activePageIndex] ?? loaded?.base.pages[0]
  const activePageRedactions = redactionsByPage.get(activePageIndex) ?? []
  const totalRedactionsCount = useMemo(() => {
    let n = 0
    for (const arr of redactionsByPage.values()) n += arr.length
    return n
  }, [redactionsByPage])

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

  const onFiles = useCallback(
    async (list: FileList | null | undefined) => {
      const f = list?.[0]
      if (!f) return
      setError(null)
      clearOutput()
      const kind = detectKind(f)
      if (!kind) {
        setError(t.errors.unsupported)
        return
      }
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
        setRedactionsByPage(new Map())
        setRedactMode(false)
        setRedactStyle('solid')
        setCompareMode('protected')
        setDividerX(0.5)
        setCustomEnabled(false)
        setCustomText('')
        setLevelTouched(false)
        setLevel('recommended')
        setDocSeed(generateSeed())
        setAdvancedOpen(false)
        setCrosshatchOverride(null)
        setFrameOverride(null)

        // Run detection async; do not block the UI.
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
    [t, clearOutput],
  )

  const clearDoc = useCallback(() => {
    releaseBase(loaded?.base)
    setLoaded(null)
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
  }, [loaded, level, recipient, purpose, lang, customEnabled, customText, redactionsByPage, docSeed, crosshatchOverride, frameOverride, t, clearOutput])

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
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      }
    },
    [],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode || !loaded || compareMode !== 'protected') return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      dragStartRef.current = p
      setActiveRect({ id: 'active', x: p.x, y: p.y, w: 0, h: 0, mode: redactStyle })
    },
    [redactMode, loaded, canvasToNormalized, compareMode, redactStyle],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode || !dragStartRef.current) return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      const start = dragStartRef.current
      setActiveRect({
        id: 'active',
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
        mode: redactStyle,
      })
    },
    [redactMode, canvasToNormalized, redactStyle],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode) return
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      const rect = activeRect
      dragStartRef.current = null
      setActiveRect(null)
      if (!rect) return
      if (rect.w < MIN_RECT || rect.h < MIN_RECT) return
      const finalRect: RedactionRect = { ...rect, id: nextId(), mode: redactStyle }
      setRedactionsByPage((prev) => {
        const next = new Map(prev)
        const arr = next.get(activePageIndex) ?? []
        next.set(activePageIndex, [...arr, finalRect])
        return next
      })
    },
    [redactMode, activeRect, activePageIndex, redactStyle],
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
    <div className="min-h-screen flex flex-col">
      <Header lang={lang} onLangChange={setLang} theme={theme} onThemeChange={setTheme} strings={t} />

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pt-6 pb-16">
        {!loaded && !loading && (
          <HeroDrop
            dragActive={dragActive}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={() => setDragActive(false)}
            onFiles={onFiles}
            strings={t}
            error={error}
          />
        )}

        {loading && (
          <div className="flex items-center justify-center py-32">
            <div className="text-sm text-muted-foreground animate-pulse">
              {lang === 'es' ? 'Cargando documento…' : 'Loading document…'}
            </div>
          </div>
        )}

        {loaded && !loading && activePage && (
          <Workspace
            loaded={loaded}
            activePage={activePage}
            activePageIndex={activePageIndex}
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
            presets={presets}
            onApplyPreset={applyPreset}
            onSavePreset={onSaveCurrentPreset}
            onDeletePreset={removePreset}
            onClearAllPresets={onClearAllPresets}
            onDeleteAllLocalSettings={onDeleteAllLocalSettings}
            canSavePreset={!!recipient.trim() || !!purpose.trim()}
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
          />
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono tracking-tight">BlackLayer</span>
          <span>{t.footer.tagline}</span>
        </div>
      </footer>
    </div>
  )
}

// ---------- Header ----------

interface HeaderProps {
  lang: 'en' | 'es'
  onLangChange: (l: 'en' | 'es') => void
  theme: Theme
  onThemeChange: (t: Theme) => void
  strings: Strings
}

function Header({ lang, onLangChange, theme, onThemeChange, strings }: HeaderProps): JSX.Element {
  return (
    <header className="border-b border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">BlackLayer</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-2 py-0.5">
            <Shield className="h-3 w-3" />
            Local
          </span>
        </div>
        <div className="flex items-center gap-1">
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

// ---------- Hero drop ----------

interface HeroDropProps {
  dragActive: boolean
  onDrop: (e: React.DragEvent<HTMLElement>) => void
  onDragOver: (e: React.DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onFiles: (list: FileList | null | undefined) => void
  strings: Strings
  error: string | null
}

function HeroDrop({
  dragActive,
  onDrop,
  onDragOver,
  onDragLeave,
  onFiles,
  strings,
  error,
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
          className="sr-only"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      <p className="mt-6 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
        <Shield className="h-3 w-3" />
        {strings.hero.privacy}
      </p>

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------- Workspace ----------

interface WorkspaceProps {
  loaded: LoadedFile
  activePage: NonNullable<LoadedFile['base']['pages'][number]>
  activePageIndex: number
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
  presets: Preset[]
  onApplyPreset: (p: Preset) => void
  onSavePreset: () => void
  onDeletePreset: (id: string) => void
  onClearAllPresets: () => void
  onDeleteAllLocalSettings: () => void
  canSavePreset: boolean
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
}

function Workspace(props: WorkspaceProps): JSX.Element {
  const {
    loaded,
    activePageIndex,
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
    presets,
    onApplyPreset,
    onSavePreset,
    onDeletePreset,
    onClearAllPresets,
    onDeleteAllLocalSettings,
    canSavePreset,
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <ComparePicker
              value={compareMode}
              onChange={onCompareModeChange}
              strings={strings}
            />
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
              {isMultiPage
                ? strings.workspace.pageStripCurrent(activePageIndex + 1, loaded.base.totalPages)
                : ''}
            </span>
          </div>

          <div className="relative w-full aspect-[3/4] sm:aspect-auto sm:min-h-[520px] bg-white rounded-lg overflow-hidden shadow-sm">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={cn(
                'absolute inset-0 w-full h-full object-contain touch-none select-none',
                redactMode && compareMode === 'protected' ? 'cursor-crosshair' : '',
              )}
              style={{
                visibility: compareMode === 'original' ? 'hidden' : 'visible',
              }}
            />
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
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{strings.workspace.protectionTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{strings.workspace.protectionHelper}</p>
        </div>

        <PresetBar
          presets={presets}
          onApply={onApplyPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
          onClearAll={onClearAllPresets}
          canSave={canSavePreset}
          strings={strings}
        />

        <div className="space-y-4">
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
                        'text-[11px] px-2 py-1 rounded-full border transition-colors',
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
        </div>

        <div className="space-y-2">
          <Label>{strings.workspace.levelHeading}</Label>
          <LevelPicker level={level} onChange={onLevelChange} strings={strings} />
          <p className="text-xs text-muted-foreground pt-0.5">
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
              className="mt-2 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover:border-foreground/40 hover:bg-muted/50 text-left transition-colors"
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
        </div>

        {/* Redaction */}
        <div className="space-y-2 pt-1 border-t border-border/60">
          <div className="flex items-center justify-between pt-3">
            <Label>{strings.workspace.redactSectionTitle}</Label>
            {redactionsCount > 0 && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {strings.workspace.redactCount(redactionsCount)}
              </span>
            )}
          </div>
          <div className="flex gap-2">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={onUndoRedaction}
              disabled={activePageRedactionsCount === 0}
              aria-label={strings.workspace.redactUndo}
              title={strings.workspace.redactUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
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
          <RedactStylePicker
            value={redactStyle}
            onChange={onRedactStyleChange}
            strings={strings}
          />
          {redactStyle !== 'solid' && (
            <p className="text-[11px] text-muted-foreground/80">
              {strings.workspace.redactModeHint}
            </p>
          )}
          {isMultiPage && (
            <p className="text-[11px] text-muted-foreground/80 font-mono">
              {strings.workspace.redactPdfLimitation}
            </p>
          )}
        </div>

        {/* Advanced */}
        <div className="space-y-2 pt-1 border-t border-border/60">
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="pt-3 flex items-center justify-between w-full text-left"
            aria-expanded={advancedOpen}
          >
            <Label className="cursor-pointer">{strings.workspace.advancedTitle}</Label>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                advancedOpen ? 'rotate-180' : '',
              )}
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
              <div className="pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={onDeleteAllLocalSettings}
                  className="mt-2 w-full flex items-center gap-2 text-left text-xs text-destructive hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{strings.workspace.deleteLocalSettings}</span>
                </button>
                <p className="mt-1 text-[11px] text-muted-foreground pl-5">
                  {strings.workspace.deleteLocalSettingsHint}
                </p>
              </div>
            </div>
          )}
        </div>

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
            <a
              href={outputUrl}
              download={outputName}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 h-10 px-4',
                'rounded-md bg-primary text-primary-foreground text-sm font-medium',
                'hover:bg-primary/90 transition-colors',
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
  const pages = loaded.base.pages
  const total = loaded.base.totalPages
  const rendered = loaded.base.renderedPageCount
  const showCappedNote = rendered < total

  return (
    <div className="mt-3 space-y-2">
      <div
        role="listbox"
        aria-label={strings.workspace.pageStripLabel}
        className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1"
      >
        {pages.map((p) => {
          const rects = redactionsByPage.get(p.index) ?? []
          return (
            <PageThumb
              key={p.index}
              page={p}
              selected={p.index === activePageIndex}
              redactionCount={rects.length}
              onSelect={() => onSelectPage(p.index)}
            />
          )
        })}
      </div>
      {showCappedNote && (
        <p className="text-[11px] font-mono text-muted-foreground text-center">
          {strings.workspace.pageStripCapped(rendered, total)}
        </p>
      )}
    </div>
  )
}

function PageThumb({
  page,
  selected,
  redactionCount,
  onSelect,
}: {
  page: LoadedFile['base']['pages'][number]
  selected: boolean
  redactionCount: number
  onSelect: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = page.thumbnail.width
    c.height = page.thumbnail.height
    const ctx = c.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(page.thumbnail, 0, 0)
  }, [page.thumbnail])

  const aspect = page.thumbnail.width / page.thumbnail.height
  const heightPx = 96
  const widthPx = Math.max(48, Math.round(heightPx * aspect))

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'relative shrink-0 rounded-md overflow-hidden border-2 transition-colors bg-white',
        selected ? 'border-foreground' : 'border-border hover:border-foreground/40',
      )}
      style={{ width: widthPx, height: heightPx }}
      title={`Page ${page.index + 1}`}
    >
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
      <span
        className={cn(
          'absolute bottom-0.5 left-0.5 text-[10px] font-mono px-1 rounded',
          selected ? 'bg-foreground text-background' : 'bg-black/60 text-white',
        )}
      >
        {page.index + 1}
      </span>
      {redactionCount > 0 && (
        <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-foreground border border-background" />
      )}
    </button>
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
