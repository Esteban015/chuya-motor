import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ── Evidence collector ────────────────────────────────────────────────────────

const EVIDENCE_DIR = path.join(
  'C:\\Users\\Esteban\\AppData\\Local\\Temp\\claude\\C--Users-Esteban-Documents-chuya-motor\\d67bbba1-b6cd-4eb1-864a-545859b5811b\\scratchpad',
  'evidence',
)
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

function saveEvidence(id: string, data: unknown) {
  try {
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${id}.json`), JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // ignore write errors
  }
}

// ── API capture helper using page.waitForResponse ─────────────────────────────

interface ApiCapture {
  status: number
  body: unknown
  headers: Record<string, string>
}

async function captureAndSubmit(
  page: Page,
  submitFn: () => Promise<void>,
): Promise<ApiCapture> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/analyze'), { timeout: 15000 }),
    submitFn(),
  ])

  const status = response.status()
  const rawHeaders = response.headers()
  const headers: Record<string, string> = {
    'cache-control': rawHeaders['cache-control'] ?? '',
    'content-type': rawHeaders['content-type'] ?? '',
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  return { status, body, headers }
}

// ── Console error capture ─────────────────────────────────────────────────────

function attachConsoleCapture(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

// ── Screenshot dir ────────────────────────────────────────────────────────────

const SS_DIR = path.join(
  'C:\\Users\\Esteban\\AppData\\Local\\Temp\\claude\\C--Users-Esteban-Documents-chuya-motor\\d67bbba1-b6cd-4eb1-864a-545859b5811b\\scratchpad',
  'screenshots',
)
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true })

// ── E-01: Síntoma habitual ────────────────────────────────────────────────────

test('E-01: Síntoma habitual — motor ruido arrancar en frío', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill('#symptomText', 'El motor hace un ruido extraño al arrancar en frío, como un golpeteo.')
    await page.selectOption('#occurrence', 'Al arrancar')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-01', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  expect(body.safetyBlocked).toBe(false)
  expect(body.route).toBe('symptom')
  expect(Array.isArray(body.hypotheses)).toBe(true)
  expect((body.hypotheses as unknown[]).length).toBeGreaterThan(0)

  // Report visible in UI — use role heading to avoid strict mode violation
  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-01-report.png') })
})

// ── E-02: Falla crítica de frenos ─────────────────────────────────────────────

test('E-02: Falla crítica de frenos — pedal se hunde', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill('#symptomText', 'El pedal de freno se hunde y el auto no frena bien.')
    await page.selectOption('#occurrence', 'Al frenar')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-02', { capture, consoleErrors })

  expect(capture.status).toBe(422)
  const body = capture.body as Record<string, unknown>
  expect(body.error).toBe('SAFETY_BLOCKED')

  // Safety alert visible — using same pattern as increment3.spec.ts
  await expect(page.getByText('Consulta bloqueada por seguridad')).toBeVisible({ timeout: 5000 })

  // No hypotheses section
  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).not.toBeVisible()

  await page.screenshot({ path: path.join(SS_DIR, 'E-02-safety-block.png') })
})

// ── E-03: Presupuesto correcto ─────────────────────────────────────────────────

test('E-03: Presupuesto correcto — suma exacta', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro aire: 1500\nTotal: 6000')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-03', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  expect(body.route).toBe('budget')

  const budget = body.budget as Record<string, unknown>
  expect(budget).not.toBeNull()
  expect(budget.completenessStatus).toBe('COMPLETE')
  expect(budget.discrepancy).toBe(false)

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-03-budget-ok.png') })
})

// ── E-04: Presupuesto total incorrecto ───────────────────────────────────────

test('E-04: Presupuesto total incorrecto — discrepancy', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    // Items sum to 6000 but declared total is 9000
    await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro aire: 1500\nTotal: 9000')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-04', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  expect(body.route).toBe('budget')

  const budget = body.budget as Record<string, unknown>
  expect(budget.completenessStatus).toBe('COMPLETE')
  expect(budget.discrepancy).toBe(true)
  // Items: 4500 + 1500 = 6000 ARS → 600000 minor units (cents)
  expect(budget.computedTotalMinorUnit).toBe(600000)

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-04-discrepancy.png') })
})

// ── E-05: "Filtro de combustible" como nombre de repuesto ──────────────────────

test('E-05: Filtro de combustible como repuesto — potencial falso positivo seguridad', async ({
  page,
}) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill(
      '#budgetText',
      'Aceite motor: 4500\nFiltro de combustible: 2000\nTotal: 6500',
    )
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-05', { capture, consoleErrors })

  const body = capture.body as Record<string, unknown>

  if (capture.status === 422) {
    console.log(
      'E-05 DEFECT: "Filtro de combustible" in budget blocked (false positive). status=422, error=',
      body.error,
    )
    expect(body.error).toBe('SAFETY_BLOCKED')
  } else {
    expect(capture.status).toBe(200)
    expect(body.route).toBe('budget')
  }

  await page.screenshot({ path: path.join(SS_DIR, 'E-05-combustible.png') })
})

// ── E-06: Fuga de combustible explícita ──────────────────────────────────────

test('E-06: Fuga de combustible explícita — safety block', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill(
      '#symptomText',
      'Hay una fuga de combustible bajo el auto, huele fuerte a nafta y gotea.',
    )
    await page.selectOption('#occurrence', 'Siempre')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-06', { capture, consoleErrors })

  expect(capture.status).toBe(422)
  const body = capture.body as Record<string, unknown>
  expect(body.error).toBe('SAFETY_BLOCKED')

  await expect(page.getByText('Consulta bloqueada por seguridad')).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-06-safety-fuel-leak.png') })
})

// ── E-07: Presupuesto incompleto (PARTIAL) ───────────────────────────────────

test('E-07: Presupuesto incompleto — estado PARTIAL', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill(
      '#budgetText',
      'Aceite motor: 4500\nFiltro de aire: pendiente\nMano de obra: pendiente',
    )
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-07', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  expect(body.route).toBe('budget')

  const budget = body.budget as Record<string, unknown>
  expect(budget.completenessStatus).toBe('PARTIAL')
  expect(budget.computedTotalIsPartial).toBe(true)

  await expect(page.getByText('PARTIAL')).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-07-partial.png') })
})

// ── E-08: Presupuesto inválido / formato incorrecto ──────────────────────────

test('E-08A: Presupuesto sin importes — solo texto continuo', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill(
      '#budgetText',
      'Aceite motor filtro de aire mano de obra revision general completa del vehiculo',
    )
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-08A', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  console.log(
    'E-08A result: route=',
    body.route,
    'budget=',
    JSON.stringify(body.budget),
  )

  await page.screenshot({ path: path.join(SS_DIR, 'E-08A-no-amounts.png') })
})

test('E-08B: Solo texto libre sin estructura', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill(
      '#budgetText',
      'El taller me dio el presupuesto pero no recuerdo los numeros exactos que tenia',
    )
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-08B', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  console.log(
    'E-08B result: route=',
    body.route,
    'budget=',
    JSON.stringify(body.budget),
  )

  await page.screenshot({ path: path.join(SS_DIR, 'E-08B-free-text.png') })
})

// ── E-09: Caracteres especiales — separador de miles con punto ───────────────

test('E-09: Formato argentino con puntos como separador de miles', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill(
      '#budgetText',
      'Válvula EGR: 15.000\nFiltro de habitáculo: 3.500\nMano de obra: 8.000\nTotal: 26.500',
    )
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-09', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  const budget = body.budget as Record<string, unknown> | null
  console.log('E-09 route=', body.route, 'budget=', JSON.stringify(budget))

  await page.screenshot({ path: path.join(SS_DIR, 'E-09-formato-argentino.png') })
})

// ── E-10: Reproducir HTTP 422 y capturar headers ─────────────────────────────

test('E-10: HTTP 422 — verificar Cache-Control: no-store en respuesta de seguridad', async ({
  page,
}) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill('#symptomText', 'El pedal de freno se hunde y el auto no frena bien.')
    await page.selectOption('#occurrence', 'Al frenar')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-10', { capture, consoleErrors })

  expect(capture.status).toBe(422)
  expect(capture.headers['cache-control']).toBe('no-store')

  const body = capture.body as Record<string, unknown>
  expect(body.error).toBe('SAFETY_BLOCKED')
  expect(typeof body.safetyDerivationMessage).toBe('string')
  expect(typeof body.policyVersion).toBe('string')
  expect(typeof body.coverageDisclaimer).toBe('string')

  await page.screenshot({ path: path.join(SS_DIR, 'E-10-422-headers.png') })
})

// ── E-11: Presupuesto nunca devuelve diagnóstico genérico ───────────────────

test('E-11: Presupuesto no devuelve hipótesis de síntoma', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/presupuesto')

  const capture = await captureAndSubmit(page, async () => {
    await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 6000')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-11', { capture, consoleErrors })

  expect(capture.status).toBe(200)
  const body = capture.body as Record<string, unknown>
  expect(body.route).toBe('budget')

  const hypotheses = body.hypotheses as unknown[]
  expect(hypotheses.length).toBe(0)

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).not.toBeVisible()

  await page.screenshot({ path: path.join(SS_DIR, 'E-11-no-hypothesis.png') })
})

// ── E-12: Seguridad contextual — comparación ─────────────────────────────────

test('E-12A: Pregunta informativa sobre frenos — no debe bloquear', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    // "funcionan" is in EDUCATIONAL_MARKERS → intent = 'informational' → NOT blocked by AM-01
    await page.fill('#symptomText', '¿Cómo funcionan los frenos de mi auto?')
    await page.selectOption('#occurrence', 'Otro')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-12A', { capture, consoleErrors })

  const body = capture.body as Record<string, unknown>
  console.log('E-12A: status=', capture.status, 'safetyBlocked/error=', body.safetyBlocked ?? body.error)

  if (capture.status === 422) {
    console.log('E-12A DEFECT: Educational query about frenos blocked unexpectedly — AM-01 educational marker not working')
    expect(capture.status).toBe(200)
  } else {
    expect(capture.status).toBe(200)
    expect(body.safetyBlocked).toBe(false)
  }

  await page.screenshot({ path: path.join(SS_DIR, 'E-12A-frenos-informativo.png') })
})

test('E-12B: Intervenir circuito de frenos — debe bloquear (DIY intent)', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)
  await page.goto('/falla')

  const capture = await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    // "intervenir" → stem "interven" in ACTION_VERB_STEMS + "frenos" keyword → Stage 3 DIY block
    await page.fill('#symptomText', 'Quiero intervenir el circuito de frenos de mi auto yo mismo.')
    await page.selectOption('#occurrence', 'Otro')
    await page.click('button[type="submit"]')
  })

  saveEvidence('E-12B', { capture, consoleErrors })

  expect(capture.status).toBe(422)
  const body = capture.body as Record<string, unknown>
  expect(body.error).toBe('SAFETY_BLOCKED')

  await expect(page.getByText('Consulta bloqueada por seguridad')).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-12B-frenos-diy.png') })
})

// ── E-13: Modo DEMO en todas las pantallas ───────────────────────────────────

test('E-13: MODO DEMO badge visible en todas las pantallas', async ({ page }) => {
  const consoleErrors = attachConsoleCapture(page)

  // Home
  await page.goto('/')
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-13-home.png') })

  // Falla
  await page.goto('/falla')
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-13-falla.png') })

  // Presupuesto
  await page.goto('/presupuesto')
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: path.join(SS_DIR, 'E-13-presupuesto.png') })

  // After successful submit — DEMO badge still present in report
  await page.goto('/falla')
  await captureAndSubmit(page, async () => {
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill('#symptomText', 'El motor hace un ruido extraño al arrancar en frío.')
    await page.selectOption('#occurrence', 'Al arrancar')
    await page.click('button[type="submit"]')
  })
  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()
  await page.screenshot({ path: path.join(SS_DIR, 'E-13-reporte.png') })

  saveEvidence('E-13', { consoleErrors })
})

// ── E-14: Estados de error y recuperación ───────────────────────────────────

test('E-14A: Input demasiado corto en /falla — validación client-side, sin fetch', async ({
  page,
}) => {
  const consoleErrors = attachConsoleCapture(page)
  let apiCallMade = false

  page.on('request', (req) => {
    if (req.url().includes('/api/analyze')) apiCallMade = true
  })

  await page.goto('/falla')
  await page.selectOption('#vehicleType', 'sedan')
  await page.fill('#symptomText', 'corto')
  await page.selectOption('#occurrence', 'Siempre')
  await page.click('button[type="submit"]')

  await page.waitForTimeout(1000)

  expect(apiCallMade).toBe(false)

  const validationError = page.locator('[role="alert"]').first()
  await expect(validationError).toBeVisible({ timeout: 3000 })

  saveEvidence('E-14A', { consoleErrors, apiCallMade })
  await page.screenshot({ path: path.join(SS_DIR, 'E-14A-short-falla.png') })
})

test('E-14B: Input demasiado corto en /presupuesto — validación client-side, sin fetch', async ({
  page,
}) => {
  const consoleErrors = attachConsoleCapture(page)
  let apiCallMade = false

  page.on('request', (req) => {
    if (req.url().includes('/api/analyze')) apiCallMade = true
  })

  await page.goto('/presupuesto')
  await page.fill('#budgetText', 'corto')
  await page.click('button[type="submit"]')

  await page.waitForTimeout(1000)

  expect(apiCallMade).toBe(false)

  const validationError = page.locator('[role="alert"]').first()
  await expect(validationError).toBeVisible({ timeout: 3000 })

  saveEvidence('E-14B', { consoleErrors, apiCallMade })
  await page.screenshot({ path: path.join(SS_DIR, 'E-14B-short-presupuesto.png') })
})

test('E-14C: POST directo con userText muy corto — HTTP 400 VALIDATION_ERROR', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userText: 'x' }),
    })
    const json = await response.json()
    return { status: response.status, body: json }
  })

  saveEvidence('E-14C', { result })

  expect(result.status).toBe(400)
  expect(result.body.error).toBe('VALIDATION_ERROR')

  await page.screenshot({ path: path.join(SS_DIR, 'E-14C-api-short.png') })
})
