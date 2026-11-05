# ARCHITECTURE — Chuya Motor

Versión v0.3 — 2026-11-04. Propuesta, todavía sin código productivo.

## Decisiones iniciales
- Monolito modular: Next.js App Router, TypeScript, Tailwind.
- Persistencia futura: PostgreSQL/Supabase con Row Level Security, almacenamiento de adjuntos privado y políticas de retención.
- Motor de orquestación de producto: LangGraph JS, en servicio backend (nunca en navegador con credenciales).
- Modelos mediante adaptador desacoplado; configurables por proveedor y con test doubles.
- Esquemas Zod para contratos de estados y resultados; cálculos determinísticos en dominio.
- Vitest para lógica y grafos simulados, Playwright E2E, GitHub Actions CI.

## Estructura de directorios canónica (Ajuste F — DECISIONS.md)

Next.js App Router requiere `app/` en raíz o en `src/`. Se adopta `src/app/`. La estructura anterior `src/web/app/` era ambigua y no reconocida automáticamente por Next.js.

```
src/
  app/              ← Next.js App Router (layouts, pages, API route handlers)
    layout.tsx
    page.tsx
    analyze/page.tsx
    api/analyze/route.ts
  components/       ← componentes React reutilizables (UI pura)
  domain/           ← entidades, tipos, contratos, reglas puras
    vehicle/
    case/
    budget/
    safety/
  agents/           ← orquestación LangGraph, nodos, adaptadores LLM
    graph/
      nodes/
    llm/
  sources/          ← recuperación de documentos autorizados
  persistence/      ← interfaz CaseRepository + NoopCaseRepository en MVP_01
e2e/                ← tests Playwright (raíz del proyecto)
vitest.config.ts    ← raíz del proyecto
playwright.config.ts ← raíz del proyecto
```

Tests unitarios e integración: co-ubicados con el archivo que prueban (`*.test.ts` junto al módulo). Tests E2E en `e2e/` en la raíz.

## Módulos

| Módulo | Directorio | Rol |
|---|---|---|
| web | `src/app/` + `src/components/` | Experiencia, casos e informes |
| domain | `src/domain/` | Vehículo, caso, presupuesto, evidencias y políticas (puro TypeScript/Zod) |
| agents | `src/agents/` | Orquestador LangGraph, nodos especializados, adaptadores LLM y observabilidad |
| sources | `src/sources/` | Recuperación de documentos autorizados; stub en MVP_01 |
| persistence | `src/persistence/` | Interfaz `CaseRepository`; `NoopCaseRepository` en MVP_01; PostgreSQL en Fase 2 |

## Persistencia en MVP_01 (Ajuste B — DECISIONS.md)

MVP_01 ejecuta el caso en un único request POST. No hay almacenamiento cross-request. El `caseId` es un UUID de correlación de trazas generado en el handler; no es una clave de base de datos recuperable.

`NoopCaseRepository` implementa la interfaz `CaseRepository` con métodos no-op. El grafo la recibe como dependencia inyectada; cambiar a `PostgresCaseRepository` en Fase 2 no modifica el grafo.

Módulo `persistence/` en MVP_01: solo `case-repository.ts` (interfaz) y `noop-repository.ts`. Los módulos `trace-store`, `consent-store` y `schema/` se crean en Fase 2.

## Entidades previstas

**MVP_01 (5 entidades):** Vehicle, Case, Budget, BudgetLine, SafetyPolicy.

**Fases 2-4 (entidades futuras — no deprecar interfaces):** User, DocumentSource, AgentRun, Workshop, RepairJob, Feedback, Evidence.

Todo precio debe modelar moneda (ISO 4217), jurisdicción, vigencia, fuente, unidad, impuestos y condiciones. Para dinero utilizar enteros en unidad menor, nunca floats para totalización financiera.

## Flujo

```
Cliente → POST /api/analyze
  → Validación Zod del body (400 si falla)
  → Safety gate determinístico (422 si bloqueado)
  → Grafo LangGraph (router → agentes → evaluador → reportBuilder)
  → AnalyzeOutput
  → UI (informe con trazas de nodos)
```

MVP_01 sin autenticación. Fase 2 agrega autenticación y `API autenticada`.

## Seguridad técnica
Validación y límites del lado servidor, cuotas por usuario, control del acceso a herramientas, ningún secreto en prompts o traces, prevención de prompt injection en documentos, filtrado de PII, autorización a nivel de fila, consentimiento para compartir casos. No ejecutar comandos ni herramientas con privilegios arbitrarios inducidos por un texto del usuario. Controles de seguridad desde cada incremento (Ajuste E — DECISIONS.md).

## Decisiones pendientes
Versiones de proveedores LLM a usar en producción, fuente inicial de documentación técnica con licencias adecuadas (corpus para `sources/`), política de retención de trazas y criterios de revisión profesional para catálogo DIY.

Consultar [DECISIONS.md](DECISIONS.md), [AGENT_ORCHESTRATION.md](AGENT_ORCHESTRATION.md) y [SAFETY.md](SAFETY.md).
