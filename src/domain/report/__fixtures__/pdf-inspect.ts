/**
 * pdf-inspect.ts — Test helper: text and link annotations actually written in a generated PDF.
 * pdf-lib writes standard-font text as hex WinAnsi (windows-1252) strings in Flate streams.
 */
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

const winAnsi = new TextDecoder('windows-1252')

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  let out = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    let content: string
    try {
      content = inflateSync(Buffer.from(obj.contents)).toString('latin1')
    } catch {
      content = Buffer.from(obj.contents).toString('latin1')
    }
    for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += winAnsi.decode(Buffer.from(m[1]!, 'hex')) + '\n'
  }
  return out
}

export async function pdfLinks(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const urls: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const action = annots.lookup(i, PDFDict).lookup(PDFName.of('A'), PDFDict)
      urls.push((action.lookup(PDFName.of('URI'), PDFString) as PDFString).decodeText())
    }
  }
  return urls
}
