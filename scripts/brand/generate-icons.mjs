/**
 * generate-icons.mjs — Regenerates the Chuya Motor app icons (7F.1) from the SVG sources here.
 *
 *   node scripts/brand/generate-icons.mjs
 *
 * Outputs (Next.js App Router file conventions, picked up automatically — no metadata needed):
 *   src/app/favicon.ico     16, 32 and 48 px (PNG-compressed ICO entries)
 *   src/app/icon.png        512 px (browsers, Android)
 *   src/app/apple-icon.png  180 px (iOS home screen, full-bleed)
 *
 * Rasterized with Playwright's Chromium (already a dev dependency). Local only, no network.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', '..', 'src', 'app')
const favicon = readFileSync(join(here, 'favicon.svg'), 'utf8')
const apple = readFileSync(join(here, 'apple-icon.svg'), 'utf8')

async function rasterize(page, svg, size) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`)
  await page.locator('img').evaluate((img) => img.decode())
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

/** ICO container with PNG entries (supported by every current browser and Windows Vista+). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
try {
  const entries = []
  for (const size of [16, 32, 48]) entries.push({ size, png: await rasterize(page, favicon, size) })
  writeFileSync(join(appDir, 'favicon.ico'), ico(entries))
  writeFileSync(join(appDir, 'icon.png'), await rasterize(page, favicon, 512))
  writeFileSync(join(appDir, 'apple-icon.png'), await rasterize(page, apple, 180))
  console.log('icons written to src/app: favicon.ico (16/32/48), icon.png (512), apple-icon.png (180)')
} finally {
  await browser.close()
}
