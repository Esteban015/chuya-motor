/**
 * favicon.spec.ts — 7F.1: Chuya Motor app icons (Next.js App Router file conventions).
 * The served files must be exactly the ones in src/app (never a framework default), with the
 * declared sizes, and every page must link them.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const own = (f: string) => readFileSync(`src/app/${f}`)

function pngSize(buf: Buffer) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('head links: favicon.ico, icon.png (512) and apple-touch-icon (180) on every page', async ({ page }) => {
  for (const path of ['/', '/demo/falla', '/demo/presupuesto']) {
    await page.goto(path)
    const icons = await page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]').evaluateAll((els) =>
      els.map((e) => ({ rel: e.getAttribute('rel'), href: e.getAttribute('href'), sizes: e.getAttribute('sizes'), type: e.getAttribute('type') })),
    )
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: 'icon', href: expect.stringMatching(/^\/favicon\.ico/), type: 'image/x-icon' }),
        expect.objectContaining({ rel: 'icon', href: expect.stringMatching(/^\/icon\.png/), sizes: '512x512', type: 'image/png' }),
        expect.objectContaining({ rel: 'apple-touch-icon', href: expect.stringMatching(/^\/apple-icon\.png/), sizes: '180x180', type: 'image/png' }),
      ]),
    )
  }
})

test('served files are exactly ours (no default icon): ICO 16/32/48, PNG 512 and 180', async ({ page, request }) => {
  const ico = await request.get('/favicon.ico')
  expect(ico.status()).toBe(200)
  const icoBody = await ico.body()
  expect(icoBody.equals(own('favicon.ico'))).toBe(true)
  // ICO directory: type 1, three PNG entries.
  expect(icoBody.readUInt16LE(2)).toBe(1)
  const count = icoBody.readUInt16LE(4)
  const sizes = Array.from({ length: count }, (_, i) => icoBody.readUInt8(6 + i * 16))
  expect(sizes).toEqual([16, 32, 48])

  await page.goto('/')
  for (const [rel, file, size] of [['icon', 'icon.png', 512], ['apple-touch-icon', 'apple-icon.png', 180]] as const) {
    const href = await page.locator(`head link[rel="${rel}"][href^="/${file}"]`).getAttribute('href')
    const res = await request.get(href!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
    const body = await res.body()
    expect(body.equals(own(file))).toBe(true)
    expect(pngSize(body)).toEqual({ width: size, height: size })
  }
})
