# Revisión de seguridad — Luz de check engine (bugfix 7B)

Rama: `fix/driver-vs-workshop-questions`. Fecha: 2026-11-14. Sin llamadas reales a proveedores LLM.

## 1. Hallazgo

El Severity Assessor (`src/domain/safety/severity-assessor.ts`) no tenía ninguna regla para la luz
de motor (check engine / MIL). Una luz **que parpadea** —que las fuentes describen como un problema
serio que requiere acción inmediata— no generaba banner, igual que una luz fija.

Durante la auditoría apareció un segundo defecto, propio del bugfix 7B: el asistente `/demo/falla`
agrega `Condición de ocurrencia: <opción>.` al texto y una de las opciones es **"Intermitente"**
(= el problema ocurre a veces). `question-audience.ts` 1.0.0 leía ese sufijo como si describiera la
luz ("Cuando decís que la luz está intermitente…" sin que la persona lo hubiera dicho) y "Siempre"
como "la luz se enciende siempre".

## 2. Fuentes

| Fuente | Qué dice (resumen / cita breve) |
|---|---|
| Consumer Reports en español, *Qué significa la luz de Check Engine* — https://www.consumerreports.org/es/autos/como-se-ve-luz-de-check-engine-y-que-significa-a2569494257/ | Parpadeante: "indica un problema que necesita atención inmediata"; "debes reducir la potencia y llevar el coche a un mecánico". Fija: "el problema no es una emergencia, pero debes programar una cita lo antes posible". |
| Consumer Reports, *What Does the Check Engine Light Look Like, and What Does It Mean?* — https://www.consumerreports.org/cars/car-repair-maintenance/what-does-check-engine-light-mean-a2041364753/ | Si parpadea o hay problemas serios de funcionamiento (pérdida de potencia), reducir la velocidad y la exigencia del motor; en autos modernos suele indicar una falla de encendido severa que puede dañar rápidamente el catalizador (consultado vía resumen de búsqueda). |
| AAA, *The Check Engine Light: Common Causes and How To Fix It* — https://www.aaa.com/autorepair/articles/the-check-engine-light-common-causes-and-how-to-fix-it | Fija: no es una amenaza inmediata salvo que se note algo mal; programar mecánico. Parpadeante: problema más serio, probablemente falla de encendido; si pierde potencia, se sacude u huele raro, detenerse en cuanto sea seguro. |
| EPA, OBD Frequently Asked Questions (archivo) — https://webarchive.library.unt.edu/eot2008/20090115191057/http://epa.gov/obd/questions.htm | Luz que parpadea = problema severo (p. ej. falla de encendido que puede dañar el catalizador), atender lo antes posible. *El texto no pudo descargarse en esta revisión; se cita por el resumen de búsqueda.* |

Las fuentes coinciden en: **parpadeo ⇒ urgente, reducir exigencia, taller cuanto antes, detenerse
si hay síntomas de funcionamiento anormal**; **fija ⇒ no es emergencia, revisar pronto**. Ninguna
indica "no conducir" por la sola luz parpadeante; AAA lo indica si además hay pérdida de potencia,
sacudidas u olores. Las instrucciones del manual del fabricante de cada vehículo prevalecen.

## 3. Decisión de severidad (revisada antes del PR)

### 3.1 Contraste de recomendaciones para la luz que parpadea

| Fuente | Recomendación |
|---|---|
| Consumer Reports (ES) | Atención inmediata; reducir la potencia y llevarlo a un mecánico. |
| Consumer Reports (EN, resumen) | Reducir velocidad y exigencia; revisión lo antes posible; en el artículo relacionado, detenerse y pedir grúa. |
| AAA | Problema más serio que la luz fija; si pierde potencia, se sacude u huele raro, detenerse en cuanto sea seguro; FAQ: "pull over immediately and shut off the engine". |
| EPA (resumen) | Problema severo; atender lo antes posible. |

La primera versión del banner ("…llevá el vehículo a un taller lo antes posible") seguía a Consumer
Reports pero podía leerse como "seguí manejando hasta el taller". Se reforzó con el criterio más
conservador de AAA: **no seguir circulando normalmente, detenerse en un lugar seguro, apagar el motor
y pedir asistencia o grúa**; detenerse de inmediato si hay pérdida de potencia, sacudidas, humo u olor.

**Se mantiene HIGH.** Ninguna fuente indica "no conducir en absoluto" por la luz parpadeante sola
(AAA lo condiciona a síntomas de funcionamiento anormal, que el texto del banner cubre). CRITICAL en
Chuya Motor muestra "No conduzcas el vehículo" y queda reservado a pérdida de frenado e incendio /
combustible / olor a quemado.

### 3.2 Casos

| Caso | Estado (`engine-light-signals.ts`) | Resultado |
|---|---|---|
| Parpadeo confirmado ("parpadea", "titila", "destella") | `blinking` | **HIGH** "Atención: luz de motor que parpadea". Acción: "No sigas circulando normalmente. Reducí la velocidad, evitá aceleraciones fuertes y, en cuanto puedas, detenete en un lugar seguro y apagá el motor. Pedí asistencia mecánica o una grúa para llegar al taller. Si pierde potencia, se sacude o notás humo u olor extraño, detenete de inmediato; si hay humo, alejate del vehículo y llamá a emergencias (911)." |
| Luz fija ("fija", "queda encendida", "se enciende siempre") | `steady` | Sin banner (no es emergencia). Preguntas: estado de la luz al conductor, códigos OBD-II al taller. |
| Aparece ocasionalmente ("a veces", ocurrencia "Intermitente" del asistente) | `occasional` | Sin banner. Pregunta al conductor si queda fija o parpadea cuando aparece. |
| Descripción ambigua ("intermitente" junto a la luz de motor) | `ambiguous_intermittent` | **HIGH condicional**: si parpadea, la misma indicación de detenerse y pedir asistencia; si queda fija o aparece a veces, revisión pronto. |
| Síntomas críticos concurrentes (pérdida de frenado, humo, olor a nafta/gas, olor a quemado) | — | **Sin cambios**: el Safety Gate bloquea y muestra la alerta CRITICAL específica (incendio, combustible, frenos). La luz parpadeante nunca la reemplaza. |
| Síntomas HIGH concurrentes (ruido de frenos, pérdida de fluido, pérdida de potencia) | `blinking` | Banner de luz parpadeante: sus reglas se evalúan **primero** entre las HIGH para que la indicación de detenerse no quede oculta por otro banner HIGH. |

**Alcance:** dos reglas HIGH al principio de `HIGH_RULES`. Sin cambios en el Safety Gate, las reglas
CRITICAL, la política de consultas bloqueadas (`resolveUserFacingSeverity`) ni en los textos de las
demás reglas. Con severidad HIGH, output safety retiene respuestas del LLM que animen a seguir
manejando (comportamiento existente para HIGH).

**Comportamientos previos observados, no modificados:** "…parpadea y la temperatura sube" y "…parpadea
y vibra el volante" ya son bloqueados por el Safety Gate; en el primer caso el bloqueo no lleva banner
de severidad (política de consultas bloqueadas vigente). Queda como hallazgo para revisar aparte.

## 4. Compatibilidad del esquema de preguntas con Groq (sin llamadas reales)

- `groq-adapter.ts` no usa `response_format` ni JSON schema estricto: las claves nuevas
  (`driverQuestions`, `workshopQuestions`) no rompen la llamada.
- Si el modelo responde con el formato anterior (`questions`), la normalización lo acepta y
  `question-audience.ts` reclasifica por destinatario (test QA-02). Si omite una de las dos listas,
  se registra `invalid_type` estructural y la lista queda vacía (no hay fallback por eso).
- **Tokens:** el prompt de sistema creció de ~2 930 a ~3 900 caracteres (≈ +250–300 tokens de
  entrada por análisis). La salida puede sumar hasta 5 preguntas más (≤ 300 caracteres cada una).
  Con `GROQ_MAX_TOKENS=2048` (incluye razonamiento) y el presupuesto diario `LLM_DAILY_TOKEN_BUDGET`
  (60 000 por defecto), el riesgo es (a) más respuestas truncadas (`finish_reason=length` → fallback
  seguro) y (b) agotar el cupo diario con menos análisis. **No medido**: requiere la corrida real
  autorizada (`npm run pilot:groq` / `review:groq`).
- Las herramientas de revisión (`benchmark/review`) ahora leen `driverQuestions`: el control
  "información insuficiente" exige preguntas para la persona (las del taller siempre incluyen
  preguntas fijas y ya no prueban nada) y los detectores de consejos peligrosos, registro formal y
  duplicados cubren ambas listas.

## 5. Limitaciones

- Detección por lista de frases (español de Argentina). Paráfrasis no previstas ("se apaga y prende
  rápido", "hace guiños") caen en `unspecified` → sin banner; la pregunta al conductor sigue pidiendo
  aclarar el estado.
- "La luz intermitente" sin decir qué luz no genera banner (podría ser una luz de giro): se pregunta.
- Los textos de severidad y de preguntas fijas no fueron revisados por un mecánico matriculado.
- El manual del fabricante prevalece; la app no conoce las indicaciones específicas de cada modelo.
