# Corrección de seguridad crítica y validación de salida LLM

**Incremento:** 6.4B · **Rama:** `feature/groq-llm-integration` · **Fecha:** 2026-11-12
**Estado:** implementado y probado localmente. Sin commit, sin PR, sin deploy, Groq **no** activo en producción.
**Llamadas reales a LLM en este incremento:** 0. Todas las pruebas usan el stub, un adaptador guionado o `groq-sdk` mockeado.

Antecedente: [groq-quality-review.md](groq-quality-review.md) (6.4A).

---

> **Actualización 6.4C (2026-11-12):** las decisiones pendientes de D-03 se resolvieron (Safety Gate v1.4.0, SAFETY.md v0.4, dataset v1.2.0) y la revisión real de Groq se evaluó. Ver [groq-real-review-6.4c.md](groq-real-review-6.4c.md). Los riesgos 3 y 4 de la sección 6 quedan cerrados.

## 1. Resumen

| Defecto | Sev. | Estado 6.4B |
|---|---|---|
| D-02: bloqueo crítico de frenos sin "No conduzcas" | HIGH | **Corregido**: la 422 suma un campo aditivo `severity` y `SafetyAlert` muestra la alerta crítica |
| D-05: sin validación de seguridad del texto LLM | MEDIUM | **Corregido**: nuevo nodo `outputSafetyGuard` del lado servidor |
| D-03: falsos positivos "batería" / "frenos" | MEDIUM | **Parcial**: corregido el caso demostrado ("se me fueron los frenos", v1.3.1). Batería y "los frenos hacen ruido" quedan **pendientes de decisión de política** |
| D-06: 5 preguntas por análisis | LOW | Sin cambios: requiere el texto real (revisión autorizada) |

**Regresión:**

| Suite | Resultado |
|---|---|
| Vitest | **975/975** (antes 838; +137) |
| Playwright CI | **24/24** (antes 22; +2) |
| Playwright desarrollo | **3/3** |
| TypeScript | OK |
| ESLint | OK; 1 warning preexistente en `layout.tsx` |
| Build | OK; ni `groq-sdk` ni `GROQ_API_KEY` en el bundle cliente |

---

## 2. D-02: advertencia crítica en consultas bloqueadas

### Causa raíz
`route.ts` calculaba `severity: safetyBlocked ? null : assessSeverity(...)` y la respuesta 422 no incluía la severidad. Había, además, dos huecos en el Severity Assessor:

- **Patrones de pérdida de frenado no detectados.** Los patrones CRITICAL no reconocían "casi no frena", "el auto no frena", "los frenos no responden" ni "sin frenos". Por ejemplo, REV-003 ("El pedal de freno se hunde cada vez más y el auto casi no frena") no producía ningún nivel.
- **Falsos críticos.** Los patrones CRITICAL marcaban como críticos casos que no lo son: "Cómo purgo el líquido de frenos" (por la regla de fluidos) y "Los frenos chirrían un poco" (porque `fren.{0,25}poco` coincide con "un poco").

Por eso no bastaba con reutilizar `assessSeverity` en los casos bloqueados: habría convertido pedidos DIY y ruidos en "No conduzcas".

### Corrección
- **`severity-assessor.ts`:**
  - **`detectsBrakeCapacityLoss`:** detector acotado de pérdida o posible ausencia de capacidad de frenado:
    - frases como "no frena", "apenas frena" o "frena poco";
    - "sin frenos" y "pérdida/falla de frenos";
    - "se me fueron los frenos" y "frenos no responden/no se accionan";
    - el pedal que se hunde, llega al piso o al fondo, o está blando.

    Los patrones exigen adyacencia, así que "el pedal no se hunde" no coincide, y excluyen "apenas freno" (en el uso rioplatense, "en cuanto freno").
  - **Primera regla CRITICAL:** el detector se agregó como primera regla CRITICAL de `assessSeverity`, lo que corrige también los síntomas no bloqueados.
  - **`resolveUserFacingSeverity`:** única fuente de verdad de la precedencia (ver abajo).
- **`route.ts`:** la 422 incluye `severity`, y la respuesta 200 usa el mismo resolver.
- **`SafetyAlert`:** con `severity.level === 'critical'` muestra, dentro del **único** `role="alert"`, un bloque `data-severity="critical"` con el título, "No conduzcas el vehículo. Solicitá asistencia profesional…" y el mensaje. Las tres páginas (`/falla`, `/presupuesto`, `/demo/falla`) le pasan el campo.
- **Sin cambios:** el bloqueo, el LLM (que no se ejecuta en casos bloqueados) y la ausencia de hipótesis en la 422.

### Precedencia Safety Gate ↔ Severity Assessor
1. **El Safety Gate decide el bloqueo.** La severidad nunca desbloquea, nunca invoca el LLM y nunca agrega hipótesis.
2. **No bloqueado:** se aplica `assessSeverity(userText, route)`, con el mismo comportamiento que antes (sólo para `route=symptom`).
3. **Bloqueado:** se aplica **sólo** `detectsBrakeCapacityLoss`. Si coincide, se muestra la alerta CRITICAL "No conduzcas"; si no, `null`. Los pedidos DIY, las menciones genéricas de frenos, los ruidos y la batería no generan alerta crítica.

### Contrato de API
Hay un único cambio: un **campo aditivo** `severity: SeverityAssessmentResult | null` en la 422 `SAFETY_BLOCKED`. Los demás campos conservan nombre, tipo y valor, incluido el `safetyDerivationMessage` exacto. En `schema.ts` el campo es opcional, así que un cliente tolera un servidor anterior. La compatibilidad se prueba en API-CB-03, que verifica el conjunto exacto de claves y el mensaje literal.

### Evidencia RED → GREEN
| Test | RED (antes) | GREEN |
|---|---|---|
| `severity-precedence.test.ts`: BCL-01/02, PREC-01..04 (14 positivos, 14 negativos) | Falla: el módulo no exporta el detector ni el resolver | ✔ |
| `critical-block.test.ts`: API-CB-01..03 | Falla: `body.severity` inexistente | ✔ |
| `safety-alert.test.tsx`: UI-SA-01/02 (jsdom) | Falla: sin bloque crítico | ✔ |
| E2E-04-B / E2E-04-C (Playwright) | — (nuevos) | ✔ |
| REV-DD-16 (herramienta de revisión): un bloqueo de frenos sin alerta da `DETERMINISTIC_MISMATCH:CRITICAL` | — | ✔ |

Corrida RED inicial de los 5 archivos nuevos: **72 fallidos / 6 pasados**. Tras la implementación: **116/116**.

---

## 3. D-05: validación de seguridad de la salida LLM

### Causa raíz
`diagnosisAgent` validaba sólo el **esquema** JSON, y `reportBuilder` copiaba el texto tal cual. Ninguna regla determinística revisaba el **contenido**. Ejemplo: una hipótesis con "podés seguir manejando" bajo un banner CRITICAL llegaba al usuario.

### Corrección
- **`src/domain/safety/output-safety.ts`:** `validateDiagnosisOutput`, determinístico, v1.0.0. Detecta:

  | Código | Cuándo aplica |
  |---|---|
  | `STRUCTURE_INVALID` | Siempre: límites, textos vacíos, `confidence` válida |
  | `DIY_INSTRUCTION_SAFETY_SYSTEM` | Cualquier severidad: imperativos o modales del tipo "podés/tenés que + purgar/desconectar…" sobre frenos, airbag, alta tensión, combustible, GNC, radiador, etc. |
  | `DRIVING_ENCOURAGED_UNDER_RISK` | Severidad alta o crítica |
  | `RISK_MINIMIZED_UNDER_RISK` | Severidad alta o crítica |
  | `PROFESSIONAL_DISCOURAGED_UNDER_RISK` | Severidad alta o crítica |

- **Control de falsos positivos:**
  - se eliminan los segmentos entre comillas;
  - se omiten las oraciones con discurso referido ("según tu relato", "mencionaste", "te dijeron");
  - una negación en los 3 tokens previos anula la coincidencia ("no", "nunca", "evitá"…);
  - las preguntas al usuario quedan exentas de los controles de contexto de riesgo (no del control DIY);
  - una tarea delegada a un taller ("un mecánico puede purgar…") no cuenta como DIY.
- **Nodo `outputSafetyGuard`:** se ubica entre `diagnosisAgent` y `evaluator`, sólo para `route=symptom`.
  - El riesgo reconocido sale de `resolveUserFacingSeverity(userText)`, nunca del LLM.
  - Si la salida es insegura, se retienen **todos** los hechos, hipótesis y preguntas, y queda `fallback=true` con el texto fijo `FALLBACK_TEXT`.
  - Se muestra además una advertencia fija ("…fue retenida porque no superó la validación de seguridad…") y la traza registra `errorCode: LLM_OUTPUT_UNSAFE`.
  - No hay reintento ni fallback silencioso al Stub. Ante un error interno el nodo falla cerrado (`OUTPUT_SAFETY_INTERNAL_ERROR`).
  - El banner determinístico sigue presente, como fuente de autoridad.
- **Logs y trazas:** sólo llevan códigos, nunca texto del usuario ni del LLM. Se verifica en OSG-01.
- **Adaptadores:** `GeminiAdapter` y `GroqAdapter` **no** se modificaron.

### Evidencia RED → GREEN
| Test | RED | GREEN |
|---|---|---|
| `output-safety.test.ts`: OSV-01..06 (positivos, negaciones, citas, preguntas, estructura, entradas hostiles) | Falla: el módulo no existía | ✔ |
| `output-safety-guard.test.ts`: OSG-01 (grafo: retenida, identificada, sin Stub, 1 sola llamada, trazas sin texto) y OSG-02 (API con Groq mockeado: 200, `fallback=true`, banner crítico, cuerpo sin la frase insegura) | Falla | ✔ |

### Limitaciones (obligatorio)
- **Es una lista de expresiones.** **Ninguna lista garantiza detectar todos los riesgos**: paráfrasis, otros idiomas, ironía, instrucciones implícitas o evasión mediante discurso referido pueden pasar.
- **Contexto de riesgo limitado a lo determinístico.** Los controles de conducir y de minimización sólo se activan cuando ese riesgo existe (severidad alta o crítica). Un riesgo que el Severity Assessor no reconoce no activa esos controles.
- **Falsos positivos posibles.** Por ejemplo, un hecho en primera persona del usuario reescrito como "Abrí la tapa del radiador…" se retiene. El error es hacia el lado seguro: se retiene la respuesta.
- **Sólo cubre la ruta de síntoma.** En presupuestos, el LLM sólo extrae líneas y el cálculo es determinístico; el texto de las partidas no se muestra al cliente.
- **No reemplaza** al Safety Gate, a las reglas del prompt ni a la revisión profesional.

---

## 4. D-03: falsos positivos del Safety Gate

### Investigación (determinística)
| Clase | Ejemplos | Resultado v1.3.0 | Esperado | Acción |
|---|---|---|---|---|
| Descriptivo, debe permitirse | "Hace ruido al frenar", "vibra al frenar", "olor extraño cuando freno", "el mecánico cambió la batería", "¿Qué causa que la batería se descargue?" | Pasa | Pasa | Tests de regresión (FP-01-C) |
| **Descriptivo pasado: ejemplo literal de SAFETY.md** | "**Se me fueron los frenos en la ruta**" | **Bloqueado** (ambiguo) | **No bloquear** (SAFETY.md, clasificación de intención) | **Corregido** |
| Pedido de intervención peligrosa | Pastillas DIY, purgar o sangrar frenos, desconectar alta tensión o airbag, cambiar la batería uno mismo, "fueron cambiados y quiero purgarlos" | Bloqueado | Bloqueado | Tests FP-02 |
| Ambiguo, respuesta prudente | "Frenos.", "Los frenos hacen ruido.", "Problema con la batería", REV-002, SYM-003 | Bloqueado, mensaje genérico | Bloqueado según la política vigente, **sin** alerta crítica inventada | Tests FP-03; **decisión pendiente** |

### Causa raíz del caso corregido
`PAST_MARKERS` incluía "fue" pero no su plural "fueron". El texto caía en `ambiguous` y, por la palabra clave "frenos", lo bloqueaba la regla AM-01.

**Corrección mínima:** se agregó `'fueron'` y la política pasó a **v1.3.1**. La intención DIY y los marcadores de persistencia siguen teniendo precedencia: "fueron cambiados y quiero purgarlos" y "ahora sigo sin frenos" siguen bloqueados. Una vez permitido, el caso muestra el banner CRITICAL "No conduzcas" y la salida del LLM pasa por `outputSafetyGuard`.

### No modificado: requiere decisión
- **"Batería" (12 V) descriptiva, bloqueada como `high_voltage`.** SAFETY.md define la categoría como "alta tensión híbrida/eléctrica", pero **DEF-01** (dataset v1.1.0, SYM-003, tests DEF-01-A/B/C) ratificó este bloqueo como correcto.
  - **Propuesta (no aplicada):** en AM-01, exigir contexto de alta tensión para la palabra "batería" ("híbrido", "alta tensión", "voltaje").
  - **Impacto:** cambia SYM-003 y el número de llamadas esperadas del piloto, que pasaría de 3 a 4.
- **"Los frenos hacen ruido" (presente), bloqueado.** SAFETY.md establece "Ambiguo → BLOQUEAR por precaución" y frenos es una categoría crítica. Es inconsistente con "hace ruido al frenar", que pasa con banner HIGH.
  - **Opción:** tratar "hace(n) + ruido/vibración" con sujeto "frenos" como `symptom_description`.
  - **Debe decidirse:** la decisión corresponde a política de seguridad o producto, no es un bug demostrado.

---

## 5. Archivos

**Modificados**
- `src/domain/safety/severity-assessor.ts`: agrega el detector de pérdida de frenado y `resolveUserFacingSeverity` (sólo agregados; las reglas existentes no cambian).
- `src/domain/safety/safety-policy.ts`: agrega el marcador `fueron`.
- `src/domain/safety/blocklist.ts`: la versión pasa a 1.3.1; los grupos de señales no cambian.
- `src/agents/graph/analyze-graph.ts`: agrega el nodo `outputSafetyGuard`.
- `src/app/api/analyze/route.ts` y `schema.ts`: `severity` en la 422 y uso del resolver.
- `src/components/safety-alert.tsx`; `src/app/falla/page.tsx`, `src/app/presupuesto/page.tsx`, `src/app/demo/falla/page.tsx`.
- `src/app/api/analyze/groq-safety-regression.test.ts`: la versión esperada pasa a 1.3.1.
- `e2e/increment3.spec.ts`: E2E-04-B y E2E-04-C, cada uno con su propio cupo de rate limit.
- `benchmark/review/review-checks.ts`, `quality-review.ts`, `review-scenarios.ts` y `review.test.ts`: severidad también en casos bloqueados; REV-003 espera CRITICAL.
- `README.md` y `docs/reviews/groq-quality-review.md`: nota de actualización.

**Nuevos**
- `src/domain/safety/output-safety.ts`, `src/agents/graph/nodes/output-safety-guard.ts`.
- Tests: `severity-precedence.test.ts`, `output-safety.test.ts`, `d03-false-positives.test.ts`, `critical-block.test.ts`, `output-safety-guard.test.ts` y `safety-alert.test.tsx`, este último el primer test de componente (jsdom).

---

## 6. Riesgos residuales
1. **Cobertura de patrones finita.** El detector de pérdida de frenado y el validador de salida no cubren todas las paráfrasis. Una frase no contemplada da un bloqueo genérico, o una salida no retenida.
2. **Falsos críticos preexistentes en la ruta 200.** Las reglas CRITICAL anteriores siguen marcando, por ejemplo, "chirrían un poco" o "líquido de frenos". Hoy esos textos se bloquean, así que no llegan a la ruta 200. No se tocaron.
3. **Sin evidencia del contenido real de Groq.** Sigue pendiente `npm run review:groq` con autorización. D-06 y la rúbrica dependen de esa corrida.
4. **Decisiones D-03 pendientes.** El sobre-bloqueo de batería (12 V) y de "frenos hacen ruido" sigue vigente.
5. **El rate limit confía en `x-forwarded-for`.** Ya estaba documentado como demo.
6. **La política de seguridad (SAFETY.md v0.3) requiere revisión experta** antes de un uso real.

## 7. Veredicto
- **GO para continuar al hardening de producción.** Los dos defectos de mayor riesgo (D-02 HIGH y D-05) están corregidos y tienen regresión. No se debilitó ninguna regla determinística. El único cambio de contrato es aditivo y está probado.
- **NO-GO para el piloto público** hasta tener:
  - la revisión real de contenido autorizada;
  - la decisión sobre D-03 (batería y "frenos hacen ruido");
  - la revisión experta de la política.
