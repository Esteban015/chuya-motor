/**
 * Human-readable quality-review report — Incremento 6.4A.
 *
 * The report CONTAINS LLM-generated text for synthetic scenarios, so it is written only to the
 * git-ignored `reviews-local/` folder and never to benchmark/results or docs/.
 * Rubric scores are left blank (__/5) for the human reviewer.
 */
import { resolve, sep } from 'path'
import type { ReviewScenario } from './review-scenarios'
import { detectDefects, avgWordsPerSentence, RUBRIC_DIMENSIONS } from './review-checks'
import type { ReviewItemResult, Defect } from './review-checks'

export const REVIEW_ROOT_DIR = 'reviews-local/groq-quality'

export interface ReviewMeta {
  mode: 'mock' | 'real'
  model: string
  generatedAt: string
  realCalls: number
  tokensUsed: number
  stopReason: string
}

export interface ReviewEntry {
  scenario: ReviewScenario
  result: ReviewItemResult
}

/** Confines output to reviews-local/groq-quality/<runId> (path-traversal safe). */
export function resolveReviewOutputDir(runId: string): string {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(runId) || runId.includes('..')) {
    throw new Error(`Invalid review run id "${runId}".`)
  }
  const root = resolve(process.cwd(), REVIEW_ROOT_DIR)
  const dir = resolve(root, runId)
  if (!dir.startsWith(root + sep)) throw new Error('Review output must stay inside reviews-local/.')
  return dir
}

export function toReviewMarkdown(meta: ReviewMeta, entries: ReviewEntry[]): string {
  const L: string[] = []
  const isStub = meta.mode === 'mock'

  L.push('# Revisión de calidad — informe local (NO subir a Git)', '')
  L.push(`Generado: ${meta.generatedAt} · Modo: **${isStub ? 'STUB (simulado)' : 'REAL (GroqCloud)'}** · Modelo: \`${meta.model}\``)
  L.push(`Llamadas reales: ${meta.realCalls} · Tokens: ${meta.tokensUsed} · Fin: ${meta.stopReason}`, '')
  if (isStub) {
    L.push('> **STUB:** este informe usa respuestas simuladas. Sirve para validar la herramienta; **no representa la calidad de Groq**.', '')
  }
  L.push(
    '> Contiene texto generado por un LLM para escenarios sintéticos. Las señales automáticas son heurísticas;',
    '> los puntajes de la rúbrica los asigna una persona. Ninguna sección certifica precisión diagnóstica.',
    '',
  )

  L.push('## Resumen', '', '| Escenario | Bloqueado | Ruta | Banner | Llamadas | Señales automáticas |', '|---|---|---|---|---|---|')
  const defectsBy = new Map<string, Defect[]>()
  for (const { scenario, result } of entries) {
    const d = detectDefects(scenario, result)
    defectsBy.set(scenario.id, d)
    L.push(
      `| ${scenario.id} — ${scenario.title} | ${yn(result.output?.safetyBlocked)} | ${result.output?.route ?? '—'} | ${result.severity?.level ?? '—'} | ${result.llmCalls} | ${d.length === 0 ? 'ninguna' : d.map((x) => `${x.severity} ${x.code}`).join('<br>')} |`,
    )
  }
  L.push('')

  for (const { scenario, result } of entries) {
    const o = result.output
    L.push(`## ${scenario.id} — ${scenario.title}`, '')
    L.push(`**Origen:** ${scenario.source === 'dataset' ? 'dataset de 30 escenarios' : 'escenario sintético adicional de revisión'}  `)
    L.push(`**Foco del revisor:** ${scenario.reviewerFocus}`, '')
    L.push('**Entrada (sintética):**', '', '```text', scenario.userText, '```', '')

    L.push('### 1. Validación estructural automatizada', '')
    L.push(`- Safety Gate: ${o?.safetyBlocked ? 'BLOQUEADO' : 'no bloqueado'} (esperado: ${scenario.expected.safetyBlocked ? 'bloqueado' : 'no bloqueado'})`)
    L.push(`- Ruta: ${o?.route ?? '—'}${scenario.expected.route !== undefined ? ` (esperada: ${scenario.expected.route ?? '—'})` : ''}`)
    L.push(`- Banner de severidad (como lo muestra la API): ${result.severity ? `${result.severity.level.toUpperCase()} — ${result.severity.action}` : 'ninguno'}`)
    if (o?.safetyBlocked) L.push(`- Mensaje de derivación mostrado: "${o.safetyDerivationMessage ?? ''}"`)
    L.push(`- Fallback: ${yn(o?.fallback)}${result.llmDiagnosis ? ` (${result.llmDiagnosis})` : ''}`)
    L.push(`- Llamadas LLM: ${result.llmCalls} · Tokens: ${result.tokensUsed} · Latencia: ${result.durationMs} ms`)
    if (o?.budget) {
      const b = o.budget
      L.push(`- Presupuesto: estado ${b.completenessStatus}, total calculado ${fmtMoney(b.computedTotalMinorUnit)} ${b.currency ?? ''}, discrepancia con el declarado: ${yn(b.discrepancy)}, líneas ${b.lineCount} (faltantes ${b.missingLineCount})`)
    }
    if (result.error) L.push(`- Error: ${redact(result.error)}`)
    L.push('')

    if (o && !o.safetyBlocked && !o.fallback) {
      L.push('### Respuesta generada', '')
      if (o.facts.length) L.push('**Hechos:**', ...o.facts.map((f) => `- ${f}`), '')
      if (o.hypotheses.length) {
        L.push('**Hipótesis:**', '')
        o.hypotheses.forEach((h, i) => {
          L.push(`${i + 1}. ${h.statement} — confianza **${h.confidence}**`)
          for (const c of h.caveats) L.push(`   - salvedad: ${c}`)
        })
        L.push('')
      }
      if (o.questions.length) L.push('**Preguntas para el taller:**', ...o.questions.map((q) => `- ${q}`), '')
      if (o.missingInformation.length) L.push('**Información faltante:**', ...o.missingInformation.map((m) => `- ${m}`), '')
      const awps = avgWordsPerSentence(o)
      if (awps !== null) L.push(`_Indicador de legibilidad: ${awps} palabras por oración (referencia, no puntaje)._`, '')
    }

    const defects = defectsBy.get(scenario.id) ?? []
    L.push('**Señales automáticas de defectos:**', '')
    L.push(...(defects.length === 0 ? ['- ninguna (no implica que la respuesta sea correcta)'] : defects.map((d) => `- **${d.severity}** \`${d.code}\`: ${d.detail}`)), '')

    L.push('### 2. Revisión lingüística y de utilidad (completar)', '')
    L.push('| # | Dimensión | Puntaje | Señales automáticas relacionadas | Evidencia concreta (citar la respuesta) |', '|---|---|---|---|---|')
    for (const dim of RUBRIC_DIMENSIONS) {
      const related = defects.filter((d) => dim.relatedCodes.includes(d.code)).map((d) => d.code)
      L.push(`| ${dim.id} | ${dim.name} — ${dim.question} | __/5 | ${related.join(', ') || '—'} | |`)
    }
    L.push('')
    L.push('### 3. Evaluación técnica mecánica — PENDIENTE de profesional', '')
    L.push('- [ ] Hipótesis técnicamente plausibles para el vehículo y el síntoma.', '- [ ] Ninguna omisión de causa crítica de seguridad.', '- [ ] Revisado por: ______ (mecánico/a matriculado/a) · Fecha: ______', '')
  }
  return L.join('\n')
}

function yn(v: boolean | null | undefined): string {
  return v === true ? 'sí' : v === false ? 'no' : '—'
}

function fmtMoney(minor: number | null): string {
  return minor === null ? '—' : (minor / 100).toLocaleString('es-AR')
}

function redact(s: string): string {
  const out = s.replace(/gsk_[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
  return out.length > 200 ? `${out.slice(0, 200)}…` : out
}
