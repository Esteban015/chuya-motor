// @vitest-environment jsdom
/**
 * report-share.test.tsx — Incremento 7G: "Compartir informe" (Web Share API, files) and the parts
 * report actions. navigator.share / canShare are simulated; fetch must never be called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import { buildPartsReport, partsReadiness, type PrivacyOptions } from '@/domain/report/chuya-report'
import { PARTS_LINES, PRICING_WITH_OFFERS } from '@/domain/report/__fixtures__/report-fixtures'
import { pdfText } from '@/domain/report/__fixtures__/pdf-inspect'
import type { ResearchLine } from '@/domain/budget/research/types'
import { ReportExport } from './report-export'

const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', source: 'catalog' as const }
const PHONE_LINES: ResearchLine[] = [{ ...PARTS_LINES[0]!, description: 'Aceite motor, avisar al cel 11-2345-6789' }, ...PARTS_LINES.slice(1)]

let fetchSpy: ReturnType<typeof vi.fn>
let shareSpy: ReturnType<typeof vi.fn>
let downloads: string[] = []

function setShareApi(opts: { canShareFiles: boolean; share?: (data: ShareData) => Promise<void> } | null) {
  if (!opts) {
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
    return
  }
  shareSpy = vi.fn(opts.share ?? (async () => undefined))
  Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true, writable: true })
  Object.defineProperty(navigator, 'canShare', { value: vi.fn((d: ShareData) => opts.canShareFiles && Array.isArray(d.files)), configurable: true, writable: true })
}

beforeEach(() => {
  downloads = []
  fetchSpy = vi.fn(async () => {
    throw new Error('network is forbidden during export')
  })
  vi.stubGlobal('fetch', fetchSpy)
  URL.createObjectURL = vi.fn(() => 'blob:test') as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})
afterEach(() => {
  cleanup()
  setShareApi(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderParts(lines: ResearchLine[] = PARTS_LINES) {
  return render(
    <ReportExport
      readiness={partsReadiness({ lines })}
      freeTexts={lines.map((l) => l.description)}
      build={(privacy: PrivacyOptions, generatedAt: Date) => buildPartsReport({ lines, vehicle, pricing: PRICING_WITH_OFFERS, autoPricingEnabled: true, generatedAt, privacy })}
    />,
  )
}

async function fileText(file: File): Promise<string> {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
  const bytes = new Uint8Array(buf)
  await PDFDocument.load(bytes) // valid PDF
  return pdfText(bytes)
}

const shareButton = () => screen.getByRole('button', { name: 'Compartir informe' })
const status = () => screen.getByTestId('report-export-status').textContent ?? ''
/** The PDF is prepared ahead (debounced) on share-capable devices: wait for the ready signal. */
const prepared = () => waitFor(() => expect(shareButton().getAttribute('data-ready')).toBe('true'), { timeout: 10_000 })
const idle = () => new Promise((r) => setTimeout(r, 900))

describe('RS-01 share supported (files)', { timeout: 20_000 }, () => {
  it('shares the same PDF synchronously from the click; generic text; no network', async () => {
    setShareApi({ canShareFiles: true })
    renderParts()
    expect(screen.getByTestId('report-share-note').textContent).toContain('bajo sus propias condiciones')
    await prepared()
    fireEvent.click(shareButton())
    // Called inside the click handler (user activation kept), before any await.
    expect(shareSpy).toHaveBeenCalledTimes(1)
    const data = shareSpy.mock.calls[0]![0] as ShareData
    expect(data.files).toHaveLength(1)
    const file = data.files![0]!
    expect(file.type).toBe('application/pdf')
    expect(file.name).toMatch(/^chuya-informe-repuestos-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(data.title).toBe('Informe de consulta de repuestos')
    expect(data.text).toBe('Informe de Chuya Motor para el taller (PDF).')
    expect(data).not.toHaveProperty('url')
    await waitFor(() => expect(status()).toContain('Informe compartido'))
    const text = await fileText(file)
    for (const s of ['Informe de consulta de repuestos', 'Compatibilidad no verificada', 'Precio publicado: $ 32.700,50']) expect(text).toContain(s)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('click before the PDF is ready: prepares it, asks to tap again, then shares', async () => {
    setShareApi({ canShareFiles: true })
    renderParts()
    fireEvent.click(shareButton())
    expect(shareSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toContain('Tocá «Compartir informe» de nuevo'))
    fireEvent.click(shareButton())
    expect(shareSpy).toHaveBeenCalledTimes(1)
  })

  it('user cancels → neutral message (not an error); can share again', async () => {
    setShareApi({ canShareFiles: true, share: async () => { throw new DOMException('cancelled', 'AbortError') } })
    renderParts()
    await prepared()
    fireEvent.click(shareButton())
    await waitFor(() => expect(status()).toContain('No se compartió el informe'))
    expect(screen.getByTestId('report-export-status').querySelector('.text-red-700')).toBeNull()
    expect(shareButton().hasAttribute('disabled')).toBe(false)
  })

  it('share failure → recoverable error pointing to the download; lost activation → tap again', async () => {
    setShareApi({ canShareFiles: true, share: async () => { throw new DOMException('boom', 'DataError') } })
    renderParts()
    await prepared()
    fireEvent.click(shareButton())
    await waitFor(() => expect(status()).toContain('No pudimos compartir el informe. Descargalo'))
    cleanup()
    setShareApi({ canShareFiles: true, share: async () => { throw new DOMException('no activation', 'NotAllowedError') } })
    renderParts()
    await prepared()
    fireEvent.click(shareButton())
    await waitFor(() => expect(status()).toContain('de nuevo'))
  })

  it('privacy options apply to the shared file (redacted by default, included only if chosen)', async () => {
    setShareApi({ canShareFiles: true })
    renderParts(PHONE_LINES)
    await prepared()
    fireEvent.click(shareButton())
    expect(await fileText((shareSpy.mock.calls[0]![0] as ShareData).files![0]!)).not.toContain('2345-6789')
    fireEvent.click(screen.getByRole('button', { name: /Vista previa y privacidad/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Omitir datos personales/ }))
    await prepared()
    fireEvent.click(shareButton())
    expect(shareSpy).toHaveBeenCalledTimes(2)
    expect(await fileText((shareSpy.mock.calls[1]![0] as ShareData).files![0]!)).toContain('11-2345-6789')
  })
})

describe('RS-01b a failing report build never breaks the page', () => {
  it('share-capable device: the panel renders, share and download report recoverable errors', async () => {
    setShareApi({ canShareFiles: true })
    render(<ReportExport readiness={{ ok: true }} freeTexts={[]} build={() => { throw new Error('boom') }} />)
    await act(idle)
    fireEvent.click(shareButton())
    expect(shareSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toContain('No pudimos compartir el informe'))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar informe PDF' }))
    await waitFor(() => expect(status()).toContain('No pudimos generar el PDF'))
  })
})

describe('RS-02 share not supported', () => {
  it.each([
    ['no Web Share API', null],
    ['Web Share without files', { canShareFiles: false }],
  ] as const)('%s → no share button, short explanation, download works', async (_n, api) => {
    setShareApi(api)
    renderParts()
    expect(screen.queryByRole('button', { name: 'Compartir informe' })).toBeNull()
    expect(screen.getByTestId('report-share-unsupported').textContent).toContain('Descargá el PDF y compartilo')
    fireEvent.click(screen.getByRole('button', { name: 'Descargar informe PDF' }))
    await waitFor(() => expect(status()).toContain('Descarga lista: chuya-informe-repuestos-'))
    expect(downloads).toHaveLength(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('RS-03 parts report actions', () => {
  it('insufficient (no parts): actions disabled, no share button, no unsupported note', () => {
    setShareApi({ canShareFiles: true })
    renderParts([PARTS_LINES[4]!])
    expect(screen.getByRole('button', { name: 'Descargar informe PDF' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Compartir informe' })).toBeNull()
    expect(screen.queryByTestId('report-share-unsupported')).toBeNull()
    expect(status()).toContain('información suficiente')
  })
  it('print renders the parts report only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const print = vi.fn()
    window.print = print
    renderParts()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir informe' }))
    const root = await screen.findByTestId('report-print-root')
    expect(root.textContent).toContain('Informe de consulta de repuestos')
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(print).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
