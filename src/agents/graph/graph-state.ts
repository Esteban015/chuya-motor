import { Annotation } from '@langchain/langgraph'
import type { Vehicle } from '@/domain/vehicle/vehicle'
import type { SafetyGateResult } from '@/domain/safety/safety-policy'
import type { BudgetLine, BudgetParseState } from '@/domain/budget/budget'
import type { Hypothesis, AnalyzeOutput } from './types'
import type { TraceMetadata } from './trace'

export type RouteIntent = 'symptom' | 'budget' | 'clarification'
export type ExperienceLevel = 'novice' | 'intermediate' | 'experienced' | 'unknown'
export type DataLabel = 'synthetic_demo' | 'user_input'

export const GraphStateAnnotation = Annotation.Root({
  caseId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  userText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  vehicle: Annotation<Vehicle | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  experienceLevel: Annotation<ExperienceLevel>({
    reducer: (_prev, next) => next,
    default: () => 'unknown',
  }),
  dataLabel: Annotation<DataLabel>({
    reducer: (_prev, next) => next,
    default: () => 'user_input',
  }),

  // Immutable after gate: once safety.blocked === true, no node can unblock it (R-03, Ajuste E)
  safety: Annotation<SafetyGateResult | null>({
    reducer: (prev, next) => {
      if (prev !== null && prev.blocked) return prev
      return next
    },
    default: () => null,
  }),

  route: Annotation<RouteIntent | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  facts: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  hypotheses: Annotation<Hypothesis[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Mechanic-directed questions (shown as "Preguntas para el taller"). */
  questions: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Bugfix 7B: clarifying questions for the driver. */
  driverQuestions: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  warnings: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  budgetLines: Annotation<BudgetLine[] | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  // Declared total extracted by LLM parser; passed to determineBudgetState for discrepancy detection (C-2 fix)
  declaredTotalMinorUnit: Annotation<number | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  budgetState: Annotation<BudgetParseState | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Ajuste C: only sourceIds — no excerpt text stored in shared state
  evidenceIds: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  missingInformation: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  output: Annotation<AnalyzeOutput | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Once true, stays true throughout the graph (belt-and-suspenders for D-5 fallback)
  fallback: Annotation<boolean>({
    reducer: (prev, next) => prev || next,
    default: () => false,
  }),
  errorCode: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Traces accumulate across all nodes (append-only, structural only — Ajuste C)
  traces: Annotation<TraceMetadata[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
})

export type GraphState = typeof GraphStateAnnotation.State
