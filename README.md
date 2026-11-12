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

> Las variables `*_API_KEY` son secretos. Nunca las pongas en archivos commiteados, variables `NEXT_PUBLIC_*` ni en el cliente.

---

## Modo simulado vs LLM real

| | Stub (por defecto) | LLM real |
|---|---|---|
| Llamadas externas | ❌ Ninguna | ✅ Gemini o Anthropic |
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
npm test                  # todos los tests (vitest run) — actualmente 635/635
npm run test:watch        # modo watch interactivo
npm run test:coverage     # con cobertura V8
```

Los tests de Vitest cubren: dominio (`src/domain/`), API route handlers (`src/app/api/`), adaptadores LLM, orquestación LangGraph y el módulo de benchmark.

### Tests E2E — Playwright

Hay dos suites:

```bash
# Suite producción — 22 tests (requiere build previo con npm run build)
npm run test:e2e

# Suite desarrollo — 3 tests que requieren servidor de desarrollo
npm run test:e2e:dev

# Interfaz visual interactiva
npm run test:e2e:ui

# Listar todos los tests sin ejecutarlos
npm run test:e2e:list
```

> La suite de producción arranca automáticamente el servidor (`npm run start`) si no hay uno corriendo en el puerto 3000. Para CI, establecé la variable `CI=true` — así usa el servidor de producción y no reutiliza uno existente.

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
  │  Rate limit: 10 req/min por IP (en memoria, demo únicamente)
  │
  ▼
LangGraph — analyze-graph (src/agents/graph/)
  │
  ├─► validator        verificación de formato
  ├─► safetyGate       Safety Gate determinístico v1.3.0
  │     4 etapas: normalización → frases exactas → co-ocurrencia de stems → intención
  │     Ningún agente puede anular un bloqueo del Safety Gate
  │
  ├─► router           clasifica como symptom / budget / clarification (determinístico)
  │
  ├─► diagnosisAgent   genera hipótesis orientativas (usa LLM)
  │     └─► LLM Adapter (stub / Gemini / Anthropic)
  │
  └─► budgetParser     analiza líneas de presupuesto (usa LLM)
        └─► LLM Adapter
  │
  ▼
ClientAnalyzeOutput
  │  route · hypotheses · facts · questions / budgetResult
  │  severity (evaluación determinística de gravedad)
  │  safetyBlocked · nodeTrace (solo en desarrollo)
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
- **Rate limit en memoria:** 10 req/min por IP. Si el proceso se reinicia, el contador se resetea.
- **Un solo vehículo por consulta:** no hay historial ni comparación entre casos.
- **Hipótesis orientativas únicamente:** no se emiten recomendaciones de reparación DIY.
- **Solo texto:** no se procesan imágenes, audio ni datos OBD-II.
- **Plataforma de benchmark sin producción:** `benchmark/` evalúa calidad del LLM pero no ejecuta llamadas reales por defecto.

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
