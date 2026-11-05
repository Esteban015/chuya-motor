import { StateGraph, START, END } from '@langchain/langgraph'
import { SAFETY_POLICY_VERSION, COVERAGE_DISCLAIMER, FALLBACK_TEXT } from '@/domain/safety/blocklist'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import type { DocumentSourcePort } from '@/sources/sources-port'
import { StubDocumentSource } from '@/sources/stub'
import { GraphStateAnnotation, type GraphState } from './graph-state'
import { validatorNode } from './nodes/validator'
import { safetyGateNode } from './nodes/safety-gate'
import { routerNode } from './nodes/router'
import { createDiagnosisAgentNode } from './nodes/diagnosis-agent'
import { createBudgetParserNode } from './nodes/budget-parser'
import { budgetCalculatorNode } from './nodes/budget-calculator'
import { createEvaluatorNode } from './nodes/evaluator'
import { reportBuilderNode } from './nodes/report-builder'
import { AnalyzeInputSchema, type AnalyzeInput, type AnalyzeOutput } from './types'

export interface GraphDeps {
  llmAdapter?: LLMAdapter
  documentSourcePort?: DocumentSourcePort
}

function routeAfterSafetyGate(state: GraphState) {
  if (state.fallback || (state.safety?.blocked ?? false)) return 'reportBuilder'
  return 'router'
}

function routeAfterRouter(state: GraphState) {
  if (state.fallback) return 'reportBuilder'
  if (state.route === 'budget') return 'budgetParser'
  if (state.route === 'clarification') return 'reportBuilder'
  return 'diagnosisAgent'
}

export function createAnalyzeGraph(deps: GraphDeps = {}) {
  const llmAdapter = deps.llmAdapter ?? new DeterministicMockLLMAdapter()
  const documentSourcePort = deps.documentSourcePort ?? new StubDocumentSource()

  // Method chaining is required for LangGraph 1.x TypeScript to track node names
  return new StateGraph(GraphStateAnnotation)
    .addNode('validator', validatorNode)
    .addNode('safetyGate', safetyGateNode)
    .addNode('router', routerNode)
    .addNode('diagnosisAgent', createDiagnosisAgentNode(llmAdapter))
    .addNode('budgetParser', createBudgetParserNode(llmAdapter))
    .addNode('budgetCalculator', budgetCalculatorNode)
    .addNode('evaluator', createEvaluatorNode(documentSourcePort))
    .addNode('reportBuilder', reportBuilderNode)
    .addEdge(START, 'validator')
    .addEdge('validator', 'safetyGate')
    .addConditionalEdges('safetyGate', routeAfterSafetyGate)
    .addConditionalEdges('router', routeAfterRouter)
    .addEdge('diagnosisAgent', 'evaluator')
    .addEdge('budgetParser', 'budgetCalculator')
    .addEdge('budgetCalculator', 'evaluator')
    .addEdge('evaluator', 'reportBuilder')
    .addEdge('reportBuilder', END)
    .compile()
}

// Main entry point — validates input, runs graph, returns typed output
export async function analyzeCase(input: AnalyzeInput, deps: GraphDeps = {}): Promise<AnalyzeOutput> {
  const parsed = AnalyzeInputSchema.safeParse(input)
  if (!parsed.success) {
    const issueMessages = parsed.error.issues.map((i) => i.message).join('; ')
    return {
      caseId: (input as { caseId?: string }).caseId ?? 'invalid',
      safetyBlocked: false,
      safetyDerivationMessage: null,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
      route: null,
      facts: [],
      hypotheses: [],
      questions: [],
      warnings: [],
      budget: null,
      missingInformation: [`Input inválido: ${issueMessages}`],
      fallback: true,
      fallbackText: FALLBACK_TEXT,
      traces: [],
    }
  }

  const data = parsed.data
  const compiledGraph = createAnalyzeGraph(deps)

  const initialState: Partial<GraphState> = {
    caseId: data.caseId,
    userText: data.userText,
    vehicle: data.vehicle ?? null,
    experienceLevel: data.experienceLevel,
    dataLabel: data.dataLabel,
  }

  const finalState = await compiledGraph.invoke(initialState)

  if (!finalState.output) {
    return {
      caseId: data.caseId,
      safetyBlocked: false,
      safetyDerivationMessage: null,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
      route: null,
      facts: [],
      hypotheses: [],
      questions: [],
      warnings: [],
      budget: null,
      missingInformation: [],
      fallback: true,
      fallbackText: FALLBACK_TEXT,
      traces: finalState.traces ?? [],
    }
  }

  // Include final reportBuilder trace in output traces
  return {
    ...finalState.output,
    traces: finalState.traces,
  }
}
