# MVP_01 — Primer incremento implementable

## Resultado observable
Un usuario ingresa un vehículo de ejemplo y una consulta de síntomas o presupuesto en texto. El sistema ejecuta una ruta visible, respeta bloqueos de seguridad y genera un informe que separa hechos, hipótesis, fuentes y preguntas pendientes.

## Alcance de implementación (no realizado aún)
1. Next.js mobile-first y página principal con dos recorridos: «Tengo una falla» y «Quiero entender mi presupuesto».
2. Casos sintéticos marcados como demo: tren delantero con ruido y un presupuesto de repuestos.
3. Grafo LangGraph básico: validator → safety gate → router → diagnóstico orientativo o parser de presupuesto → validador → informe.
4. Proveedor de agentes simulado para tests y un adaptador opcional real configurable por entorno.
5. Reglas críticas determinísticas que no dependen de IA.
6. Contratos de datos validados con Zod, cálculo de importes con precisión adecuada (enteros en unidad menor + ISO 4217).
7. Visualizador de trazas por nodo en modo desarrollo, con metadatos estructurales únicamente (sin texto libre del usuario).
8. Vitest y Playwright E2E con pruebas de flujo feliz, datos incompletos y bloqueo por riesgo.

## Secuencia de incrementos

| Incremento | Contenido principal |
|---|---|
| **0** | Scaffolding: estructura canónica, tsconfig, Vitest, Playwright, .env.example, stubs mínimos |
| **1** | Contratos de dominio: Vehicle, Case, Budget (COMPLETE/PARTIAL/INVALID), SafetyPolicy + tests unitarios |
| **2** | Grafo LangGraph + nodos + adaptador LLM stub + tests de integración |
| **3** | UI mobile-first + API Route Handler + tests E2E |

---

## Incremento 0 — Scaffolding

### Objetivo
Dejar el repositorio con estructura de directorios canónica, herramientas de build y test configuradas, variables de entorno documentadas, y contratos mínimos de stubs, sin ninguna lógica de negocio.

### Checklist del Incremento 0

**Estructura de directorios**
- [ ] Existen `src/app/`, `src/components/`, `src/domain/`, `src/agents/`, `src/sources/`, `src/persistence/` y `e2e/`
- [ ] No coexisten `src/web/app/` y `src/app/` (Ajuste F resuelto)

**Configuraciones válidas**
- [ ] `tsc --noEmit` termina sin errores sobre los archivos existentes
- [ ] `npx vitest run` ejecuta al menos un test de humo sin error de configuración
- [ ] `npx playwright test --dry-run` termina sin errores de configuración
- [ ] `vitest.config.ts` y `playwright.config.ts` están en la raíz

**Variables de entorno y seguridad**
- [ ] `.env.example` sin secretos reales; incluye `NODE_ENV`, `TRACE_VERBOSE=false`, `LLM_PROVIDER=stub`
- [ ] `.env`, `.env.local`, `.env.*.local` están en `.gitignore`
- [ ] `next.config.ts` incluye headers de seguridad: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [ ] Hook pre-commit para detectar secretos (`gitleaks` o equivalente) configurado
- [ ] `npm audit` como step en CI

**Contratos mínimos de stubs**
- [ ] `src/sources/stub.ts` exporta clase `StubDocumentSource` que implementa `DocumentSourcePort`
- [ ] `src/persistence/case-repository.ts` exporta interfaz `CaseRepository`
- [ ] `src/persistence/noop-repository.ts` exporta `NoopCaseRepository` que implementa `CaseRepository`
- [ ] `src/agents/llm/llm-adapter.ts` exporta interfaz `LLMAdapter`
- [ ] Ninguno de los stubs importa SDKs LLM reales (ni openai, ni anthropic, ni langgraph)

**CI**
- [ ] Pipeline de GitHub Actions (u equivalente) ejecuta `type-check` + `test` sin secretos externos requeridos

### Criterios de aceptación del Incremento 0

**CA-I0-01 — Estructura de directorios:**
Al correr `glob src/app src/domain src/agents src/sources src/persistence e2e` todos los directorios existen. No existe `src/web/`.

**CA-I0-02 — TypeScript compilable:**
`tsc --noEmit` termina con exit code 0 sobre el árbol de archivos del scaffolding.

**CA-I0-03 — Suite de tests inicializable:**
`vitest run` corre sin error de configuración y reporta al menos un test de humo en verde.

**CA-I0-04 — Playwright configurado:**
`playwright test --dry-run` termina sin error. `playwright.config.ts` referencia `baseURL` como variable de entorno, no hardcodeada.

**CA-I0-05 — Variables de entorno sin secretos:**
`.env.example` contiene `TRACE_VERBOSE=false`. `.env.local` está en `.gitignore`. Ningún archivo `.env` real existe en el repositorio.

**CA-I0-06 — Contrato mínimo de sources/stub:**
El módulo exporta `StubDocumentSource` con método `search(query, context): Promise<SourceEvidence[]>` donde `SourceEvidence` tiene schema Zod con `sourceId`, `excerpt`, `reliability`.

**CA-I0-07 — Contrato mínimo de persistence:**
`NoopCaseRepository` implementa `save(state): Promise<void>` y `findById(id): Promise<CaseState | null>`. Un test de humo verifica que `save` seguido de `findById` devuelve el estado guardado (en memoria, local al test).

**CA-I0-08 — Sin SDKs LLM en stubs:**
Grep sobre `src/` de imports a `openai`, `anthropic`, `@langchain`, `@langchain/langgraph` retorna cero resultados fuera de archivos explícitamente marcados `*.stub.ts` o `*.mock.ts`.

**CA-I0-09 — Pipeline de CI pasa en entorno limpio:**
`tsc --noEmit` y `vitest run` pasan en un entorno sin variables de entorno secretas configuradas.

---

## Escenarios Gherkin (Incrementos 2-3)
```gherkin
Scenario: Presupuesto con suma incorrecta (estado COMPLETE)
  Given un presupuesto de ejemplo con todas las partidas con importe y un total inconsistente
  When el usuario solicita su análisis
  Then se calcula el total desde importes estructurados en unidad menor
  And el informe destaca la diferencia sin afirmar fraude
  And budgetParseState es COMPLETE

Scenario: Presupuesto incompleto (estado PARTIAL)
  Given un presupuesto con al menos una partida sin importe confirmado
  When el usuario solicita su análisis
  Then el informe muestra el subtotal de las partidas leídas
  And el informe no compara ese subtotal con el total declarado
  And budgetParseState es PARTIAL

Scenario: Consulta con riesgo en frenos
  Given un usuario describe pérdida de líquido y mal funcionamiento del freno
  When solicita instrucciones para arreglarlo
  Then el motor bloquea las instrucciones DIY peligrosas
  And presenta derivación profesional clara
  And el output incluye policyVersion del safety gate

Scenario: Falla sin evidencia suficiente
  Given un usuario describe un ruido sin datos de inspección
  When consulta posibles causas
  Then recibe hipótesis orientativas y preguntas de seguimiento
  And no recibe un diagnóstico definitivo
```

## No alcance
Precios reales, marketplace, OCR/PDF, pagos, registro completo de talleres, rutas DIY sobre sistemas críticos, app móvil nativa, producción con IA sin evaluaciones. No deprecar entidades del modelo de dominio que las Fases 2-4 van a usar (Ajuste D).

## Checklist de entrega del MVP_01 completo
- [ ] Incremento 0: scaffolding verificado (todos los CA-I0-01 a CA-I0-09 en verde)
- [ ] Incremento 1: contratos de dominio con tests unitarios en verde
- [ ] Incremento 2: grafo con adaptador stub + tests de integración en verde
- [ ] Incremento 3: UI + API Route + tests E2E en verde (3 escenarios Gherkin)
- [ ] Seguridad revisada en cada incremento (Ajuste E)
- [ ] Accesibilidad y mobile verificadas
- [ ] Documentación y decisiones actualizadas
- [ ] Demo reproducible con casos sintéticos claramente etiquetados
