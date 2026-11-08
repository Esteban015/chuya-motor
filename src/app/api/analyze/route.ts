import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { analyzeCase } from '@/agents/graph/analyze-graph'
import { createLLMAdapter } from '@/agents/llm/llm-adapter-factory'
import { StubDocumentSource } from '@/sources/stub'
import type { Vehicle } from '@/domain/vehicle/vehicle'
import type { AnalyzeOutput } from '@/agents/graph/types'
import { sanitizeTraces } from '@/agents/graph/trace-sanitizer'
import { devTraceStore } from '@/agents/graph/dev-trace-store'
import { assessSeverity } from '@/domain/safety/severity-assessor'
import type {
  ClientAnalyzeOutput,
  ApiVehicleInput,
} from './schema'

// ── Request schema ─────────────────────────────────────────────────────────

const ApiVehicleSchema = z.object({
  make: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: z
    .enum(['sedan', 'hatchback', 'suv', 'pickup', 'van', 'motorcycle', 'other'])
    .optional(),
  fuelType: z
    .enum(['gasoline', 'diesel', 'gnc', 'hybrid', 'electric', 'other'])
    .optional(),
})

const AnalyzeRequestSchema = z.object({
  userText: z
    .string()
    .min(10, 'El texto debe tener al menos 10 caracteres.')
    .max(2000, 'El texto no puede superar los 2000 caracteres.'),
  vehicle: ApiVehicleSchema.optional(),
  experienceLevel: z
    .enum(['novice', 'intermediate', 'experienced', 'unknown'])
    .optional(),
})

// ── Rate limiting ──────────────────────────────────────────────────────────
// In-memory — single-instance demo only.
// Production: replace with Redis sliding-window (e.g., Upstash Rate Limit).

const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000

const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)
  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (record.count >= RATE_LIMIT) return false
  record.count++
  return true
}

// ── Vehicle mapping ────────────────────────────────────────────────────────
// No licensePlate or odometer exposed from the API (privacy).

function mapVehicle(v: ApiVehicleInput): Vehicle {
  const vehicle: Vehicle = {}
  if (v.make) vehicle.make = v.make
  if (v.model) vehicle.model = v.model
  if (v.year) vehicle.year = v.year
  if (v.vehicleType) vehicle.vehicleType = v.vehicleType
  if (v.fuelType) vehicle.fuelType = v.fuelType
  return vehicle
}

// ── Output sanitization ────────────────────────────────────────────────────
// Never expose full traces to the client (Ajuste C, security requirement).
// In development: expose minimal nodeTrace summary (no userText, no prompts).

function sanitizeOutput(output: AnalyzeOutput, userText: string): ClientAnalyzeOutput {
  const isDev = process.env['NODE_ENV'] !== 'production'
  const safeTraces = sanitizeTraces(output.traces)

  // In dev: store traces for retrieval via GET /api/traces?caseId=...
  if (isDev) {
    devTraceStore.store(output.caseId, safeTraces)
  }

  return {
    caseId: output.caseId,
    safetyBlocked: output.safetyBlocked,
    safetyDerivationMessage: output.safetyDerivationMessage,
    policyVersion: output.policyVersion,
    coverageDisclaimer: output.coverageDisclaimer,
    route: output.route,
    facts: output.facts,
    hypotheses: output.hypotheses.map((h) => ({
      statement: h.statement,
      confidence: h.confidence,
      caveats: h.caveats,
      // evidenceIds stripped — not exposed to client
    })),
    questions: output.questions,
    warnings: output.warnings,
    budget: output.budget,
    missingInformation: output.missingInformation,
    fallback: output.fallback,
    fallbackText: output.fallbackText,
    // Server-side production guard: traces are never sent to client in production.
    // The check is here (server), not in the client component.
    nodeTrace: isDev ? safeTraces : null,
    // Deterministic severity assessment — null means normal, no banner.
    severity: output.safetyBlocked ? null : assessSeverity(userText, output.route),
  }
}

// ── Standard response headers ──────────────────────────────────────────────
// R-06: prevent response caching across users

const NO_STORE = { 'Cache-Control': 'no-store' }

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limit
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      {
        error: 'RATE_LIMIT',
        message: 'Demasiadas solicitudes. Intentá de nuevo en un minuto.',
      },
      { status: 429, headers: NO_STORE },
    )
  }

  // 2. Parse JSON
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'El cuerpo de la solicitud debe ser JSON válido.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // 3. Validate schema
  const parsed = AnalyzeRequestSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ')
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message },
      { status: 400, headers: NO_STORE },
    )
  }

  const { userText, vehicle, experienceLevel } = parsed.data

  // 4. Execute graph
  let result: AnalyzeOutput
  try {
    result = await analyzeCase(
      {
        caseId: crypto.randomUUID(),
        userText,
        vehicle: vehicle ? mapVehicle(vehicle) : undefined,
        experienceLevel: experienceLevel ?? 'unknown',
        dataLabel: 'user_input',
      },
      {
        llmAdapter: createLLMAdapter(),
        documentSourcePort: new StubDocumentSource(),
      },
    )
  } catch {
    // Generic error — no internal details exposed (stack traces, prompts, etc.)
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message:
          'No se pudo procesar la solicitud. Intentá de nuevo más tarde.',
      },
      { status: 500, headers: NO_STORE },
    )
  }

  // 5. Safety block → 422 (ARCHITECTURE.md Ajuste B)
  if (result.safetyBlocked) {
    return NextResponse.json(
      {
        error: 'SAFETY_BLOCKED',
        safetyBlocked: true,
        safetyDerivationMessage: result.safetyDerivationMessage,
        policyVersion: result.policyVersion,
        coverageDisclaimer: result.coverageDisclaimer,
      },
      { status: 422, headers: NO_STORE },
    )
  }

  // 6. Success
  return NextResponse.json(sanitizeOutput(result, userText), {
    status: 200,
    headers: NO_STORE,
  })
}
