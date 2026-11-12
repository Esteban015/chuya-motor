# Chuya Motor

**Claridad entre vos y tu taller.**

Asistente automotriz orientado a LATAM que ayuda al propietario a entender fallas, interpretar presupuestos y prepararse para hablar con su mecánico. Las respuestas son **orientativas**: no reemplazan una inspección profesional.

> Estado: MVP demostrable para Hackatón Tren Solar (noviembre 2026). Repositorio privado.

---

## Quick Start

### Requisitos previos

- **Node.js** ≥ 22 (ver `engines` en `package.json`)
- **npm** ≥ 10 (incluido con Node.js 22)
- **Git**

Verificá tu versión:

```bash
node --version   # debe ser v22.x.x o superior
npm --version
```

### Instalación y ejecución

```bash
# 1. Clonar
git clone <repo-url>
cd chuya-motor

# 2. Instalar dependencias (modo CI, reproducible)
npm ci

# 3. Iniciar el servidor de desarrollo
npm run dev
```

La aplicación estará disponible en **http://localhost:3000**.

No se necesita ninguna variable de entorno para correr en modo simulado (stub). El proveedor LLM por defecto es `stub` — las respuestas son determinísticas y no realizan llamadas externas.

---

## Variables de entorno

Creá un archivo `.env.local` en la raíz del proyecto (nunca lo commitees; está en `.gitignore`).

### Modo stub — sin credenciales (por defecto)

No hace falta crear `.env.local`. El servidor arranca con respuestas simuladas:

```bash
# Equivalente al comportamiento por defecto — se puede omitir
LLM_PROVIDER=stub
```

### Modo Gemini — Google AI Studio

```bash
# .env.local
LLM_PROVIDER=gemini
GEMINI_API_KEY=<tu-api-key-de-google-ai-studio>

# Opcionales
GEMINI_MODEL=gemini-2.5-flash-lite-preview-06-17   # modelo por defecto
GEMINI_FREE_TIER=false                              # desactiva el guardián de cuota
```

### Modo Anthropic

```bash
# .env.local
LLM_PROVIDER=anthropic
LLM_API_KEY=<tu-api-key-sk-ant-...>

# Opcional
LLM_MODEL=claude-sonnet-4-6
```

### Modo Groq — GroqCloud (solo evaluación, NO habilitado en producción)

Integración del Incremento 6.3 para evaluar compatibilidad y calidad de `openai/gpt-oss-120b`. **No es un proveedor activo en producción** y no debe configurarse en Vercel sin cumplir las condiciones de [Activación pública](#restricciones-para-activar-groq-públicamente).

```bash
# .env.local  (solo servidor — nunca NEXT_PUBLIC_*)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...                 # https://console.groq.com/keys

# Opcionales
GROQ_MODEL=openai/gpt-oss-120b       # por defecto; también openai/gpt-oss-20b
GROQ_MAX_TOKENS=2048                 # max_completion_tokens por llamada (1–8192)
GROQ_TIMEOUT_MS=30000
GROQ_REASONING_EFFORT=low            # low | medium | high
GROQ_MAX_RETRIES=0                   # 0–2; sólo 429/503 con Retry-After ≤ 10 s
```

**Cómo obtener la clave:** creá una cuenta en [console.groq.com](https://console.groq.com), entrá a *API Keys* → *Create API Key* y copiala en `.env.local` (empieza con `gsk_`). La clave se muestra una sola vez.

**Modelos soportados:** el adaptador acepta únicamente `openai/gpt-oss-120b` (por defecto) y `openai/gpt-oss-20b`; cualquier otro valor de `GROQ_MODEL` produce un error de configuración explícito.

**Reasoning tokens:** los modelos gpt-oss son de razonamiento. Los tokens de razonamiento consumen `max_completion_tokens` aunque no se devuelvan (`include_reasoning=false`). Si el presupuesto se agota, la respuesta se marca `finish_reason=length` y el adaptador la **rechaza** como truncada. Por eso el valor por defecto es `reasoning_effort=low` y 2048 tokens.

**Límites gratuitos:** los límites (RPM, RPD, TPM, TPD) dependen del plan y la organización de cada cuenta y pueden cambiar. Consultalos en [console.groq.com/settings/limits](https://console.groq.com/settings/limits) antes de cualquier prueba. Un HTTP 429 se reporta como `LLM_QUOTA_EXCEEDED`; el adaptador no reintenta por defecto.

**Privacidad:** el texto de cada consulta se envía a GroqCloud. Usá sólo datos sintéticos en pruebas y revisá la [política de privacidad](https://groq.com/privacy-policy/) y los términos vigentes de Groq antes de enviar consultas reales de usuarios. El Safety Gate bloquea consultas peligrosas **antes** de cualquier llamada al LLM.

> Si `LLM_PROVIDER=groq` y falta `GROQ_API_KEY`, el servidor falla con un error de configuración claro. **Nunca** cae silenciosamente al stub.

> Las variables `*_API_KEY` son secretos. Nunca las pongas en archivos commiteados, variables `NEXT_PUBLIC_*` ni en el cliente.

---

## Modo simulado vs LLM real

| | Stub (por defecto) | LLM real |
|---|---|---|
| Llamadas externas | ❌ Ninguna | ✅ Gemini, Anthropic o Groq (sólo evaluación) |
| Costo | Gratis | Según proveedor |
| Hipótesis | Respuestas de ejemplo hardcodeadas | Generadas por el modelo |
| Reproducibilidad | Determinístico | Variable |
| Para desarrollar | ✅ Recomendado | Solo si probás la integración |

El Safety Gate y toda la lógica de dominio funcionan igual en ambos modos: el bloqueo de consultas peligrosas, el análisis de presupuestos y la evaluación de severidad son **determinísticos** e independientes del LLM.

---

## Rutas disponibles

| Ruta | Descripción |
|------|-------------|
| `/` | Landing: propuesta de valor, acceso a la demo |
| `/demo` | Hub de demostración con dos flujos |
| `/demo/falla` | Wizard guiado en 3 pasos: vehículo → síntoma → resultado |
| `/demo/presupuesto` | Analizador de presupuestos con panel de consejos |
| `/falla` | Formulario directo (backward compat con rutas anteriores) |
| `/presupuesto` | Formulario directo (backward compat) |

Todas las rutas de `/demo/*` muestran un badge **MODO DEMO · RESPUESTAS SIMULADAS** cuando `LLM_PROVIDER=stub`.

---

## Comandos

### Desarrollo

```bash
npm run dev          # servidor de desarrollo en localhost:3000
npm run build        # build de producción
npm run start        # iniciar el build de producción
```

### Verificación de código

```bash
npm run type-check   # TypeScript sin errores (tsc --noEmit)
npm run lint         # ESLint (next lint)
```

### Tests unitarios e integración — Vitest

```bash
npm test                  # todos los tests (vitest run) — actualmente 1243/1243
npm run test:watch        # modo watch interactivo
npm run test:coverage     # con cobertura V8
```

Los tests de Vitest cubren: dominio (`src/domain/`), API route handlers (`src/app/api/`), adaptadores LLM, orquestación LangGraph y el módulo de benchmark.

### Tests E2E — Playwright

Hay dos suites:

```bash
# Suite producción — 27 tests (requiere build previo con npm run build; CI=1 para no usar el servidor de desarrollo)
npm run test:e2e

# Suite desarrollo — 3 tests que requieren servidor de desarrollo
npm run test:e2e:dev

# Interfaz visual interactiva
npm run test:e2e:ui

# Listar todos los tests sin ejecutarlos
npm run test:e2e:list
```

> La suite de producción arranca automáticamente el servidor (`npm run start`) si no hay uno corriendo en el puerto 3000. Para CI, establecé la variable `CI=true` — así usa el servidor de producción y no reutiliza uno existente.
>
> Ambas suites fuerzan `LLM_PROVIDER=stub` y `LLM_QUOTA_STORE=memory`: nunca llaman a un LLM real ni tocan la base Upstash de `.env.local` (6.4E).
>
> Sin `CI=true`, Playwright levanta `npm run dev` y `E2E-10` (`/api/traces` → 404 sólo en producción) falla por diseño. Para validar la suite de producción localmente: `npm run build && CI=true npm run test:e2e`.

### Groq — pruebas mock vs reales y benchmark comparativo

| | Pruebas mock (automáticas) | Pruebas reales (opt-in) |
|---|---|---|
| Comando | `npm test` | `npm run smoke:groq` / `npm run pilot:groq` |
| Llamadas a Groq | ❌ Nunca (SDK mockeado) | ✅ Sólo con `GROQ_REAL_LLM_AUTHORIZED=true` |
| Requiere `GROQ_API_KEY` | No | Sí |
| En CI | Sí | Bloqueado siempre |

```bash
# Benchmark comparativo — sin llamadas reales (stub contemporáneo + Gemini histórico + último piloto Groq)
npm run bench:compare

# 1) Conectividad: 1 request sintética ("OK"), sin reintentos.
#    Sin la variable de autorización sólo hace el pre-flight.
GROQ_REAL_LLM_AUTHORIZED=true npm run smoke:groq

# 2) Piloto acotado: máx. 5 escenarios (SYM-001, SYM-003, BUD-001, SAF-001, AMB-001 → 3 llamadas reales)
GROQ_REAL_LLM_AUTHORIZED=true npm run pilot:groq
```

```bash
# 3) Revisión humana de calidad (Incremento 6.4A) — informe legible con el texto generado,
#    en reviews-local/ (ignorado por Git). Sin flags corre en modo STUB (sin llamadas).
GROQ_REAL_LLM_AUTHORIZED=true GROQ_REVIEW_CONTENT_AUTHORIZED=true npm run review:groq
```

`GROQ_REAL_LLM_AUTHORIZED` (y `GROQ_REVIEW_CONTENT_AUTHORIZED` para la revisión) deben pasarse como **variables de sesión**: un valor en `.env.local` se ignora a propósito. Ver [docs/reviews/groq-quality-review.md](docs/reviews/groq-quality-review.md) y [docs/reviews/groq-safety-hardening.md](docs/reviews/groq-safety-hardening.md) (6.4B) y [docs/reviews/groq-real-review-6.4c.md](docs/reviews/groq-real-review-6.4c.md) (6.4C) y [docs/reviews/groq-production-readiness-6.4d.md](docs/reviews/groq-production-readiness-6.4d.md) (6.4D) y [docs/reviews/groq-pilot-release-6.4e.md](docs/reviews/groq-pilot-release-6.4e.md) (6.4E: release candidate del piloto, despliegue y rollback).

Límites locales del piloto: máximo 5 escenarios (la campaña de 30 requiere autorización y un cambio de código adicionales), ejecución secuencial, pausa configurable (`GROQ_PILOT_DELAY_MS`, 4000 ms por defecto), presupuesto total de tokens (`GROQ_PILOT_TOKEN_BUDGET`, 12000 por defecto), abort inmediato ante 429/401/403/modelo no disponible, y ningún reintento de escenarios fallidos. `GROQ_PILOT_SCENARIOS` permite elegir hasta 5 IDs del dataset.

Los resultados se guardan en `benchmark/results/` (ignorado por Git). Sólo se guardan métricas estructurales; nunca texto generado por el LLM, credenciales ni datos personales. Que una respuesta sea estructuralmente válida **no implica** que el diagnóstico mecánico sea correcto: la calidad técnica requiere revisión humana.

### Restricciones para activar Groq públicamente

Groq **no** está habilitado en producción. Antes de un piloto público hace falta, como mínimo:

1. Piloto real autorizado con resultados revisados por una persona con conocimiento mecánico.
2. Campaña completa de 30 escenarios con autorización explícita y sin regresiones de seguridad.
3. Revisión de privacidad y términos de GroqCloud para datos reales de usuarios, y aviso en la UI.
4. Límites de cuota del plan confirmados frente al tráfico esperado, con la protección distribuida activa (Upstash configurado; ver docs/reviews/groq-production-readiness-6.4d.md).
5. Decisión explícita de configurar `LLM_PROVIDER=groq` en el entorno de producción (este incremento no lo hace).

---

## Arquitectura

```
Usuario
  │
  ▼
Next.js App Router (src/app/)
  │  Página de falla / presupuesto (Client Component)
  │
  ▼
POST /api/analyze (src/app/api/analyze/route.ts)
  │  Validación de entrada (Zod)
  │  Rate limit por cliente (IP con hash) en almacén compartido si está configurado (6.4D)
  │  Proveedor real: presupuestos, concurrencia, cooldown e interruptor de emergencia (src/server/llm-protection)
  │
  ▼
LangGraph — analyze-graph (src/agents/graph/)
  │
  ├─► validator        verificación de formato
  ├─► safetyGate       Safety Gate determinístico v1.5.0
  │     4 etapas: normalización → frases exactas → co-ocurrencia de stems → intención
  │     Ningún agente puede anular un bloqueo del Safety Gate
  │
  ├─► router           clasifica como symptom / budget / clarification (determinístico)
  │
  ├─► diagnosisAgent   genera hipótesis orientativas (usa LLM)
  │     └─► LLM Adapter (stub / Gemini / Anthropic / Groq)
  │
  ├─► outputSafetyGuard  valida del lado servidor el texto del LLM (6.4B): estructura,
  │     instrucciones DIY sobre sistemas críticos, "podés seguir manejando" / minimización
  │     ante riesgo alto o crítico. Salida insegura → retenida (fallback identificado, sin Stub)
  │
  └─► budgetParser     analiza líneas de presupuesto (usa LLM)
        └─► LLM Adapter
  │
  ▼
ClientAnalyzeOutput
  │  route · hypotheses · facts · questions / budgetResult
  │  severity (evaluación determinística de gravedad)
  │  safetyBlocked · nodeTrace (solo en desarrollo)
  │  422 SAFETY_BLOCKED: + severity (campo aditivo, 6.4B) — alerta crítica "No conduzcas"
  │     sólo si el texto bloqueado describe pérdida de capacidad de frenado; null en otro caso
  │
  ▼
ReportView / SafetyAlert (src/components/)
  SeverityBanner — banner visual si severity != null
```

### Módulos principales

| Directorio | Responsabilidad |
|------------|-----------------|
| `src/app/` | Páginas y API routes (Next.js App Router) |
| `src/components/` | Componentes React reutilizables |
| `src/domain/` | Entidades, tipos, Safety Gate, severidad (lógica pura) |
| `src/agents/` | Grafo LangGraph, nodos, adaptadores LLM |
| `benchmark/` | Plataforma de evaluación de calidad LLM (sin llamadas reales por defecto) |
| `e2e/` | Tests Playwright (prod: `playwright.config.ts`, dev: `playwright.dev.config.ts`) |

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Estructura de directorios, decisiones técnicas |
| [docs/AGENT_ORCHESTRATION.md](docs/AGENT_ORCHESTRATION.md) | Grafo LangGraph, nodos y contratos de estado |
| [docs/SAFETY.md](docs/SAFETY.md) | Safety Gate: política, etapas y casos bloqueados |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Visión de producto y líneas |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Requisitos y alcance del MVP |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fases de desarrollo planificadas |
| [docs/MVP_01.md](docs/MVP_01.md) | Especificación del primer incremento |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisiones de arquitectura y diseño |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Evidencia de validación exploratoria |
| [docs/DEV_AGENTS.md](docs/DEV_AGENTS.md) | Configuración de agentes Claude Code |

---

## Analítica de visitas (piloto del hackatón)

La web incluye el script de **Vercel Web Analytics** (cargado después de que la página sea interactiva). Para empezar a registrar visitas, habilitá **Web Analytics** en el panel de Vercel del proyecto `chuya-motor` y desplegá la rama aprobada en producción.

- El reporte de Vercel permite observar visitantes y páginas vistas. Una visita a `/demo/falla` **no prueba** que se haya completado un análisis.
- No se envían síntomas, presupuestos, patentes, marca/modelo ni el contenido de formularios a la analítica de visitas.
- Esta integración no mide eventos de éxito de análisis, usuarios registrados, personas entrevistadas ni disposición a pagar.
- Para evidencia de tracción, combiná los datos agregados de visitas con pruebas observadas y feedback voluntario, anonimizados y documentados (fecha, cantidad de participantes, procedimiento y evidencia).
- No reportes páginas vistas como usuarios únicos, ni respuestas del research como usuarios que probaron la aplicación.

---

## Limitaciones actuales

- **Sin persistencia:** no hay base de datos. Los casos no se guardan entre sesiones.
- **Sin autenticación:** no hay usuarios ni perfiles.
- **Rate limit:** 10 req/min por cliente (anti-abuso). Con un LLM real, además: 3 análisis con IA por visitante por hora (10 por día), 40 análisis / 80 llamadas / 60 000 tokens por día en total y 2 llamadas simultáneas (6.4E). Sin Upstash configurado el contador es por instancia y se resetea al reiniciar; un proveedor LLM real en producción exige el almacén distribuido (falla cerrado sin él).
- **Un solo vehículo por consulta:** no hay historial ni comparación entre casos.
- **Hipótesis orientativas únicamente:** no se emiten recomendaciones de reparación DIY.
- **Solo texto:** no se procesan imágenes, audio ni datos OBD-II.
- **Plataforma de benchmark sin producción:** `benchmark/` evalúa calidad del LLM pero no ejecuta llamadas reales por defecto.
- **Groq sólo en evaluación:** el proveedor `groq` existe para pruebas locales opt-in; no está activo en producción.
- **Sin Structured Outputs estrictos:** los nodos validan JSON con `extractJSON` + Zod. El modo JSON Schema estricto de Groq queda como mejora futura porque el contrato `LLMCompletionRequest` no transporta un schema.

## Funcionalidades futuras (no implementadas)

Están documentadas en [docs/ROADMAP.md](docs/ROADMAP.md) pero aún no existen en el código:

- Persistencia con PostgreSQL/Supabase
- Perfil de vehículos e historial de reparaciones
- Comparación de presupuestos con fuentes verificables
- Sistema de reputación de talleres
- Soporte para imágenes y datos OBD-II

---

## Licencia

Pendiente de decisión. Repositorio privado.
