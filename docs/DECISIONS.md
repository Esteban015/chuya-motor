# DECISIONS — Chuya Motor MVP_01

Versión v1.0 — 2026-11-04. Registra decisiones técnicas aprobadas para el Incremento 0 y siguientes.

---

## D-1 Safety gate determinístico con paráfrasis y negaciones

**Estado:** aprobada.

El safety gate es una función pura determinística que evalúa el texto del usuario antes de cualquier llamada LLM. No depende exclusivamente de coincidencias literales: detecta paráfrasis comunes y distingue intención DIY de descripción de estado.

### Pipeline de evaluación (cuatro etapas)

1. **Normalización:** lowercase, eliminar tildes, colapsar signos de puntuación, tokenizar, aplicar stemmer de reglas fijas para español rioplatense.
2. **Búsqueda de frases exactas:** contra `exactPhrases` de cada grupo de señales del catálogo versionado.
3. **Co-ocurrencia de stems en ventana de 12 tokens:** pares de stems que juntos activan una señal aunque no haya frase exacta.
4. **Clasificación de intención:** determina si el match implica intención DIY o descripción de hecho pasado/contexto profesional.

### Clasificación de intención

| Clase | Criterio | Resultado |
|---|---|---|
| `diy_intent` | Presencia de marcadores de intención (quiero, cómo, puedo, voy a, necesito) en la misma ventana que la señal | BLOQUEAR |
| `professional_context` | Presencia de agente profesional (mecánico, taller, técnico) + tiempo pasado (arregló, cambió) | NO bloquear |
| `past_description` | Señal presente pero sin marcadores de intención ni agente profesional | NO bloquear |
| `ambiguous` | Ninguna regla con certeza suficiente | BLOQUEAR por precaución |

La regla `ambiguous → BLOQUEAR` es deliberada: los falsos negativos sobre sistemas críticos son incidentes de mayor severidad que los falsos positivos.

### Política versionada

La política es un archivo JSON versionado (ej. `safety-policy-v0.2.json`) que contiene grupos de señales por categoría crítica, catálogo DIY aprobado y catálogo DIY bloqueado. Nunca se actualiza en caliente sin deploy verificado.

**Output obligatorio del gate:**
```
{ blocked, reasons, policyVersion, catalogVersion, matchedSignals,
  negationApplied, intentClassification, coverageDisclaimer, derivationMessage? }
```

### Catálogo DIY

**Catálogo de bloqueos** (MVP_01 — necesario desde Incremento 2): lista de categorías y patrones bloqueados con variantes. Nunca expuesto en el bundle del cliente. Ubicación: `src/domain/safety/blocklist.ts`.

**Catálogo de guías aprobadas** (Fase 2+, FR-11): tareas de bajo riesgo con procedimiento revisado por profesional, EPP, condiciones de parada y referencia técnica. No se sirve en MVP_01.

Criterios para incluir una tarea en el catálogo aprobado: no involucra sistemas de SAFETY.md, se puede detener de forma segura ante falta de EPP, no requiere trabajar debajo del vehículo solo con gato, existe referencia revisada con licencia compatible.

### Cobertura no exhaustiva (obligatorio)

El output del gate incluye siempre el campo `coverageDisclaimer`:
> "Este análisis automático no reemplaza la inspección de un profesional. Las reglas de seguridad cubren señales conocidas pero no garantizan la detección de todos los riesgos posibles."

Este texto es literal fijo en la política, no generado por LLM.

---

## D-2 Formulario progresivo sin conversación multi-turno

**Estado:** aprobada.

El primer MVP recolecta datos mediante un formulario progresivo de un único envío. No hay conversación persistente entre requests.

**Campos mínimos para cubrir FR-01:**

| Campo | Obligatorio | Efecto si se omite |
|---|---|---|
| Síntoma principal (texto libre, mínimo 10 chars) | Sí | No se puede iniciar el flujo |
| Tipo de vehículo (auto / moto / camioneta) | Sí | Safety gate no puede discriminar por tipo |
| Condición de ocurrencia (siempre / al frenar / al acelerar / intermitente / al arrancar) | Sí | Hipótesis demasiado vagas |
| Marca, modelo, año | No | Sistema marca `missingInformation` en informe; sin pasos DIY específicos |
| Kilometraje aprox. | No | Hipótesis de desgaste menos precisas |
| Nivel de experiencia (novice / intermediate / experienced) | No | Se asume `novice`; derivación más conservadora |
| Presupuesto tope (solo en ruta de presupuesto) | No | No aplica a ruta de síntomas |

**El aviso D-4 debe mostrarse en el mismo formulario, no en pantalla separada.**

---

## D-3 Precisión monetaria

**Estado:** aprobada.

- Importes se representan como enteros en unidad menor (centavos) + código ISO 4217 de 3 caracteres.
- Nunca usar `float` para totalización; nunca usar `0.1 + 0.2`.
- El `computedTotal` se devuelve como string con 2 decimales fijos solo en la capa de presentación.
- Validar rango máximo configurable (ej. ARS 999.999.999); superar el límite marca la partida como no confirmada con warning `AMOUNT_EXCEEDS_LIMIT`.
- Una partida con importe cero (`0`) es válida y confirmada. No es `null`.
- Una partida sin importe es `null` (estado `missing`).

**Para MVP_01:** `{ amount: number; currency: 'ARS' | 'USD' }` donde `amount` es entero en centavos. No se requiere `BigDecimal` ni librería externa en MVP_01.

---

## D-4 Aviso de privacidad (texto aprobado)

**Estado:** aprobada. Texto literal a usar en la UI:

> "Chuya Motor está en desarrollo. Esta versión demostrativa utiliza datos de prueba. No ingreses información personal, patentes, documentación privada ni información sensible. Las orientaciones no sustituyen una inspección profesional."

Este aviso es **informativo**, no es un gate de consentimiento. MVP_01 no requiere checkbox ni almacenamiento de consentimiento.

---

## D-5 Fallback ante indisponibilidad del LLM (texto aprobado)

**Estado:** aprobada. Texto literal a usar cuando el proveedor LLM no está disponible:

> "No pudimos completar el análisis automático. No contamos con información suficiente para emitir una orientación confiable. Podés volver a intentarlo o consultar con un profesional."

Cuando `fallback: true`, el informe no contiene hipótesis generadas ni estimaciones de costo. El safety gate (determinístico) puede haber actuado antes; su resultado es independiente del fallback LLM.

---

## Ajuste A — Estados de presupuesto: COMPLETE, PARTIAL, INVALID

**Estado:** aprobada.

El análisis de presupuesto distingue tres estados con semánticas distintas. **Nunca comparar subtotales parciales con el total declarado.**

| Estado | Condición | Comportamiento |
|---|---|---|
| `COMPLETE` | Todas las partidas tienen importe confirmado y moneda válida | Comparar `computedTotal` con `declaredTotal`; emitir `discrepancy` si difieren |
| `PARTIAL` | Al menos una partida confirmada y al menos una sin importe | Mostrar subtotal de partidas confirmadas; marcar `computedTotalIsPartial: true`; NO comparar con `declaredTotal`; emitir `missing_amounts` |
| `INVALID` | Sin partidas legibles, sin moneda determinable o error de parseo | No emitir ningún número como total; solicitar datos estructurados |

La transición de estados es una función pura determinística sobre el output tipado del parser. El parser puede usar LLM para extracción; la clasificación del estado no.

**Campo `BudgetParseState.completenessStatus`** debe agregarse a `CaseState.budgetFindings` y al schema Zod de `BudgetFinding`.

---

## Ajuste B — Persistencia: sin almacenamiento cross-request en MVP_01

**Estado:** aprobada.

MVP_01 ejecuta el caso completo en un único request POST. No hay recuperación de `caseId` desde repositorio en memoria entre requests ni instancias serverless.

**`caseId`** es un UUID v4 generado al inicio del handler. Sirve para correlacionar logs y trazas dentro de ese request. No se expone como recurso recuperable; no existe `GET /api/cases/:caseId` en MVP_01.

**`NoopCaseRepository`** implementa la interfaz `CaseRepository` con métodos no-op. El grafo la recibe como dependencia inyectada. El binding cambia en Fase 2 sin modificar el grafo.

**Contrato del endpoint único:**
- `POST /api/analyze` — recibe `AnalyzeInput`, ejecuta el grafo completo, devuelve `AnalyzeOutput`.
- Errores: 400 (validación de input), 422 (bloqueado por safety gate), 500 (fallo de infraestructura).
- El proveedor LLM no disponible produce `AnalyzeOutput` con `fallback: true` y el texto de D-5, no un 500 silencioso.

---

## Ajuste C — Observabilidad: metadatos mínimos sin contenido sensible

**Estado:** aprobada.

**TraceMetadata** por nodo contiene únicamente campos estructurales:
`traceId`, `nodeId`, `timestamp`, `durationMs`, `status`, `llmCalled`, `llmModel?`, `retryCount`, `policyVersion?` (solo en `safetyGate`), `dataLabel`, `errorCode?`, `fallbackActivated`.

**Nunca en trazas:** texto libre del usuario, hashes de texto libre, contenido del output LLM, PII, número de patente/VIN, texto de partidas del presupuesto en texto libre, contenido de prompts, tokens de sesión.

**Hashes de texto libre se eliminan** del diseño. No protegen privacidad (reversibles con rainbow tables para texto corto) y agregan complejidad sin beneficio.

**TRACE_VERBOSE:** solo activo cuando `TRACE_VERBOSE=true` AND `NODE_ENV !== 'production'`. La conjunción es estricta: `NODE_ENV=production` desactiva TRACE_VERBOSE aunque la variable esté seteada. TRACE_VERBOSE solo afecta `console.debug` del servidor; no modifica qué campos se persisten permanentemente. La función `persistTrace(metadata: TraceMetadata)` no recibe ningún parámetro adicional ni lee TRACE_VERBOSE.

---

## Ajuste D — Preservar visión integral de Chuya Motor

**Estado:** aprobada.

El MVP_01 es un recorte temporal. Ningún incremento puede deprecar entidades del modelo de dominio que las Fases 2-4 van a usar. La visión completa incluye:
- Diagnóstico orientativo con distinción de evidencias, hipótesis e incertidumbres.
- Asistencia DIY segura para distintos niveles de experiencia (FR-11, Fase 2).
- Historial de vehículo e historial de reparaciones (FR-09, Fase 2).
- Costos verificados con fuente, región y fecha (FR-12, Fase 2).
- Chuya Taller: presupuestos auditables y documentación (FR-13, Fase 3).
- Chuya Confianza: perfiles de talleres por especialidad y reputación responsable (FR-14/15, Fase 4).

---

## Ajuste E — Seguridad desde cada incremento

**Estado:** aprobada.

Los controles de seguridad se aplican desde el primer incremento, no solo en el hardening final.

**Incremento 0 (mínimos):** `.gitignore` con secretos excluidos, `.env.example` sin secretos reales con clave `TRACE_VERBOSE=false`, headers HTTP de seguridad en `next.config.ts` (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy), hook pre-commit para detectar secretos (`gitleaks` o equivalente), lock file comiteado, `npm audit` en CI.

**Incremento 1 (domain):** `safety-policy.ts` sin efectos secundarios ni imports de red; `budget.ts` sin floats para totalización; schemas Zod con `max()` en todos los campos de texto libre; `strict: true` en tsconfig.

**Incremento 2 (grafo):** safety gate ejecutado antes de cualquier llamada LLM; `safety.blocked` inmutable después del gate; tests de bloqueo obligatorios antes de merge; test double del mock que devuelve output inválido para verificar validación Zod.

**Incremento 3 (UI + API Route):** validación Zod del body antes de pasarlo al grafo; rate limiting por IP; `Cache-Control: no-store` explícito en Route Handlers; CORS explícito para el dominio del demo.

---

## Ajuste F — Estructura canónica Next.js App Router

**Estado:** aprobada.

Se adopta `src/app/` como posición canónica del App Router de Next.js. La estructura `src/web/app/` del plan anterior es ambigua y Next.js no la reconoce automáticamente. La separación entre UI y dominio se logra por convención de módulos dentro de `src/`.

**Árbol canónico:**
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
e2e/                ← tests Playwright (fuera de src/)
```

**Tests unitarios/integración:** co-ubicados con el archivo que prueban (`*.test.ts` junto al archivo). `vitest.config.ts` con `include: ['src/**/*.test.ts']`.

**Tests E2E:** en `e2e/` en la raíz. `playwright.config.ts` y `vitest.config.ts` en la raíz.

---

## Contradicciones resueltas

| ID | Descripción | Resolución |
|---|---|---|
| C-1 | `sources/` no tiene datos reales disponibles | `sources/stub.ts` hasta Fase 2; contrato `DocumentSourcePort` definido desde Incremento 0 |
| C-2 | Dos validadores (API layer + nodo del grafo) | Validación HTTP en Route Handler (input estructural, Zod, retorna 400); nodo `validator` en el grafo (consistencia cruzada de CaseState). Son distintos y complementarios. |
| C-3 | 14 entidades en ARCHITECTURE.md vs 5 necesarias en MVP_01 | 5 entidades en MVP_01: Vehicle, Case, Budget, BudgetLine, SafetyPolicy. Las demás (Workshop, RepairJob, Feedback, etc.) se activan en Fases 2-4. No deprecar las interfaces. |
| C-4 | LangGraph con estado persistido vs serverless sin persistencia entre requests | MVP_01: estado de caso vive solo dentro del request. `NoopCaseRepository`. Fase 2: `PostgresCaseRepository`. El grafo no cambia. |

---

## Brechas artefactuales pendientes (antes de Incremento 1)

Estos artefactos no son entregables de Incremento 0 pero deben decidirse antes de comenzar Incremento 1:

1. **Catálogo de bloqueos del safety gate** (`src/domain/safety/blocklist.ts`): lista negra versionada con grupos de señales, stems, frases exactas y pares de co-ocurrencia. Referenciado por D-1 y CA de FR-03.
2. **Schema Zod de `CaseState`** con `budget.completenessStatus: 'COMPLETE' | 'PARTIAL' | 'INVALID'`.
3. **Definición de `dato sensible` para trazas**: lista de rutas de campos prohibidos en trazas, usada por el scrubber de observabilidad.
4. **Criterios de rango monetario**: constante `MAX_AMOUNT_MINOR_UNIT` documentada en el schema Zod de `BudgetLine`.

---

## Riesgos residuales (post-decisiones)

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R-01 | Falso negativo en safety gate por paráfrasis no catalogada | Alta | Archivo de cobertura declarada; tests obligatorios de señales, paráfrasis y negaciones antes de merge; revisar falsos negativos como incidente prioritario |
| R-02 | Catálogo de señales expuesto permite mapear bypasses | Alta | Catálogo interno al servidor; no en bundle del cliente |
| R-03 | LLM modifica `safety.blocked` en CaseState | Alta | Campo inmutable por diseño de tipos; test que verifica que ningún nodo posterior muta el campo |
| R-04 | TRACE_VERBOSE en entorno de demo expone texto del usuario | Alta | Conjunción estricta; scrubber independiente del modo; test de regresión en CI |
| R-05 | Logs del servidor capturan texto libre del usuario | Alta | Logger con scrubber; linter rule que prohíbe `console.log` con objetos de estado |
| R-06 | Response cache de Next.js sirve datos de un usuario a otro | Alta | `Cache-Control: no-store` explícito desde Incremento 3 |
| R-07 | mock_adapter oculta que el validador Zod no maneja output mal formado | Media | Test double que devuelve output inválido; verificar activación del fallback D-5 |
| R-08 | Fingerprinting de usuario por metadatos mínimos | Media | Desconectar metadatos de vehículo de identificadores de sesión/IP |
| R-09 | Catálogo DIY aprobado interpretado como producto embebido (scope creep) | Media | Separar formalmente catálogo de bloqueos (MVP_01) de guías aprobadas (Fase 2/FR-11) |
| R-10 | Paráfrasis interpretada como motor NLP completo (scope creep) | Media | El safety gate cubre un conjunto finito documentado; cualquier síntoma no clasificado va al agente de diagnóstico |
| R-11 | Input sin límite de longitud permite payloads grandes | Media | `max()` en todos los campos de texto libre desde Incremento 1 |

---

Consultar [ARCHITECTURE.md](ARCHITECTURE.md), [AGENT_ORCHESTRATION.md](AGENT_ORCHESTRATION.md), [SAFETY.md](SAFETY.md) y [MVP_01.md](MVP_01.md) para el detalle de cada módulo afectado.
