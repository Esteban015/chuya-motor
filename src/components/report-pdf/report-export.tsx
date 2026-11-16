'use client'

/**
 * report-export.tsx — "Chuya Informe" actions (Incremento 7F): download the consultation as a PDF
 * or print it, from the data already on the page.
 *
 * - Generated on the device (pdf-lib, loaded only on first use): no request to our server, the
 *   AI, SerpApi or any other service; nothing is stored; no account needed. Repeated downloads
 *   just render again locally.
 * - Privacy: personal data detected in free text (phone, e-mail, plate, VIN, ID, name, address)
 *   is omitted by default; the preview shows what will be exported and lets the person include
 *   their original text or not.
 * - States: preparing, ready, error, and "not enough information" (button disabled with the
 *   reason). Safety-blocked consultations have no report.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_PRIVACY, detectedPersonalData, type ChuyaReport, type PrivacyOptions, type Readiness } from '@/domain/report/chuya-report'
import { PERSONAL_DATA_LABEL } from '@/domain/report/personal-data'
import { ReportPreview } from './report-preview'

type Status = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'ready'; fileName: string } | { kind: 'error' }

const PRINT_ROOT_ID = 'chuya-print-root'
const PRINTING_CLASS = 'chuya-printing'

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: some mobile browsers read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function ReportExport({
  build,
  readiness,
  freeTexts,
}: {
  /** Builds the report model from the page's data (pure, no network). */
  build: (privacy: PrivacyOptions, generatedAt: Date) => ChuyaReport
  readiness: Readiness
  /** The person's free text that would be exported (for the personal data notice). */
  freeTexts: ReadonlyArray<string | null | undefined>
}) {
  const uid = useId()
  const [privacy, setPrivacy] = useState<PrivacyOptions>(DEFAULT_PRIVACY)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [printReport, setPrintReport] = useState<ChuyaReport | null>(null)
  const busy = useRef(false)
  const detected = useMemo(() => detectedPersonalData(freeTexts), [freeTexts])
  const preview = useMemo(() => (previewOpen ? build(privacy, new Date()) : null), [previewOpen, build, privacy])

  // Print: render the report into a body-level root, print it, then clean up.
  useEffect(() => {
    if (!printReport) return
    const html = document.documentElement
    const done = () => {
      html.classList.remove(PRINTING_CLASS)
      setPrintReport(null)
    }
    html.classList.add(PRINTING_CLASS)
    window.addEventListener('afterprint', done, { once: true })
    const t = window.setTimeout(() => {
      try {
        window.print()
      } catch {
        done()
      }
    }, 50)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', done)
      html.classList.remove(PRINTING_CLASS)
    }
  }, [printReport])

  if (readiness.ok === false && readiness.reason === 'safety_blocked') return null
  const insufficient = readiness.ok === false

  async function download() {
    if (busy.current || insufficient) return
    busy.current = true
    setStatus({ kind: 'preparing' })
    try {
      const report = build(privacy, new Date())
      const { renderReportPdf } = await import('@/domain/report/pdf-renderer')
      const { bytes } = await renderReportPdf(report)
      triggerDownload(bytes, report.fileName)
      setStatus({ kind: 'ready', fileName: report.fileName })
    } catch {
      setStatus({ kind: 'error' })
    } finally {
      busy.current = false
    }
  }

  function print() {
    if (insufficient) return
    setPrintReport(build(privacy, new Date()))
  }

  const btn =
    'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-2xl border border-brand-border-light bg-white p-4 shadow-brand-xs sm:p-5" data-testid="report-export">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="font-display text-base font-extrabold text-brand-text">Chuya Informe para el taller</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-brand-text-muted">
            Descargá este resultado en PDF (A4) para llevarlo o enviarlo a tu taller. Se genera en tu dispositivo: no se envía a ningún servidor.
          </p>
        </div>
        <div className="flex flex-col gap-2 min-[400px]:flex-row sm:flex-shrink-0">
          <button type="button" onClick={download} disabled={insufficient || status.kind === 'preparing'} aria-describedby={`${uid}-status`} className={`${btn} bg-brand-primary text-white hover:bg-brand-primary-light`}>
            {status.kind === 'preparing' ? 'Preparando PDF…' : 'Descargar informe PDF'}
          </button>
          <button type="button" onClick={print} disabled={insufficient} className={`${btn} border border-brand-border bg-white text-brand-text hover:bg-brand-bg`}>
            Imprimir informe
          </button>
        </div>
      </div>

      <div id={`${uid}-status`} role="status" aria-live="polite" className="mt-2 text-xs" data-testid="report-export-status">
        {insufficient && <span className="text-brand-text-muted">Todavía no hay información suficiente para armar un informe.</span>}
        {status.kind === 'preparing' && <span className="text-brand-text-muted">Preparando PDF…</span>}
        {status.kind === 'ready' && <span className="text-brand-primary">Descarga lista: {status.fileName}. Podés descargarlo de nuevo cuando quieras.</span>}
        {status.kind === 'error' && <span className="text-red-700">No pudimos generar el PDF. Probá de nuevo o usá «Imprimir informe».</span>}
      </div>

      {!insufficient && detected.length > 0 && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="report-personal-data">
          {privacy.redactPersonalData
            ? `Encontramos posibles datos personales en tu texto (${detected.map((k) => PERSONAL_DATA_LABEL[k]).join(', ')}) y los omitimos del informe.`
            : `Tu informe incluirá posibles datos personales (${detected.map((k) => PERSONAL_DATA_LABEL[k]).join(', ')}).`}{' '}
          Revisalo en la vista previa.
        </p>
      )}

      {!insufficient && (
        <div className="mt-3 border-t border-brand-border-light pt-3">
          <button
            type="button"
            aria-expanded={previewOpen}
            aria-controls={`${uid}-preview`}
            onClick={() => setPreviewOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <span aria-hidden="true" className={`inline-block transition-transform ${previewOpen ? 'rotate-90' : ''}`}>›</span>
            Vista previa y privacidad
          </button>
          <div id={`${uid}-preview`} hidden={!previewOpen} className="mt-2 space-y-3">
            <fieldset className="space-y-2 rounded-xl bg-brand-bg p-3">
              <legend className="sr-only">Opciones de privacidad del informe</legend>
              <label className="flex min-h-[44px] items-start gap-2 text-sm text-brand-text">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={privacy.redactPersonalData} onChange={(e) => setPrivacy((p) => ({ ...p, redactPersonalData: e.target.checked }))} />
                <span>Omitir datos personales detectados (teléfono, correo, patente, chasis, DNI, nombre o dirección)</span>
              </label>
              <label className="flex min-h-[44px] items-start gap-2 text-sm text-brand-text">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={privacy.includeOriginalText} onChange={(e) => setPrivacy((p) => ({ ...p, includeOriginalText: e.target.checked }))} />
                <span>Incluir mi texto original</span>
              </label>
              <p className="text-xs text-brand-text-muted">La detección es automática y puede no encontrar todo: revisá la vista previa antes de compartir el informe.</p>
            </fieldset>
            {preview && (
              <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-brand-border-light p-3 sm:p-5" tabIndex={0} aria-label="Vista previa del informe">
                <ReportPreview report={preview} />
              </div>
            )}
          </div>
        </div>
      )}

      {printReport &&
        createPortal(
          <div id={PRINT_ROOT_ID} data-testid="report-print-root">
            <ReportPreview report={printReport} headingLevel={2} />
          </div>,
          document.body,
        )}
    </section>
  )
}
