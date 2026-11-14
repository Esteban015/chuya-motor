/**
 * diagnosis-normalization.ts — Recovery of preventable format violations in the diagnosis answer
 * (release candidate 6.4F, D-13). Runs BEFORE the Zod contract, which stays unchanged.
 *
 * Principles:
 *   - Removal only. A string is kept exactly as generated or removed whole: never truncated,
 *     never rewritten. Extra list items beyond the contract maximum are removed (the first N kept).
 *   - A hypothesis that loses a caveat is downgraded to "low": a removed caveat may have limited it.
 *   - Confidence: only case / Spanish synonyms are mapped (Baja → low). Anything else removes that
 *     hypothesis — a confidence is never invented.
 *   - Irrecoverable: not an object, `hypotheses` missing or not a list, or no usable hypothesis left.
 *   - Every removed user-visible text is returned in `droppedTexts` so the caller can still run the
 *     output safety scan on it (normalization must never launder unsafe text).
 *   - `issues` are structural codes only — "<path pattern>:<code>", e.g. "hypotheses.*.caveats.*:too_big".
 *     They never contain answer content and are safe for traces.
 */
import type { ZodError } from 'zod'

export const DIAGNOSIS_LIMITS = Object.freeze({
  facts: 10,
  factChars: 500,
  hypotheses: 5,
  statementChars: 500,
  caveats: 10,
  caveatChars: 200,
  evidenceIds: 20,
  evidenceIdChars: 100,
  questions: 5,
  questionChars: 300,
})

type Confidence = 'low' | 'medium' | 'high'

export interface NormalizedDiagnosis {
  facts: string[]
  hypotheses: Array<{ statement: string; confidence: Confidence; caveats: string[]; evidenceIds: string[] }>
  /** Mechanic-directed questions ("workshopQuestions" in prompt v2.2.0; legacy "questions"). */
  questions: string[]
  /** Bugfix 7B: clarifying questions for the driver ("driverQuestions"). */
  driverQuestions: string[]
}

export type NormalizationResult =
  | { ok: true; candidate: NormalizedDiagnosis; issues: string[]; droppedTexts: string[] }
  | { ok: false; issues: string[]; droppedTexts: string[] }

const CONFIDENCE: Readonly<Record<string, Confidence>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  baja: 'low',
  bajo: 'low',
  media: 'medium',
  medio: 'medium',
  alta: 'high',
  alto: 'high',
}

const MAX_ISSUES = 8
const ISSUE_FORMAT = /^[a-zA-Z*.$]+:[a-z_]+$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

class Collector {
  readonly issues = new Set<string>()
  readonly dropped: string[] = []
  issue(path: string, code: string): void {
    const s = `${path}:${code}`
    if (ISSUE_FORMAT.test(s)) this.issues.add(s)
  }
  drop(text: unknown): void {
    if (typeof text === 'string' && text.trim()) this.dropped.push(text)
  }
  list(): string[] {
    return [...this.issues].slice(0, MAX_ISSUES)
  }
}

/** List of non-empty strings; removes invalid / over-length items and extra items. */
function stringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxChars: number,
  c: Collector,
  userVisible = true,
): { items: string[]; removed: boolean } {
  if (value === undefined || value === null) {
    c.issue(path, 'invalid_type')
    return { items: [], removed: false }
  }
  if (!Array.isArray(value)) {
    c.issue(path, 'invalid_type')
    if (userVisible) c.drop(value)
    return { items: [], removed: true }
  }
  let removed = false
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      c.issue(`${path}.*`, 'invalid_type')
      removed = true
    } else if (item.trim().length === 0) {
      c.issue(`${path}.*`, 'too_small')
    } else if (item.length > maxChars) {
      c.issue(`${path}.*`, 'too_big')
      if (userVisible) c.drop(item)
      removed = true
    } else {
      items.push(item)
    }
  }
  if (items.length > maxItems) {
    c.issue(path, 'too_big')
    if (userVisible) items.slice(maxItems).forEach((t) => c.drop(t))
    removed = true
  }
  return { items: items.slice(0, maxItems), removed }
}

export function normalizeDiagnosisCandidate(raw: unknown): NormalizationResult {
  const c = new Collector()
  if (!isRecord(raw)) {
    c.issue('$', 'invalid_type')
    return { ok: false, issues: c.list(), droppedTexts: c.dropped }
  }

  const L = DIAGNOSIS_LIMITS
  const facts = stringList(raw['facts'], 'facts', L.facts, L.factChars, c).items
  // Prompt v2.2.0 (bugfix 7B) asks for two lists. A legacy single "questions" list is still accepted;
  // its items are re-classified by audience afterwards (question-audience.ts), never trusted as-is.
  const twoLists = raw['workshopQuestions'] !== undefined || raw['driverQuestions'] !== undefined
  const questions = twoLists
    ? stringList(raw['workshopQuestions'], 'workshopQuestions', L.questions, L.questionChars, c).items
    : stringList(raw['questions'], 'questions', L.questions, L.questionChars, c).items
  const driverQuestions = twoLists ? stringList(raw['driverQuestions'], 'driverQuestions', L.questions, L.questionChars, c).items : []

  const rawHyps = raw['hypotheses']
  if (!Array.isArray(rawHyps)) {
    c.issue('hypotheses', 'invalid_type')
    return { ok: false, issues: c.list(), droppedTexts: c.dropped }
  }

  const hypotheses: NormalizedDiagnosis['hypotheses'] = []
  for (const h of rawHyps) {
    if (!isRecord(h)) {
      c.issue('hypotheses.*', 'invalid_type')
      continue
    }
    const dropHypothesis = () => {
      c.drop(h['statement'])
      if (Array.isArray(h['caveats'])) h['caveats'].forEach((t) => c.drop(t))
    }
    const statement = h['statement']
    if (typeof statement !== 'string') {
      c.issue('hypotheses.*.statement', 'invalid_type')
      dropHypothesis()
      continue
    }
    if (statement.trim().length === 0) {
      c.issue('hypotheses.*.statement', 'too_small')
      dropHypothesis()
      continue
    }
    if (statement.length > L.statementChars) {
      c.issue('hypotheses.*.statement', 'too_big')
      dropHypothesis()
      continue
    }

    const rawConfidence = h['confidence']
    const mapped = typeof rawConfidence === 'string' ? CONFIDENCE[rawConfidence.trim().toLowerCase()] : undefined
    if (!mapped) {
      c.issue('hypotheses.*.confidence', 'invalid_enum_value')
      dropHypothesis()
      continue
    }
    if (mapped !== rawConfidence) c.issue('hypotheses.*.confidence', 'invalid_enum_value')

    const caveats = stringList(h['caveats'] ?? [], 'hypotheses.*.caveats', L.caveats, L.caveatChars, c)
    const evidenceIds = stringList(h['evidenceIds'] ?? [], 'hypotheses.*.evidenceIds', L.evidenceIds, L.evidenceIdChars, c, false)
    if (h['evidenceIds'] === undefined) c.issue('hypotheses.*.evidenceIds', 'invalid_type')

    hypotheses.push({
      statement,
      // A removed caveat may have limited the hypothesis: never keep it more confident than "low".
      confidence: caveats.removed ? 'low' : mapped,
      caveats: caveats.items,
      evidenceIds: evidenceIds.items,
    })
  }

  if (hypotheses.length > L.hypotheses) {
    c.issue('hypotheses', 'too_big')
    hypotheses.slice(L.hypotheses).forEach((h) => [h.statement, ...h.caveats].forEach((t) => c.drop(t)))
  }
  const kept = hypotheses.slice(0, L.hypotheses)

  // An explicit empty list stays valid (as before: e.g. only questions when information is missing).
  // Hypotheses that were generated but all turned out unusable make the answer irrecoverable.
  if (kept.length === 0 && rawHyps.length > 0) {
    return { ok: false, issues: c.list(), droppedTexts: c.dropped }
  }

  return { ok: true, candidate: { facts, hypotheses: kept, questions, driverQuestions }, issues: c.list(), droppedTexts: c.dropped }
}

/** Structural description of a Zod failure: "<path pattern>:<code>", no values or messages. */
export function describeZodIssues(error: ZodError): string[] {
  const out = new Set<string>()
  for (const issue of error.issues) {
    const path = issue.path.map((p) => (typeof p === 'number' ? '*' : String(p))).join('.') || '$'
    const s = `${path}:${issue.code}`
    if (ISSUE_FORMAT.test(s)) out.add(s)
  }
  return [...out].slice(0, MAX_ISSUES)
}
