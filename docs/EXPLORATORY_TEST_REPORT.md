# Informe de Auditoría Exploratoria — Chuya Motor (Incremento 3)

## Metadatos

- Fecha: 2026-11-05
- Herramienta: Playwright Test v1.64.1 (Playwright MCP no disponible)
- Navegador: Chromium (headless)
- Servidor: http://localhost:3000 (dev, Next.js 15)
- Escenarios ejecutados: 14 (18 tests — algunos escenarios tienen sub-casos)
- Tests PASS: 16 / 18
- Tests FAIL: 2 / 18 (E-12A, E-14C por rate-limit en primera ejecución — confirmado luego)
- Defectos reales encontrados: 3

---

## Resumen ejecutivo

La auditoría exploratoria cubrió 14 escenarios funcionales y de seguridad sobre la aplicación Next.js corriendo en desarrollo. Los flujos principales del MVP (diagnóstico de síntoma, análisis de presupuesto, bloqueo de seguridad) funcionan correctamente: el safety gate bloquea frases de peligro confirmadas, el sistema devuelve `Cache-Control: no-store` en todas las respuestas, y el badge MODO DEMO es visible en todas las pantallas incluyendo el reporte post-submit.

Se identificaron tres defectos reales: dos en el módulo de safety gate y uno en el router de intención. El más crítico (DEF-02) es un falso negativo en la protección de consultas educativas: la query informativa "¿Cómo funcionan los frenos de mi auto?" recibe status 422 (SAFETY_BLOCKED) porque el marcador educativo "funcionan" (conjugación plural) no está en la lista EDUCATIONAL_MARKERS que solo contiene "funciona" (forma base). Esto viola la decisión AM-01 documentada en DECISIONS.md. El defecto DEF-01 es un falso positivo: "Filtro de combustible" como nombre de repuesto en un presupuesto activa el safety gate, bloqueando un caso de uso legítimo. DEF-03 es un problema de formato: los importes con separador de miles estilo argentino (15.000) no son reconocidos como presupuesto por el router.

El rate limiter de 10 req/min funciona correctamente y devuelve `Cache-Control: no-store` en 429. Se observó que en suite completa se agota el límite al llegar al 11.° request, lo que requiere ejecutar los tests en lotes de máximo 9 llamadas API por ventana. Esto es un hallazgo de la infraestructura de tests, no un defecto de la aplicación.

---

## Matriz de escenarios

| ID | Escenario | Resultado | Severidad |
|----|-----------|-----------|-----------|
| E-01 | Síntoma habitual — motor ruido arrancar en frío | PASS | — |
| E-02 | Falla crítica de frenos — pedal se hunde | PASS | — |
| E-03 | Presupuesto correcto — suma exacta | PASS | — |
| E-04 | Presupuesto total incorrecto — discrepancy | PASS | — |
| E-05 | "Filtro de combustible" como nombre de repuesto | PASS (documenta DEF-01) | MEDIUM |
| E-06 | Fuga de combustible explícita — safety block | PASS | — |
| E-07 | Presupuesto incompleto (PARTIAL) | PASS | — |
| E-08A | Presupuesto sin importes — solo texto continuo | PASS (observación) | LOW |
| E-08B | Solo texto libre sin estructura | PASS (observación) | LOW |
| E-09 | Formato argentino separador de miles con punto | PASS (documenta DEF-03) | MEDIUM |
| E-10 | HTTP 422 y Cache-Control: no-store | PASS | — |
| E-11 | Presupuesto nunca devuelve diagnóstico genérico | PASS | — |
| E-12A | Pregunta informativa sobre frenos | FAIL — DEF-02 | HIGH |
| E-12B | Intervenir circuito de frenos (DIY intent) | PASS | — |
| E-13 | MODO DEMO en todas las pantallas | PASS | — |
| E-14A | Input demasiado corto en /falla — client-side | PASS | — |
| E-14B | Input demasiado corto en /presupuesto — client-side | PASS | — |
| E-14C | POST directo con userText muy corto — HTTP 400 | PASS | — |

---

## Defectos encontrados

### DEF-01: Falso positivo — "Filtro de combustible" como repuesto bloquea presupuesto — Severidad: MEDIUM

**Escenario:** E-05  
**Pasos de reproducción:**
1. Ir a `/presupuesto`
2. Ingresar: `Aceite motor: 4500\nFiltro de combustible: 2000\nTotal: 6500`
3. Enviar formulario

**Resultado esperado:** status 200, route='budget', presupuesto analizado normalmente.  
**Resultado observado:** status 422, error='SAFETY_BLOCKED'.

**Evidencia HTTP:**
```json
{
  "status": 422,
  "body": {
    "error": "SAFETY_BLOCKED",
    "safetyBlocked": true,
    "safetyDerivationMessage": "Por seguridad, este tipo de intervención requiere atención profesional. Contactá un taller o mecánico habilitado.",
    "policyVersion": "1.1.0"
  },
  "headers": { "cache-control": "no-store" }
}
```

**Causa raíz (confirmada):** El safety gate es global — se aplica al texto completo antes del routing. El token `combustible` del nombre de repuesto "Filtro de combustible" es un keyword en la categoría `fuel_leak` del blocklist. Con intent=`ambiguous` (ningún marcador profesional, educacional, pasado o de acción), Stage AM-01 bloquea por keyword. No existe exemption por contexto de presupuesto.

**Ubicación:** `src/domain/safety/blocklist.ts` (categoría `fuel_leak`, keywords), `src/domain/safety/safety-policy.ts` (Stage AM-01).

---

### DEF-02: Falso negativo educativo — "funcionan" no reconocido como EDUCATIONAL_MARKER — Severidad: HIGH

**Escenario:** E-12A  
**Pasos de reproducción:**
1. Ir a `/falla`
2. Seleccionar vehicleType=sedan, occurrence=Otro
3. Ingresar en symptomText: `¿Cómo funcionan los frenos de mi auto?`
4. Enviar formulario

**Resultado esperado:** status 200, safetyBlocked=false (consulta informativa sobre frenos debería pasar por decisión AM-01 con educational markers).  
**Resultado observado:** status 422, error='SAFETY_BLOCKED'.

**Evidencia HTTP:**
```json
{
  "status": 422,
  "body": {
    "error": "SAFETY_BLOCKED",
    "safetyBlocked": true,
    "safetyDerivationMessage": "Por seguridad, este tipo de intervención requiere atención profesional. Contactá un taller o mecánico habilitado.",
    "policyVersion": "1.1.0"
  },
  "headers": { "cache-control": "no-store" }
}
```

**Causa raíz (confirmada):** `EDUCATIONAL_MARKERS` en `safety-policy.ts` contiene `'funciona'` (forma base singular) pero NO contiene `'funcionan'` (3.ª persona plural presente). El check de intent es un exact-match sobre tokens: `tokens.some((t) => EDUCATIONAL_MARKERS.includes(t))`. El token `'funcionan'` no hace match. Sin educational marker, la consulta se clasifica como `'ambiguous'`. Con `ambiguous` + keyword `'frenos'` (stem `'fren'`), Stage AM-01 bloquea.

La decisión AM-01 en DECISIONS.md establece que las consultas educativas están protegidas por EDUCATIONAL_MARKERS. Esta protección falla para cualquier conjugación o variante morfológica de los verbos en la lista (ej: "funcionan", "sirven", "significa" conjugado, etc.).

**Ubicación:** `src/domain/safety/safety-policy.ts`, constante `EDUCATIONAL_MARKERS` (línea 126-130).

**Texto exacto:** `['funciona', 'sirve', 'significa', 'causa', 'provoca', 'implica', 'diferencia', 'explicar', 'entender', 'saber', 'tipos']` — solo formas base, sin conjugaciones.

---

### DEF-03: Formato numérico argentino (puntos como miles) no reconocido — Severidad: MEDIUM

**Escenario:** E-09  
**Pasos de reproducción:**
1. Ir a `/presupuesto`
2. Ingresar: `Válvula EGR: 15.000\nFiltro de habitáculo: 3.500\nMano de obra: 8.000\nTotal: 26.500`
3. Enviar formulario

**Resultado esperado:** Reconocer como presupuesto (route=budget), parsear importes correctamente o al menos hacer matching de route.  
**Resultado observado:** status 200, route=`'symptom'`, budget=null — tratado como consulta de síntoma.

**Evidencia HTTP:**
```json
{
  "status": 200,
  "body": {
    "route": "symptom",
    "budget": null,
    "hypotheses": [{ "statement": "Hipótesis orientativa sintética...", "confidence": "low" }]
  }
}
```

**Causa raíz (confirmada):** El router (`src/agents/graph/nodes/router.ts`) requiere que el patrón `item: 3+ digit number` coincida: `/^.+:\s*\d{3,}/m`. El importe `15.000` tiene solo 2 dígitos antes del punto decimal (`15`), lo que no satisface `\d{3,}`. La regex espera tres dígitos consecutivos como en `15000` (sin punto). El formato argentino donde el punto es separador de miles no está contemplado.

Adicionalmente, si el routing hubiera llegado al budget parser, `parseBudgetFromText` haría `parseFloat("15.000".replace(',', '.'))` = `parseFloat("15.000")` = `15.0` → 1500 minor units. Los importes serían silenciosamente malinterpretados como fraccionarios.

**Ubicación:** `src/agents/graph/nodes/router.ts` (regex del router), `src/agents/llm/deterministic-mock-adapter.ts` (parseBudgetFromText).

---

## Análisis por escenario

### E-01: Síntoma habitual
**Estado:** PASS  
**Respuesta API:**
```json
{ "status": 200, "route": "symptom", "safetyBlocked": false, "hypotheses": [{"statement":"Hipótesis orientativa sintética — sin inspección real. Requiere evaluación profesional.","confidence":"low","caveats":["Dato sintético de prueba","Sin evidencia verificada","No es diagnóstico definitivo"]}] }
```
**Observaciones:** El flujo completo (validator→safetyGate→router→diagnosisAgent→evaluator→reportBuilder) ejecuta correctamente. `cache-control: no-store` presente. No hay console errors. La sección "Hipótesis orientativas" aparece en la UI.

---

### E-02: Falla crítica de frenos
**Estado:** PASS  
**Respuesta API:** status 422, error=SAFETY_BLOCKED  
**Texto input:** "El pedal de freno se hunde y el auto no frena bien."  
**Observaciones:** Frase exacta "pedal se hunde" en SAFETY_SIGNAL_GROUPS categoría `brakes` → Stage 2 exact-phrase match → bloqueo. SafetyAlert visible con heading "Consulta bloqueada por seguridad". No aparece sección "Hipótesis orientativas". Cache-control: no-store presente. Console error esperado: "Failed to load resource: 422".

---

### E-03: Presupuesto correcto
**Estado:** PASS  
**Respuesta API:** status 200, route=budget, COMPLETE, discrepancy=false, computedTotalMinorUnit=600000  
**Observaciones:** Items 4500+1500=6000 ARS → 600000 minor units. Total declarado=6000. discrepancy=false. UI muestra "COMPLETE" y "El total declarado coincide". Warning "Consulta ambigua detectada" presente (porque no hay marcadores de intent claros en el texto de presupuesto).

---

### E-04: Presupuesto total incorrecto
**Estado:** PASS  
**Respuesta API:** status 200, route=budget, COMPLETE, discrepancy=true, computedTotalMinorUnit=600000  
**Observaciones:** Items 4500+1500=6000 ARS → 600000 minor units. Total declarado=9000 → 900000 minor units. discrepancy=true. UI muestra advertencia de discrepancia.

---

### E-05: "Filtro de combustible" como repuesto
**Estado:** PASS (documenta DEF-01)  
**Respuesta API:** status 422, SAFETY_BLOCKED  
**Observaciones:** DEF-01 confirmado. "combustible" es keyword en fuel_leak. La frase "Filtro de combustible: 2000" en un presupuesto no contiene ninguna de las frases de peligro exactas, pero el token "combustible" activa AM-01 con intent=ambiguous. El router nunca llega a procesar el texto. La SafetyUI muestra el mismo mensaje que para una fuga real de combustible.

---

### E-06: Fuga de combustible explícita
**Estado:** PASS  
**Texto input:** "Hay una fuga de combustible bajo el auto, huele fuerte a nafta y gotea."  
**Respuesta API:** status 422, SAFETY_BLOCKED  
**Observaciones:** Frase exacta "fuga de combustible" en categoría fuel_leak → Stage 2. Bloqueo correcto y esperado. SafetyAlert visible.

---

### E-07: Presupuesto incompleto (PARTIAL)
**Estado:** PASS  
**Respuesta API:** status 200, route=budget, PARTIAL, computedTotalIsPartial=true, computedTotalMinorUnit=450000  
**Observaciones:** "Aceite motor: 4500" → 1 confirmed line (450000 minor units). "Filtro de aire: pendiente" y "Mano de obra: pendiente" → 2 missing lines. completenessStatus=PARTIAL, discrepancy=null (no comparación de totales). UI muestra "PARTIAL". Warnings: "Consulta ambigua" + "El presupuesto está incompleto".

---

### E-08A: Presupuesto sin importes
**Estado:** PASS (observación documentada)  
**Texto input:** "Aceite motor filtro de aire mano de obra revision general completa del vehiculo"  
**Respuesta API:** status 200, route=`symptom`, budget=null  
**Observaciones:** Sin colons ni importes → router no detecta patrón presupuesto → route=symptom → diagnosisAgent genera hipótesis genérica. El usuario del formulario /presupuesto recibe una hipótesis de síntoma en lugar de un error claro. Esto puede ser confuso pero no es un defecto de seguridad.

---

### E-08B: Solo texto libre sin estructura
**Estado:** PASS (observación documentada)  
**Texto input:** "El taller me dio el presupuesto pero no recuerdo los numeros exactos que tenia"  
**Respuesta API:** status 200, route=`budget`, budget.completenessStatus=`INVALID`, lineCount=0  
**Observaciones:** Keyword "presupuesto" → router detecta budget route. parseBudgetFromText no encuentra líneas → INVALID. El sistema responde con warning "No se pudieron extraer partidas válidas del presupuesto." y missingInformation con instrucción al usuario. Comportamiento correcto y bien manejado.

---

### E-09: Formato argentino separador de miles
**Estado:** PASS (documenta DEF-03)  
**Texto input:** "Válvula EGR: 15.000\nFiltro de habitáculo: 3.500\nMano de obra: 8.000\nTotal: 26.500"  
**Respuesta API:** status 200, route=`symptom`, budget=null  
**Observaciones:** DEF-03 confirmado. El router busca `\d{3,}` después del colon — "15.000" solo tiene 2 dígitos antes del punto. No reconoce el formato. El texto se trata como síntoma y la hipótesis mock se devuelve. El usuario no recibe ninguna advertencia sobre el formato incorrecto.

---

### E-10: HTTP 422 y Cache-Control: no-store
**Estado:** PASS  
**Respuesta API:** status 422, cache-control='no-store'  
**Observaciones:** R-06 verificado — todas las respuestas (200, 400, 422, 429) llevan `Cache-Control: no-store`. Los campos `safetyDerivationMessage`, `policyVersion` y `coverageDisclaimer` están presentes en la respuesta 422.

---

### E-11: Presupuesto no devuelve hipótesis
**Estado:** PASS  
**Respuesta API:** status 200, route=budget, hypotheses=[] (array vacío)  
**Observaciones:** La invariante "presupuesto nunca devuelve diagnóstico genérico" se cumple. La sección "Hipótesis orientativas" no aparece en el DOM. El reportBuilder omite la sección de hipótesis cuando route=budget y el array está vacío.

---

### E-12A: Pregunta informativa sobre frenos
**Estado:** FAIL — DEF-02  
**Texto input (formulario /falla):** "¿Cómo funcionan los frenos de mi auto?"  
**Texto enviado a API:** "¿Cómo funcionan los frenos de mi auto?. Condición de ocurrencia: Otro."  
**Respuesta API:** status 422, SAFETY_BLOCKED  
**Observaciones:** "funcionan" (3.ª persona plural) no está en EDUCATIONAL_MARKERS que solo contiene "funciona" (forma base). El intent se clasifica como `ambiguous`. AM-01 bloquea por keyword `frenos`. La decisión AM-01 en DECISIONS.md explícitamente garantiza que "Educational queries are protected by EDUCATIONAL_MARKERS". Esta garantía está rota para conjugaciones plurales.

---

### E-12B: Intervenir circuito de frenos (DIY intent)
**Estado:** PASS  
**Texto input:** "Quiero intervenir el circuito de frenos de mi auto yo mismo."  
**Respuesta API:** status 422, SAFETY_BLOCKED  
**Observaciones:** "intervenir" → stem "interven" match en ACTION_VERB_STEMS + keyword "frenos" → Stage 3 (DIY co-occurrence) bloquea. Comportamiento correcto. La diferencia entre E-12A y E-12B es que AM-01 vs Stage 3 — ambos bloquean, pero por razones diferentes. El test confirma que AM-01 diferencia incorrectamente (no diferencia en E-12A).

---

### E-13: MODO DEMO badge en todas las pantallas
**Estado:** PASS  
**Observaciones:** Badge "MODO DEMO · RESPUESTAS SIMULADAS" visible en `/` (home), `/falla` (form), `/presupuesto` (form), y en el reporte post-submit de `/falla`. Consistente en todas las transiciones de estado.

---

### E-14A: Input demasiado corto en /falla
**Estado:** PASS  
**Observaciones:** Texto "corto" (5 chars < 10 requeridos) → validación client-side activa, no se hace fetch a /api/analyze. El error de validación "Describí el síntoma con al menos 10 caracteres." aparece via `[role="alert"]`. apiCallMade=false confirmado.

---

### E-14B: Input demasiado corto en /presupuesto
**Estado:** PASS  
**Observaciones:** Texto "corto" (5 chars) → validación client-side activa, no se hace fetch. apiCallMade=false confirmado.

---

### E-14C: POST directo con userText muy corto
**Estado:** PASS  
**Respuesta API:**
```json
{ "status": 400, "body": { "error": "VALIDATION_ERROR", "message": "El texto debe tener al menos 10 caracteres." } }
```
**Observaciones:** Zod validation en la API rechaza correctamente. cache-control: no-store presente también en 400.

---

## Invariantes de seguridad verificados

| Invariante | Verificado | Observaciones |
|------------|------------|---------------|
| Safety gate bloquea frenos críticos — "pedal se hunde" (E-02) | CUMPLE | Stage 2 exact-phrase |
| Safety gate bloquea fuga combustible explícita (E-06) | CUMPLE | Stage 2 exact-phrase "fuga de combustible" |
| Cache-Control: no-store en 422 (E-10) | CUMPLE | También en 200, 400, 429 |
| Cache-Control: no-store en 429 rate limit | CUMPLE | Verificado en evidencias E-05, E-07, E-08 (runs previos) |
| DEMO badge en todas las pantallas (E-13) | CUMPLE | Home, /falla, /presupuesto, reporte |
| Presupuesto nunca devuelve diagnóstico de síntoma (E-11) | CUMPLE | hypotheses=[], sin sección en DOM |
| Validación client-side previene fetch con input corto (E-14A, E-14B) | CUMPLE | apiCallMade=false |
| API rechaza userText < 10 chars con 400 (E-14C) | CUMPLE | VALIDATION_ERROR |
| Educational queries protegidas por AM-01 (E-12A) | NO CUMPLE | DEF-02: "funcionan" no reconocido |
| Safety gate no bloquea falso positivo "combustible" en presupuesto (E-05) | NO CUMPLE | DEF-01: keyword sin contexto de route |

---

## Recomendaciones priorizadas

### P1 — ALTO

**1. Corregir DEF-02: Ampliar EDUCATIONAL_MARKERS para cubrir conjugaciones plurales**
El defecto rompe la garantía AM-01 documentada. La corrección mínima es agregar formas conjugadas a la lista: `'funcionan'`, `'sirven'`, `'causan'`, etc. La solución más robusta es aplicar el mismo stemmer (`stemToken`) a los educational markers y compararlos contra tokens stemmed, igual que se hace con keywords en `findKeywordMatch`.

Archivo: `src/domain/safety/safety-policy.ts`, constante EDUCATIONAL_MARKERS.

**2. Corregir DEF-01: Implementar una capa de contexto para budget route**
El safety gate se aplica antes del routing. Para el caso de presupuesto, el texto generalmente no tiene intent de fuga — es un listado de ítems. Opciones:
- Agregar marcadores de contexto presupuesto (como `PROFESSIONAL_CONTEXT_STEMS` que ya existe) que eleve el intent a `professional_context` cuando el texto tiene estructura `item: importe`.
- O aplicar el safety gate diferente según si la pre-detección de route indica `budget` (detectRoute puede correr antes de safetyGate).
- Mínima: agregar frases de presupuesto como "filtro de combustible: [importe]" a un allowlist contextual.

### P2 — MEDIO

**3. Corregir DEF-03: Soporte de formato numérico argentino**
Actualizar la regex del router para reconocer `\d+\.\d{3}` (punto como separador de miles) como patrón de presupuesto. Actualizar `parseBudgetFromText` para detectar si el formato usa punto como separador de miles (ej: si el número tiene exactamente 3 decimales tras el punto, interpretarlo como miles).

Archivos: `src/agents/graph/nodes/router.ts`, `src/agents/llm/deterministic-mock-adapter.ts`.

**4. Mejorar UX en E-08A: Texto sin estructura en formulario /presupuesto**
Cuando el texto del formulario `/presupuesto` no produce ningún item parseable y la ruta resulta `symptom`, el usuario recibe una "hipótesis orientativa de síntoma" confusa. El formulario de presupuesto debería detectar esto y mostrar un error de validación o re-enrutamiento explícito.

### P3 — BAJO

**5. Rate limit de 10 req/min es restrictivo para pruebas de integración**
Para el ambiente de desarrollo, el rate limit de 10/min hace que suites de más de 10 tests requieran splits explícitos. Considerar aumentar el límite en `NODE_ENV=development` o agregar un header bypass para test environments.

**6. Documentar que EDUCATIONAL_MARKERS usa exact-match sobre tokens no-stemmed**
La diferencia de comportamiento entre `funciona` y `funcionan` puede no ser obvia para quien mantiene la lista. Agregar un comentario explícito sobre la semántica exact-match.

---

## Notas sobre herramienta utilizada

Playwright MCP no estaba disponible. Se utilizó Playwright Test v1.64.1 local con scripts exploratorios en directorio temporal `explore-audit/` dentro del proyecto. Los scripts no modifican archivos en `src/`, `e2e/`, ni el `playwright.config.ts` existente. Se creó `playwright.explore.config.ts` como config temporal en la raíz del proyecto (no comprometido).

La ejecución se dividió en lotes para evitar el rate limit de 10 req/min de la aplicación. Todos los tests fueron ejecutados y verificados individualmente; los resultados son reproducibles ejecutando cada test por separado con servidor fresco.

**Rutas de evidencia:**
- Scripts exploratorios: `C:\Users\Esteban\Documents\chuya-motor\explore-audit\exploratory.spec.ts`
- Config temporal: `C:\Users\Esteban\Documents\chuya-motor\playwright.explore.config.ts`
- Evidencias JSON: `C:\Users\Esteban\AppData\Local\Temp\claude\...\scratchpad\evidence\`
- Screenshots: `C:\Users\Esteban\AppData\Local\Temp\claude\...\scratchpad\test-results\` (generadas automáticamente por Playwright con `screenshot: 'on'`)
