# Groq — Preparación para producción (Incremento 6.4D)

Fecha: 2026-11-12 · Rama: `feature/groq-llm-integration` · Safety Gate **v1.5.0** · `SAFETY.md` **v0.5** · Prompt de diagnóstico **v2.0.0**

**Alcance:**
- Proveedor activo en producción: **Stub** (sin cambios).
- Groq **no** se activó.
- No hubo llamadas reales a Groq ni a Gemini.
- No se crearon recursos externos ni pagos.
- No se hizo commit, PR ni deploy.

## 1. Resumen y veredicto

| Área | Estado |
|---|---|
| P0: precedencia de peligros explícitos | **Corregido** (RED 29/45 → GREEN 46/46) |
| D-08…D-11: calidad del LLM | **Mitigado**: prompt v2.0.0 más una capa determinística. Requiere una corrida real autorizada para medirlo |
| D-12: exactitud mecánica | **Pendiente** de un profesional |
| Protección distribuida (rate limit, presupuestos, concurrencia, interruptor) | **Implementada y probada con dobles**. Falta activarla: requiere una base Upstash y su aprobación |
| Regresión | Vitest 1163/1163 · Playwright CI 26/26 · Playwright desarrollo 3/3 · TypeScript, ESLint y build OK |

**Veredicto: NO-GO para piloto público. GO para cerrar el incremento como infraestructura lista para activar** (ver §11).

## 2. Defectos corregidos

| ID | Severidad | Defecto | Corrección |
|---|---|---|---|
| P0-01 | CRITICAL | "Cuando arranco, la batería tira chispas" no se bloqueaba: la regla permisiva "cuando/al + verbo" (`symptom_description`) se evaluaba antes de reconocer el peligro | Etapa 2b de peligros explícitos (`hazard-signals.ts`), evaluada después de las frases exactas y **antes de toda clasificación permisiva** |
| P0-02 | HIGH | Revisión general: el mismo hueco existía en `informational` ("¿Qué significa que la batería tire chispas?"), `professional_context` ("Lo llevé al taller y la batería tira chispas"), `past_description` ("Ayer salió fuego del motor"), `symptom_description` con olor a quemado, nafta o gas, y "Quiero puentear los cables… salen chispas" | Cubierto por la misma etapa 2b |
| P0-03 | HIGH | Los bloqueos por peligro no daban ninguna recomendación preventiva | Advertencias CRITICAL fijas por tipo de peligro (batería/eléctrico, fuego/humo, olor a quemado, combustible/gas). Ninguna indica manipular nada |
| P0-04 | MEDIUM | Las negaciones no se interpretaban: "No veo chispas ni olor a quemado" se bloqueaba por la frase exacta | Enmascarado de negaciones explícitas de percepción o existencia, limitado a la cláusula. La incertidumbre ("no sé si…") y la resolución ("ya no…") no cuentan como negación |
| D-08 | MEDIUM | Hechos inventados | Prompt (reglas 1–2) y filtro de hechos sin anclaje en el texto del usuario (≥50 % de las palabras de contenido) |
| D-09 | LOW | Se mostraba el valor interno "novice" | El enum ya no se envía al modelo (se envía una descripción en español). Se eliminan etiquetas internas de hechos, salvedades y preguntas |
| D-10 | MEDIUM | Confianza media con información insuficiente | Prompt (reglas 4–5) y tope determinístico: con menos de 6 palabras de contenido, todo pasa a `low`; `high` pasa siempre a `medium` |
| D-11 | LOW | Ausencias listadas como hechos, uso de "usted", salvedades que son justificaciones | Prompt (reglas 3 y 7), filtro de "No se reportan/menciona…" y chequeos nuevos en la revisión local (`FORMAL_REGISTER`, `ABSENCE_AS_FACT`) |
| OP-01 | HIGH | El límite de 10 req/min por IP vivía en memoria: por instancia y reseteado en cada arranque en frío de Vercel | Limitador sobre almacén compartido atómico (Upstash) con respaldo por instancia degradado |
| OP-02 | HIGH | Tomaba la IP de la **primera** entrada de `x-forwarded-for`, que el cliente puede falsificar detrás de un proxy | Un único header confiable configurable y la entrada agregada por el proxy (`TRUSTED_PROXY_HOPS`). En las claves sólo se guarda un hash con sal |
| OP-03 | HIGH | Sin presupuesto global de llamadas ni de tokens, ni control de concurrencia, ni interruptor de emergencia | `GuardedLLMAdapter` (§4) |
| OP-04 | MEDIUM | Sin `GROQ_API_KEY` la ruta respondía 500 **también a consultas que debían bloquearse**: se perdía la alerta determinística | Adaptador explícito "no disponible": la consulta bloqueada sigue respondiendo 422 con su alerta; el resto, 200 con fallback explícito |
| OP-05 | MEDIUM | La fábrica leía `process.env` y no el entorno de la solicitud, lo que podía construir el Stub cuando se pedía un proveedor real (lo detectó PROT-04-G) | `createLLMAdapter(env)` inyectable; la protección construye el adaptador con la misma configuración que vigila |
| OP-06 | MEDIUM | Los reintentos automáticos de Groq (`GROQ_MAX_RETRIES` ≤ 2) eran llamadas reales fuera de todo presupuesto | Bajo la protección se fuerzan 0 reintentos; la política pasa a ser un cooldown compartido |

## 3. Evidencia RED → GREEN

| Test | RED (antes de la corrección) | GREEN |
|---|---|---|
| `src/domain/safety/hazard-precedence.test.ts` | **29 fallidos / 16 pasados** (45). Fallaban todos los peligros que pasaban por contextos permisivos, todas las negaciones y la versión | 46/46 |
| `src/server/llm-protection/llm-protection.test.ts` › PROT-04-G | Falló: `expected 'deterministic-mock-v1' to be 'unavailable'` (OP-05, Stub silencioso) | 32/32 |
| `src/app/api/analyze/groq-safety-regression.test.ts` › GSR-04-E | Falló al integrar la protección: un 503 simulado en un test anterior dejaba activo el cooldown compartido (comportamiento correcto) | Aislamiento por test con `resetLlmProtectionRuntimeForTests()` |

Los tests de las Fases 2 y 3 (`diagnosis-quality`, `diagnosis-prompt`, `llm-protection`, `llm-protection.api`) se escribieron junto con la implementación, no antes. Su valor es de regresión, no de evidencia RED.

**Ajuste de diseño durante el RED:** en la primera versión, la pérdida de capacidad de frenado también se bloqueaba por precedencia. Eso contradecía decisiones vigentes (FASE 6 E2E-F6-11, SV-14, PREC-03, OSG-01/02/03, GSR-03), según las cuales un síntoma de frenado con contexto se analiza **con** el banner CRITICAL "No conduzcas". Se mantuvo esa decisión: el riesgo ya se reconoce y nunca queda en silencio (HZ-03 lo verifica). Bloquearlo también queda como alternativa para la revisión experta (§10, R-03).

**Tests históricos actualizados** (documentaban el comportamiento previo):
- CAL-00: versión 1.5.0.
- 3 casos de CAL-BAT-BLOCK pasan a CAL-BAT-HAZARD: ahora llevan advertencia preventiva en lugar de `null`.
- `policyVersion` de 1.4.0 a 1.5.0 en API-CB-04 y GSR-01-A.
- INT5C-02-B: con un texto corto, D-10 baja la confianza a `low`, así que el test ahora usa un síntoma detallado.

### Comprobaciones adicionales del Safety Gate (fuera de los tests)

| Texto | Resultado | Comentario |
|---|---|---|
| "El tablero hace chispa cuando prendo las luces." | Bloqueado + CRITICAL | Correcto |
| "La bujía no hace chispa." | Permitido | Correcto (encendido, negado) |
| "El auto echa humo blanco por el caño de escape cuando arranca en frío." | Permitido | Humo de escape: síntoma diagnóstico |
| "Cuando cargo nafta huele mucho a nafta adentro del auto." | Bloqueado, **sin** advertencia específica | "huele **mucho** a" no coincide con el patrón; bloquea AM-01 (residual R-05) |
| "Tiene olor a quemado? No, creo que no." | Bloqueado | Falso positivo conservador |
| "El motor se calienta y la batería se descarga." | Bloqueado | Falso positivo previo (6.4C, prefijo `calient`) |
| "Cambié la batería y ahora el auto no arranca." | Bloqueado (DIY) | Falso positivo previo ("cambi" como verbo de acción) |

## 4. Diseño de la protección distribuida

```
POST /api/analyze
 1. createRequestProtection(headers)   config por solicitud; almacén memoizado por proceso
 2. checkRequestRate()                 reserva atómica <p>:rl:<hashCliente>:<ventana>  (todas las solicitudes)
      fallo del almacén → límite por instancia (degradado) + métrica rate_limit_degraded
 3. LangGraph: validator → safetyGate (v1.5.0) → router → diagnosisAgent → outputSafetyGuard → …
      el bloqueo determinístico ocurre ANTES de cualquier llamada al LLM
 4. diagnosisAgent / budgetParser → adapter.complete()
      stub      → sin protección (costo cero, sigue operativo con el interruptor activo)
      real      → GuardedLLMAdapter
         a. LLM_KILL_SWITCH (env)                      → LLM_DISABLED
         b. sin almacén / no distribuido en producción  → LLM_GUARD_UNAVAILABLE
         c. flags <p>:llm:kill, <p>:llm:groq:kill        → LLM_DISABLED (sin redeploy)
         d. <p>:llm:groq:cooldown                        → LLM_PROVIDER_COOLDOWN
         e. límite por análisis                          → LLM_CALL_LIMIT
         f. reservas atómicas en orden, con liberación si una falla:
              cliente/día · llamadas/día · tokens/día (estimación) · en curso (semáforo con TTL)
                                                         → LLM_BUDGET_EXHAUSTED / LLM_BUSY
         g. error del almacén en a–f                     → LLM_GUARD_UNAVAILABLE (falla cerrado)
         h. llamada al proveedor (0 reintentos automáticos)
         i. liberar semáforo; conciliar tokens con usage.total_tokens;
            liberar la reserva de tokens si el proveedor rechazó antes de generar (429/401/403/404/5xx);
            mantenerla si el consumo es desconocido (timeout); cooldown compartido ante 429 (Retry-After) o 5xx
 5. Respuesta: severidad determinística siempre calculada en la ruta; si la protección rechazó la
    llamada → fallback + aviso fijo LLM_UNAVAILABLE_WARNING (distinto del aviso de "retenida" y del Stub)
```

**Atomicidad:**
- Cada operación compuesta es **un** script Lua (`RESERVE_SCRIPT`, `ADJUST_SCRIPT`, `METRIC_SCRIPT`). Redis ejecuta cada script de forma atómica, así que no hay "leer y después escribir" entre viajes de red.
- PROT-01-B lo demuestra: dos instancias, 40 reservas intercaladas y un límite de 7 dan exactamente 7.
- PROT-01-C hace lo mismo con el presupuesto de tokens y 12 instancias.

**Interfaz `QuotaStore`:** `reserve`, `adjust`, `get`, `setFlag`, `clearFlag`, `hasFlag`, `incrementMetric` y `readMetrics`.
- `UpstashQuotaStore` usa REST con `fetch`, sin SDK nuevo, con timeout de 1,5 s y errores sin token ni URL.
- `InMemoryQuotaStore` es sólo para tests y desarrollo.

**Claves:** usan prefijo, proveedor, día UTC y un hash del cliente. **Nunca** incluyen texto del usuario, prompts, presupuestos ni IP en claro.

**Comportamiento ante fallas:**

| Situación | Stub | Proveedor real |
|---|---|---|
| Upstash configurado y sano | normal | protegido |
| Upstash caído o con timeout | normal (rate limit por instancia) | **sin llamada**, aviso fijo |
| Sin Upstash, producción | normal (rate limit por instancia) | **sin llamada**, aviso fijo |
| Sin Upstash, desarrollo/test | normal | protegido con contadores en memoria (`LLM_ALLOW_LOCAL_QUOTA`) |
| Configuración inválida | normal | **sin llamada** |
| Interruptor activo | normal | **sin llamada**, aviso fijo |
| Falta `GROQ_API_KEY` | — | **sin llamada**, fallback explícito (no 500, no Stub) |

En todos los casos, el Safety Gate, el 422 de consultas bloqueadas, la advertencia preventiva y el banner de severidad se mantienen (API-KILL, API-PROD).

**Métricas (`usage-metrics.ts`):** contadores agregados por día UTC en un hash compartido, con TTL de 8 días.
- Contadores: `requests_total`, `requests_rate_limited`, `rate_limit_degraded`, `llm_calls_ok`, `llm_tokens_used`, `llm_tokens_unreconciled`, `llm_error_<código>`, `llm_rejected_<motivo>` y `guard_*_errors`.
- Registrar métricas nunca hace fallar una solicitud.
- Las fallas del almacén se cuentan en la instancia.
- No hay endpoint de lectura: un endpoint sin autenticación sería superficie de ataque. Se consultan desde la consola de Upstash o con `UsageMetrics.snapshot()`.

**IP compartidas (CGNAT, oficinas, redes móviles):** los límites por cliente son modestos y **no bloquean la parte determinística**. Un cliente que agota su cupo de LLM sigue recibiendo el Safety Gate y las advertencias; sólo se queda sin texto generativo. Las consultas sin IP válida comparten un único bucket `anon`, que es conservador.

## 5. Dependencias externas necesarias

| Dependencia | Para qué | Estado |
|---|---|---|
| Upstash Redis (REST), directo o con la integración de Vercel Marketplace | Contadores atómicos compartidos | **No creada.** Requiere aprobación (posible costo) |
| GroqCloud (cuenta y clave de producción, límites del plan) | Proveedor | Clave de evaluación existente; plan de producción sin definir |
| Región de Upstash cercana a la región de las funciones de Vercel | Latencia | A decidir al crear la base |

No se agregaron paquetes npm: el cliente REST usa `fetch`.

## 6. Variables de entorno (server-side; nunca `NEXT_PUBLIC_*`)

| Variable | Default | Uso |
|---|---|---|
| `LLM_QUOTA_STORE` | `upstash` si hay URL y token; si no, `memory` | `upstash` · `memory` · `none` |
| `UPSTASH_REDIS_REST_URL` / `KV_REST_API_URL` | — | Endpoint REST (https) |
| `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN` | — | Token (secreto) |
| `LLM_QUOTA_KEY_PREFIX` | `chuya` | Prefijo de claves (permite separar preview y producción) |
| `RATE_LIMIT_PER_WINDOW` / `RATE_LIMIT_WINDOW_SECONDS` | 10 / 60 | Solicitudes por cliente |
| `CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS` | `x-forwarded-for` / 1 | Header confiable y saltos de proxy |
| `CLIENT_ID_SALT` | vacío | Sal del hash de cliente (recomendado en producción) |
| `LLM_DAILY_CALL_BUDGET` | 300 | Llamadas reales por día UTC (global) |
| `LLM_DAILY_TOKEN_BUDGET` | 1 000 000 | Tokens por día UTC (global, reserva y conciliación) |
| `LLM_CLIENT_DAILY_CALLS` | 20 | Llamadas reales por cliente y día |
| `LLM_MAX_CALLS_PER_ANALYSIS` | 1 | Llamadas por solicitud de usuario |
| `LLM_MAX_CONCURRENT` | 4 | Llamadas simultáneas (semáforo con TTL = 2 × timeout) |
| `LLM_COOLDOWN_SECONDS_ON_429` / `_ON_5XX` | 60 / 15 | Cooldown compartido (en 429 manda `Retry-After`, entre 1 s y 10 min) |
| `LLM_KILL_SWITCH` | `false` | Interruptor de emergencia por entorno |
| `LLM_ALLOW_LOCAL_QUOTA` | `true` fuera de producción | Ignorado en producción |
| `GROQ_MAX_TOKENS` / `GROQ_TIMEOUT_MS` | 2048 / 30000 | También alimentan la estimación de tokens y el TTL del semáforo |

**Interruptor sin redeploy:** crear la clave `<prefijo>:llm:kill` (todos los proveedores) o `<prefijo>:llm:groq:kill` (sólo Groq) desde la consola de Upstash. Borrarla lo desactiva (PROT-03-C).

## 7. Consumo de infraestructura estimado y limitaciones

**Comandos REST por solicitud** (contados en el código):

| Tipo de solicitud | Comandos |
|---|---|
| Bloqueada, Stub o presupuesto con Stub | 2 (reserva de rate limit + métrica) |
| Con LLM real | ≈ 13 |

Detalle de una solicitud con LLM real:
- 2 de rate limit;
- 3 lecturas de flags;
- 4 reservas;
- 4 posteriores a la llamada: semáforo, conciliación y dos métricas.

**Volumen y latencia:**
- Con el presupuesto por defecto de 300 llamadas reales por día, más unas 1 000 solicitudes sin LLM: 300 × 13 + 1 000 × 2 ≈ **6 000 comandos/día** (≈ 180 000/mes).
- Los límites y precios de los planes de Upstash cambian: verificarlos al aprobar la base. No se asume que el plan gratuito alcance.
- Latencia agregada: ≈ 13 viajes secuenciales de 5–30 ms cada uno en la misma región, o sea **60–400 ms** por solicitud con LLM, frente a 1–5 s de Groq.
- Mejora posible, no implementada: unir las verificaciones previas en un único script Lua.

**Tokens:**
- Reserva por llamada ≈ (caracteres del prompt / 3) + `GROQ_MAX_TOKENS`, unos 3 300 con los valores por defecto.
- Con 1 000 000 tokens/día, el límite efectivo ronda ~300 llamadas, coherente con `LLM_DAILY_CALL_BUDGET`.
- Lo que se reservó de más se devuelve al conciliar con `usage.total_tokens`.

**Limitaciones:**
- Los contadores diarios usan el día UTC (00:00 UTC = 21:00 en Argentina).
- Sin Upstash, el rate limit en producción es por instancia: no es distribuido.
- La estimación de tokens es aproximada. Si se pierde la conciliación (timeout), la reserva queda contada de más: es conservador.
- Si una instancia muere a mitad de una llamada, ese hueco del semáforo queda ocupado hasta su TTL (60 s).
- No hay cola: si se supera la concurrencia, la llamada se rechaza (`LLM_BUSY`) en vez de esperar.

## 8. Tests ejecutados

| Suite | Resultado |
|---|---|
| Vitest completo | **1163/1163** (47 archivos; antes 1038). Nuevos: 46 HZ, 10 DQ, 21 DP, 32 PROT, 12 API protección, 4 REV-DD = 125 |
| Playwright CI (`npm run build && CI=1 npx playwright test`) | **26/26** (nuevo: E2E-04-E) |
| Playwright desarrollo (`-c playwright.dev.config.ts`) | **3/3** |
| TypeScript (`tsc --noEmit`) | OK |
| ESLint (`npm run lint`) | OK; sólo el warning previo de `layout.tsx` |
| Build | OK. `.next/static` no contiene `groq-sdk`, `GROQ_API_KEY`, `UPSTASH`, `KV_REST_API`, `LLM_KILL_SWITCH` ni símbolos de los catálogos |

**Cobertura pedida en la Fase 4:**

| Tema | Tests |
|---|---|
| Concurrencia | PROT-01-A/B/C/D |
| Reservas atómicas | PROT-01-B/C, PROT-02-B |
| Agotamiento de cuota | PROT-02-A/E, API-BUDGET |
| Reinicio de instancia | PROT-02-F/G |
| Cuotas compartidas | PROT-01-B, PROT-02-E/F |
| Errores de Redis | PROT-04-A/B, PROT-04-H |
| Ausencia de configuración | PROT-04-C/D/E/F/G, API-PROD |
| Interruptor de emergencia | PROT-03-B/C, API-KILL |
| Límite por análisis | PROT-03-A, API-BUDGET |
| No exposición de secretos | PROT-04-A, PROT-05-C, escaneo del bundle |
| Advertencias críticas preservadas | API-KILL, API-PROD, HZ-01/02/03, API-P0 |
| Falsos positivos y negativos del Safety Gate | HZ-01…HZ-06, CAL-*, FP-*, SC-* |

## 9. Nueva corrida real controlada de Groq (preparada, NO ejecutada)

Ejecutarla requiere autorización explícita. Usa el revisor existente, con prompt v2.0.0 y la capa de calidad:

```bash
# Git Bash. Ambas variables deben ser de SESIÓN (en .env.local se ignoran).
GROQ_REAL_LLM_AUTHORIZED=true GROQ_REVIEW_CONTENT_AUTHORIZED=true npm run review:groq
```

**Qué se espera:**
- 7 escenarios y **6 llamadas reales**: REV-003 se bloquea; REV-002 ya está permitido desde v1.4.0.
- Tope del adaptador: 7 llamadas.
- 0 reintentos.
- Corte inmediato ante 429, error de autenticación o modelo no disponible.
- Presupuesto de tokens: `GROQ_REVIEW_TOKEN_BUDGET` (15 000 por defecto).
- El informe con texto del LLM queda en `reviews-local/` (ignorado por git).

**Qué verificar:**
- **D-08:** sin condiciones inventadas en hipótesis ni salvedades; la capa determinística sólo cubre `facts`.
- **D-09:** `INTERNAL_LABEL_LEAK` debe quedar en 0.
- **D-10:** sin `INSUFFICIENT_INFO_AS_DIAGNOSIS` en REV-005 ni en AMB-001.
- **D-11:** `FORMAL_REGISTER` y `ABSENCE_AS_FACT` en 0, y salvedades que digan qué confirmaría o descartaría la hipótesis.
- **D-06:** que las preguntas no sean siempre 5.
- Que la validación de salida no retenga respuestas seguras (falsos positivos).
- Exactitud mecánica (D-12): por un profesional.

## 10. Riesgos residuales

| ID | Riesgo | Mitigación / estado |
|---|---|---|
| R-01 | Ninguna lista de expresiones detecta todos los peligros. Faltan errores de tipeo ("chizpas"), giros como "huele **mucho** a nafta" y otros idiomas | AM-01 sigue bloqueando la mayoría por palabra clave, aunque sin advertencia específica. Revisión experta del catálogo |
| R-02 | Falsos positivos conservadores: "¿Tiene olor a quemado? No, creo que no", "el motor se calienta y la batería se descarga", "cambié la batería y ahora no arranca", "los frenos siguen haciendo ruido" | Del lado seguro. Recalibrar con datos reales anonimizados |
| R-03 | La pérdida de frenado con contexto ("al frenar casi no frena") se analiza con banner CRITICAL en lugar de bloquearse (decisión vigente) | Decisión para la revisión experta de `SAFETY.md` v0.5 |
| R-04 | El enmascarado de negaciones es léxico: una negación mal ubicada puede ocultar un peligro dentro de la misma cláusula | Limitado a verbos de percepción o existencia; no aplica a incertidumbre ni resolución; las cláusulas se cortan con "pero", "y" y puntuación |
| R-05 | El anclaje de hechos (D-08) es léxico: no detecta hechos inventados dentro de hipótesis o salvedades, y puede quitar una paráfrasis válida | Verificarlo en la corrida real (§9) |
| R-06 | El prompt v2.0.0 no se probó contra Groq ni Gemini reales | Corrida real autorizada pendiente |
| R-07 | D-12: posibles errores mecánicos | Revisión profesional pendiente |
| R-08 | La protección distribuida sólo se probó con un doble de Upstash, no contra Redis real | Smoke test con la base aprobada antes de activar |
| R-09 | Sin Upstash, el rate limit en producción es por instancia | Upstash es obligatorio antes de activar un LLM real (y recomendado incluso con el Stub) |
| R-10 | Privacidad: el texto del usuario se envía a GroqCloud | Revisión de términos y aviso en la UI pendientes |
| R-11 | El día UTC no coincide con el día local | Documentado |

## 11. Pasos necesarios antes de activar Groq en Vercel

1. **Aprobación** para crear Upstash Redis, de preferencia con la integración de Vercel Marketplace, en la región de las funciones.
2. Configurar en Vercel **Production**, como variables server-side:
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (o `KV_*`);
   - `LLM_QUOTA_STORE=upstash`;
   - `CLIENT_ID_SALT` aleatorio;
   - presupuestos ajustados al plan de Groq.
   - Usar `LLM_QUOTA_KEY_PREFIX` distintos para preview y producción.
3. Smoke test de la protección contra Upstash real en **preview**, todavía con el Stub: rate limit, flag de interruptor, métricas.
4. Corrida real autorizada (§9) y revisión de D-08…D-11 en el texto real.
5. Revisión profesional mecánica (D-12) y revisión experta de `SAFETY.md` v0.5, incluida la decisión R-03.
6. Revisión de privacidad y términos de GroqCloud, y aviso en la UI.
7. Confirmar los límites del plan de Groq (RPM, RPD, TPM, TPD) frente a `LLM_DAILY_*` y `LLM_MAX_CONCURRENT`.
8. Ensayar el interruptor de emergencia: crear y borrar `<prefijo>:llm:groq:kill`, y probar `LLM_KILL_SWITCH=true`.
9. Recién entonces, decisión explícita de configurar `LLM_PROVIDER=groq` y `GROQ_API_KEY` en producción. Empezar por preview y luego un piloto limitado con presupuestos bajos (por ejemplo 50 llamadas/día).

## 12. GO / NO-GO

- **Piloto público con Groq: NO-GO.** Faltan los pasos 1–8 de §11. Bloquean sobre todo: el almacén distribuido no está creado ni probado contra Redis real, la corrida real con el prompt v2.0.0 no se hizo, y están pendientes las revisiones mecánica, de seguridad y de privacidad.
- **Cierre de 6.4D como infraestructura lista para activar: GO.** Están corregidos el P0 y la precedencia general, y mitigados D-08…D-11 en su parte determinística. La protección es fail-closed y no puede activarse por accidente: sin Upstash, producción nunca llama a un LLM real. La regresión pasa completa y el proveedor en producción sigue siendo el Stub.

## Archivos

**Nuevos:**
- `src/domain/safety/text-normalization.ts`
- `src/domain/safety/hazard-signals.ts`
- `src/domain/safety/hazard-precedence.test.ts`
- `src/domain/quality/diagnosis-quality.ts` y `.test.ts`
- `src/agents/graph/nodes/diagnosis-prompt.ts` y `.test.ts`
- `src/agents/llm/llm-availability.ts`
- `src/server/llm-protection/`: `quota-store.ts`, `upstash-quota-store.ts`, `protection-config.ts`, `client-identity.ts`, `usage-metrics.ts`, `guarded-llm-adapter.ts`, `runtime.ts`, `fake-upstash.ts` (sólo para tests) y `llm-protection.test.ts`
- `src/app/api/analyze/llm-protection.api.test.ts`

**Modificados:**
- `safety-policy.ts` (etapa 2b y enmascarado)
- `severity-assessor.ts` (advertencias preventivas)
- `blocklist.ts` (1.5.0)
- `diagnosis-agent.ts`, `budget-parser.ts`
- `llm-adapter.ts` (códigos nuevos), `llm-adapter-factory.ts` (env inyectable)
- `route.ts` (protección)
- `review-checks.ts`, `quality-review.ts`, `benchmark/persist/sanitizer.ts`
- `e2e/increment3.spec.ts` (E2E-04-E)
- tests actualizados (§3)
- `docs/SAFETY.md` (v0.5), `README.md`, `.env.example`
