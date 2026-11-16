/**
 * pdf-renderer.ts — Renders a ChuyaReport (chuya-report.ts) to an A4 PDF with pdf-lib, entirely on
 * the device (Incremento 7F). No network, no server, no persistence, no cost per document.
 *
 * - Vector text (sharp at any zoom, selectable and searchable), never a screenshot.
 * - Standard PDF fonts (Helvetica / Courier, WinAnsi): every Spanish character (á é í ó ú ü ñ ¿ ¡
 *   º ª €) is supported; characters outside the font are replaced, never dropped silently into an
 *   invalid file.
 * - Word wrapping, page breaks (headings never orphaned, tables repeat their header, boxes kept
 *   together), running header and "Página X de Y" footer.
 * - URLs are printed in full (useful on paper) and are clickable link annotations.
 * - Document metadata is generic: no personal data in the title, author or keywords.
 *
 * Returns the bytes and a plain-text trace of what was drawn on each page (for tests and the
 * accessibility of the preview, which renders the same model as HTML).
 */
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { PROVENANCE_LABEL, type ChuyaReport, type ReportBlock, type ReportSection } from './chuya-report'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 50
const MARGIN_TOP = 58
const MARGIN_BOTTOM = 62
const CONTENT_W = PAGE_W - MARGIN_X * 2

const C = {
  text: rgb(0.11, 0.13, 0.15),
  muted: rgb(0.33, 0.37, 0.4),
  light: rgb(0.55, 0.58, 0.6),
  primary: rgb(16 / 255, 59 / 255, 59 / 255),
  tint: rgb(234 / 255, 244 / 255, 244 / 255),
  rule: rgb(0.85, 0.88, 0.88),
  pre: rgb(0.96, 0.97, 0.97),
  link: rgb(0.05, 0.33, 0.62),
  critical: { fill: rgb(253 / 255, 236 / 255, 236 / 255), bar: rgb(180 / 255, 35 / 255, 24 / 255), text: rgb(122 / 255, 24 / 255, 16 / 255) },
  high: { fill: rgb(255 / 255, 244 / 255, 229 / 255), bar: rgb(181 / 255, 71 / 255, 8 / 255), text: rgb(122 / 255, 46 / 255, 6 / 255) },
  info: { fill: rgb(234 / 255, 244 / 255, 244 / 255), bar: rgb(16 / 255, 59 / 255, 59 / 255), text: rgb(16 / 255, 59 / 255, 59 / 255) },
  badge: { fill: rgb(255 / 255, 247 / 255, 230 / 255), text: rgb(122 / 255, 70 / 255, 0) },
}

/** Common characters outside WinAnsi, mapped to readable equivalents. */
const REPLACEMENTS: Record<string, string> = {
  '→': '->', '←': '<-', '⇒': '=>', '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '−': '-', '‐': '-', '‑': '-', '‒': '-',
  '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '★': '*', '☆': '*', '⚠': '!', ' ': ' ', ' ': ' ', ' ': ' ', '\t': '    ',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '¹': '1', '²': '2', '³': '3',
}

export interface RenderTrace {
  pages: string[][]
  links: Array<{ page: number; url: string }>
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  mono: PDFFont
}

class Writer {
  pages: PDFPage[] = []
  trace: RenderTrace = { pages: [], links: [] }
  page!: PDFPage
  y = 0
  private charsets = new Map<PDFFont, Set<number>>()

  constructor(
    private doc: PDFDocument,
    readonly f: Fonts,
    private runningTitle: string,
  ) {}

  /** Text the font can encode: NFC, known replacements, anything else → "?". */
  safe(text: string, font: PDFFont): string {
    let set = this.charsets.get(font)
    if (!set) {
      set = new Set(font.getCharacterSet())
      this.charsets.set(font, set)
    }
    let out = ''
    for (const ch of text.normalize('NFC')) {
      const cp = ch.codePointAt(0)!
      if (ch === '\n') out += ch
      else if (set.has(cp)) out += ch
      else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch]
      else if (cp < 32) out += ' '
      else if (/\p{Extended_Pictographic}|\p{M}/u.test(ch) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) continue
      else {
        const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
        out += base && [...base].every((c) => set!.has(c.codePointAt(0)!)) ? base : '?'
      }
    }
    return out
  }

  width(text: string, font: PDFFont, size: number): number {
    return font.widthOfTextAtSize(text, size)
  }

  /** Word wrap; words longer than the width are broken by characters. Keeps explicit newlines. */
  wrap(text: string, font: PDFFont, size: number, maxWidth: number, opts: { breakAnywhere?: boolean } = {}): string[] {
    const out: string[] = []
    for (const para of this.safe(text, font).split('\n')) {
      if (opts.breakAnywhere) {
        let line = ''
        for (const ch of para) {
          if (line && this.width(line + ch, font, size) > maxWidth) {
            out.push(line)
            line = ''
          }
          line += ch
        }
        out.push(line)
        continue
      }
      const words = para.split(/ +/)
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (this.width(candidate, font, size) <= maxWidth) {
          line = candidate
          continue
        }
        if (line) out.push(line)
        if (this.width(word, font, size) <= maxWidth) {
          line = word
          continue
        }
        let chunk = ''
        for (const ch of word) {
          if (chunk && this.width(chunk + ch, font, size) > maxWidth) {
            out.push(chunk)
            chunk = ''
          }
          chunk += ch
        }
        line = chunk
      }
      out.push(line)
    }
    return out
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.pages.push(this.page)
    this.trace.pages.push([])
    this.y = PAGE_H - MARGIN_TOP
    if (this.pages.length > 1) {
      this.draw(this.runningTitle, MARGIN_X, PAGE_H - 34, this.f.regular, 8, C.light)
      this.page.drawLine({ start: { x: MARGIN_X, y: PAGE_H - 40 }, end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 40 }, thickness: 0.5, color: C.rule })
    }
  }

  get available(): number {
    return this.y - MARGIN_BOTTOM
  }

  ensure(height: number) {
    if (height > this.available) this.newPage()
  }

  /** Draws one already-wrapped line (sanitized) and records it in the trace. */
  draw(text: string, x: number, y: number, font: PDFFont, size: number, color: RGB) {
    const s = this.safe(text, font).replace(/\n/g, ' ')
    if (!s) return
    this.page.drawText(s, { x, y, font, size, color })
    this.trace.pages[this.pages.length - 1]!.push(s)
  }

  link(url: string, x: number, y: number, w: number, h: number) {
    const ctx = this.doc.context
    const annot = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }),
    )
    this.page.node.addAnnot(annot)
    this.trace.links.push({ page: this.pages.length, url })
  }

  /** Flowing wrapped text; each line checks for a page break. */
  text(text: string, opts: { font?: PDFFont; size?: number; color?: RGB; x?: number; width?: number; leading?: number; breakAnywhere?: boolean; url?: string } = {}) {
    const font = opts.font ?? this.f.regular
    const size = opts.size ?? 10
    const x = opts.x ?? MARGIN_X
    const width = opts.width ?? CONTENT_W - (x - MARGIN_X)
    const leading = opts.leading ?? size * 1.4
    for (const line of this.wrap(text, font, size, width, { breakAnywhere: opts.breakAnywhere })) {
      this.ensure(leading)
      this.y -= leading
      this.draw(line, x, this.y + leading * 0.28, font, size, opts.color ?? C.text)
      if (opts.url && line) {
        const w = this.width(this.safe(line, font), font, size)
        this.page.drawLine({ start: { x, y: this.y + leading * 0.2 }, end: { x: x + w, y: this.y + leading * 0.2 }, thickness: 0.4, color: C.link })
        this.link(opts.url, x, this.y + leading * 0.1, w, leading * 0.85)
      }
    }
  }

  gap(h: number) {
    this.y -= Math.min(h, Math.max(0, this.available))
  }
}

// ── Blocks ─────────────────────────────────────────────────────────────────

function drawAlert(w: Writer, b: Extract<ReportBlock, { kind: 'alert' }>) {
  const palette = C[b.level]
  const innerW = CONTENT_W - 26
  const title = w.wrap(b.title, w.f.bold, 11, innerW)
  const body = b.lines.flatMap((l) => w.wrap(l, w.f.regular, 10, innerW))
  const h = 12 + title.length * 15 + body.length * 14 + 10
  if (h > PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) {
    w.text(b.title, { font: w.f.bold, size: 11, color: palette.text })
    for (const l of b.lines) w.text(l, { color: palette.text })
    return
  }
  w.ensure(h)
  const top = w.y
  w.page.drawRectangle({ x: MARGIN_X, y: top - h, width: CONTENT_W, height: h, color: palette.fill })
  w.page.drawRectangle({ x: MARGIN_X, y: top - h, width: 4, height: h, color: palette.bar })
  let y = top - 12
  for (const l of title) {
    y -= 13
    w.draw(l, MARGIN_X + 16, y, w.f.bold, 11, palette.text)
    y -= 2
  }
  for (const l of body) {
    y -= 14
    w.draw(l, MARGIN_X + 16, y + 3, w.f.regular, 10, palette.text)
  }
  w.y = top - h
}

function drawKeyValues(w: Writer, rows: Array<[string, string]>) {
  const labelW = 140
  for (const [k, v] of rows) {
    const labels = w.wrap(k, w.f.bold, 9.5, labelW - 8)
    const values = w.wrap(v, w.f.regular, 10, CONTENT_W - labelW)
    const lines = Math.max(labels.length, values.length)
    const h = lines * 14 + 2
    w.ensure(h)
    const top = w.y
    labels.forEach((l, i) => w.draw(l, MARGIN_X, top - 14 * (i + 1) + 4, w.f.bold, 9.5, C.muted))
    values.forEach((l, i) => w.draw(l, MARGIN_X + labelW, top - 14 * (i + 1) + 4, w.f.regular, 10, C.text))
    w.y = top - h
  }
}

function drawList(w: Writer, items: string[], ordered: boolean) {
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}.` : '•'
    const lines = w.wrap(item, w.f.regular, 10, CONTENT_W - 18)
    lines.forEach((l, li) => {
      w.ensure(14)
      w.y -= 14
      if (li === 0) w.draw(marker, MARGIN_X + 2, w.y + 4, ordered ? w.f.bold : w.f.regular, 10, C.primary)
      w.draw(l, MARGIN_X + 18, w.y + 4, w.f.regular, 10, C.text)
    })
    w.y -= 2
  })
}

function drawTable(w: Writer, b: Extract<ReportBlock, { kind: 'table' }>) {
  const widths = b.widths.map((f) => f * CONTENT_W)
  const pad = 4
  const header = () => {
    const cells = b.columns.map((c, i) => w.wrap(c, w.f.bold, 9, widths[i]! - pad * 2))
    const h = Math.max(...cells.map((c) => c.length)) * 12 + pad * 2
    w.ensure(h + 16)
    const top = w.y
    w.page.drawRectangle({ x: MARGIN_X, y: top - h, width: CONTENT_W, height: h, color: C.tint })
    let x = MARGIN_X
    cells.forEach((lines, i) => {
      lines.forEach((l, li) => {
        const tw = w.width(w.safe(l, w.f.bold), w.f.bold, 9)
        const lx = b.align?.[i] === 'right' ? x + widths[i]! - pad - tw : x + pad
        w.draw(l, lx, top - pad - 12 * (li + 1) + 3, w.f.bold, 9, C.primary)
      })
      x += widths[i]!
    })
    w.y = top - h
  }
  header()
  for (const row of b.rows) {
    const cells = row.map((c, i) => w.wrap(c, w.f.regular, 9.5, widths[i]! - pad * 2))
    const h = Math.max(...cells.map((c) => c.length)) * 13 + pad * 2
    if (h > w.available) {
      w.newPage()
      header()
    }
    const top = w.y
    let x = MARGIN_X
    cells.forEach((lines, i) => {
      lines.forEach((l, li) => {
        const tw = w.width(w.safe(l, w.f.regular), w.f.regular, 9.5)
        const lx = b.align?.[i] === 'right' ? x + widths[i]! - pad - tw : x + pad
        w.draw(l, lx, top - pad - 13 * (li + 1) + 3.5, w.f.regular, 9.5, C.text)
      })
      x += widths[i]!
    })
    w.y = top - h
    w.page.drawLine({ start: { x: MARGIN_X, y: w.y }, end: { x: MARGIN_X + CONTENT_W, y: w.y }, thickness: 0.4, color: C.rule })
  }
}

function drawPreformatted(w: Writer, text: string) {
  const lines = w.wrap(text, w.f.mono, 9, CONTENT_W - 16, { breakAnywhere: true })
  for (const l of lines) {
    w.ensure(12.5)
    w.page.drawRectangle({ x: MARGIN_X, y: w.y - 12.5, width: CONTENT_W, height: 12.5, color: C.pre })
    w.y -= 12.5
    w.draw(l, MARGIN_X + 8, w.y + 3.5, w.f.mono, 9, C.text)
  }
}

function badgeRows(w: Writer, badges: string[]): string[][] {
  const rows: string[][] = [[]]
  let x = 0
  for (const b of badges) {
    const bw = w.width(w.safe(b, w.f.bold), w.f.bold, 7.5) + 10
    if (x + bw > CONTENT_W - 12 && rows[rows.length - 1]!.length) {
      rows.push([])
      x = 0
    }
    rows[rows.length - 1]!.push(b)
    x += bw + 4
  }
  return badges.length ? rows : []
}

function drawEntry(w: Writer, b: Extract<ReportBlock, { kind: 'entry' }>) {
  const innerX = MARGIN_X + 10
  const innerW = CONTENT_W - 12
  const title = w.wrap(b.title, w.f.bold, 10.5, innerW)
  const badges = badgeRows(w, b.badges)
  const lines = b.lines.flatMap((l) => w.wrap(l, w.f.regular, 9.5, innerW))
  const linkLines = b.link ? w.wrap(b.link.url, w.f.regular, 8.5, innerW - 0, { breakAnywhere: true }) : []
  const h = title.length * 14 + badges.length * 14 + lines.length * 13 + (b.link ? 13 + linkLines.length * 11 : 0) + 8
  // Keep an entry on one page when it fits on one page.
  if (h <= PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) w.ensure(h)
  const top = w.y
  const startPage = w.pages.length
  for (const l of title) {
    w.ensure(14)
    w.y -= 14
    w.draw(l, innerX, w.y + 3.5, w.f.bold, 10.5, C.text)
  }
  for (const row of badges) {
    w.ensure(14)
    w.y -= 14
    let x = innerX
    for (const label of row) {
      const s = w.safe(label, w.f.bold)
      const bw = w.width(s, w.f.bold, 7.5) + 10
      w.page.drawRectangle({ x, y: w.y + 1, width: bw, height: 11, color: C.badge.fill, borderColor: C.badge.text, borderWidth: 0.4 })
      w.draw(s, x + 5, w.y + 4, w.f.bold, 7.5, C.badge.text)
      x += bw + 4
    }
  }
  for (const l of lines) {
    w.ensure(13)
    w.y -= 13
    w.draw(l, innerX, w.y + 3.5, w.f.regular, 9.5, C.muted)
  }
  if (b.link) {
    w.ensure(13)
    w.y -= 13
    w.draw(`${b.link.label}:`, innerX, w.y + 3.5, w.f.bold, 9, C.text)
    w.text(b.link.url, { x: innerX, width: innerW, size: 8.5, leading: 11, color: C.link, breakAnywhere: true, url: b.link.url })
  }
  // Left rule (only for the part on the current page).
  const from = w.pages.length === startPage ? top : PAGE_H - MARGIN_TOP
  w.page.drawLine({ start: { x: MARGIN_X + 2, y: from - 2 }, end: { x: MARGIN_X + 2, y: w.y }, thickness: 1.5, color: C.rule })
  w.y -= 8
}

function drawBlock(w: Writer, b: ReportBlock) {
  switch (b.kind) {
    case 'paragraph':
      w.text(b.text, {
        font: b.tone === 'strong' ? w.f.bold : b.tone === 'muted' ? w.f.italic : w.f.regular,
        color: b.tone === 'muted' ? C.muted : C.text,
        size: b.tone === 'muted' ? 9.5 : 10,
      })
      w.gap(4)
      return
    case 'alert':
      drawAlert(w, b)
      w.gap(6)
      return
    case 'keyValues':
      drawKeyValues(w, b.rows)
      w.gap(4)
      return
    case 'list':
      drawList(w, b.items, b.ordered === true)
      w.gap(4)
      return
    case 'table':
      drawTable(w, b)
      w.gap(8)
      return
    case 'preformatted':
      drawPreformatted(w, b.text)
      w.gap(6)
      return
    case 'entry':
      drawEntry(w, b)
      return
  }
}

function drawSection(w: Writer, s: ReportSection) {
  // Heading + provenance + some content stay together (no orphan heading at the page bottom).
  w.ensure(18 + 13 + 44)
  w.y -= 18
  w.draw(s.title, MARGIN_X, w.y + 2, w.f.bold, 13, C.primary)
  if (s.provenance) {
    w.y -= 13
    w.page.drawRectangle({ x: MARGIN_X, y: w.y + 3, width: 5, height: 5, color: s.provenance === 'external' ? C.badge.text : s.provenance === 'ai' ? C.high.bar : C.primary })
    w.draw(PROVENANCE_LABEL[s.provenance], MARGIN_X + 9, w.y + 2, w.f.italic, 8.5, C.muted)
  }
  w.gap(6)
  for (const b of s.blocks) drawBlock(w, b)
  w.gap(10)
}

export async function renderReportPdf(report: ChuyaReport): Promise<{ bytes: Uint8Array; trace: RenderTrace }> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  }
  const w = new Writer(doc, fonts, `Chuya Motor · ${report.title}`)
  w.newPage()

  // Title block.
  w.y -= 4
  w.draw('CHUYA MOTOR', MARGIN_X, w.y, fonts.bold, 10, C.primary)
  w.y -= 26
  for (const l of w.wrap(report.title, fonts.bold, 20, CONTENT_W)) {
    w.draw(l, MARGIN_X, w.y, fonts.bold, 20, C.text)
    w.y -= 24
  }
  w.draw(report.subtitle, MARGIN_X, w.y + 6, fonts.regular, 10, C.muted)
  w.y -= 12
  w.draw(report.generatedAtLabel, MARGIN_X, w.y + 4, fonts.regular, 9, C.muted)
  w.y -= 10
  w.page.drawLine({ start: { x: MARGIN_X, y: w.y }, end: { x: PAGE_W - MARGIN_X, y: w.y }, thickness: 1, color: C.primary })
  w.y -= 4

  for (const s of report.sections) drawSection(w, s)
  drawSection(w, { id: 'disclaimer', title: 'Aviso importante', blocks: [{ kind: 'paragraph', text: report.disclaimer }] })

  // Footers (now that the page count is known).
  const total = w.pages.length
  w.pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN_X, y: 44 }, end: { x: PAGE_W - MARGIN_X, y: 44 }, thickness: 0.5, color: C.rule })
    const left = w.safe('Chuya Motor · Documento orientativo, no certificado por un taller', fonts.regular)
    page.drawText(left, { x: MARGIN_X, y: 30, size: 7.5, font: fonts.regular, color: C.light })
    const right = `Página ${i + 1} de ${total}`
    page.drawText(w.safe(right, fonts.regular), { x: PAGE_W - MARGIN_X - fonts.regular.widthOfTextAtSize(w.safe(right, fonts.regular), 8), y: 30, size: 8, font: fonts.regular, color: C.muted })
    w.trace.pages[i]!.push(left, right)
  })

  doc.setTitle(`Chuya Motor - ${report.title}`)
  doc.setAuthor('Chuya Motor')
  doc.setSubject('Informe orientativo generado en el dispositivo del usuario')
  doc.setCreator('Chuya Motor')
  doc.setProducer('Chuya Motor')
  doc.setLanguage('es-AR')
  doc.setKeywords([])
  const now = new Date()
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  return { bytes: await doc.save(), trace: w.trace }
}
