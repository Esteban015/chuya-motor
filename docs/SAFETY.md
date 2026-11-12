# SAFETY — Política de asistencia automotriz

Estado: política v0.5 — 2026-11-12 (Safety Gate v1.5.0). Requiere revisión experta antes de uso en producción real.

## Principio
Chuya Motor ofrece apoyo informativo y documenta incertidumbre. No certifica el estado de un vehículo, no sustituye una inspección in situ y no garantiza la seguridad de una intervención.

## Bloqueos / derivación (D-1 — DECISIONS.md)

Categorías críticas que activan bloqueo y derivación profesional: frenos, dirección, neumáticos con daño crítico, combustible o GNC con fuga/olor, airbags, alta tensión híbrida/eléctrica, fuego, humo, sobrecalentamiento severo, inestabilidad del vehículo.

La política es **determinística y versionada**. El gate evalúa el texto del usuario mediante normalización, búsqueda de frases exactas, co-ocurrencia de stems y clasificación de intención. No depende exclusivamente de coincidencias literales: detecta paráfrasis comunes y distingue intención DIY de descripción de estado pasado o contexto profesional.

**Clasificación de intención:**
- Intención DIY identificada → BLOQUEAR (ej. "quiero arreglar los frenos", "cómo se sangra el circuito hidráulico").
- Descripción de hecho pasado sin agente profesional → NO bloquear (ej. "se me fueron los frenos en la ruta").
- Contexto profesional con tiempo pasado → NO bloquear (ej. "el mecánico arregló los frenos").
- Ambiguo → BLOQUEAR por precaución.
- Descripción de síntoma acotada (v1.4.0, ver abajo) → NO bloquear (ej. "la batería se descarga de noche", "los frenos hacen ruido").

**Calibración de AM-01 por contexto (v0.4 / Safety Gate v1.4.0 — Incremento 6.4C, D-03):**

| Consulta | Comportamiento | Componente |
|---|---|---|
| Síntoma descriptivo de batería convencional 12 V ("se descarga", "no arranca", "quedó tirada", "luz de batería") | Permitida, sin banner | Safety Gate |
| Intervención en batería ("desconecto", "puente", "cables", "cambiar la batería yo mismo") | Bloqueada | Safety Gate |
| Contexto de alta tensión (híbrido, eléctrico, tensión, tracción) o peligro de batería (chispas, hinchada, ácido, olor, calor) | Bloqueada | Safety Gate |
| Ruido o vibración de frenos descriptivo ("hacen ruido", "chillan", "rechinan", "vibran") | Permitida + banner HIGH "Consultá con un taller a la brevedad" | Safety Gate + Severity Assessor |
| Pérdida importante de frenado ("casi no frena", "pedal se hunde", "sin frenos") | Bloqueada + alerta CRITICAL "No conduzcas el vehículo" | Safety Gate + Severity Assessor |
| Reparación de frenos de riesgo (purgar, cambiar pastillas, líquido de frenos) | Bloqueada | Safety Gate |
| Mención ambigua sin descriptor ("Frenos.", "andan raro", "problema con la batería"), sensación del pedal ("el pedal vibra") o persistencia/empeoramiento ("pero ahora…", "siguen…") | Bloqueada por precaución | Safety Gate |

Reglas: la excepción aplica sólo si **todas** las señales de seguridad del texto son de batería 12 V o de ruido de frenos; cualquier otra categoría (dirección, fuego, combustible, …), verbo de intervención o señal de pérdida de frenado mantiene el bloqueo. Las frases exactas (Etapa 2) y la co-ocurrencia DIY (Etapa 3) se evalúan antes y no cambian.

**Justificación del cambio respecto de decisiones anteriores.** DEF-01 (dataset v1.1.0, SYM-003) había ratificado como correcto el bloqueo de cualquier mención ambigua de "batería" como `high_voltage`. Esta política define la categoría como "alta tensión híbrida/eléctrica": una batería de arranque de 12 V que se descarga no es una intervención de alta tensión, y el bloqueo impedía orientar un síntoma común sin aportar protección. De igual modo, "los frenos hacen ruido" se bloqueaba mientras "hace ruido al frenar" se permitía, una inconsistencia sin beneficio de seguridad: con v1.4.0 ambos se permiten y el Severity Assessor muestra la advertencia HIGH determinística. DEF-01 queda superado (dataset v1.2.0). Las exclusiones (alta tensión, peligros, intervención, pedal, persistencia) mantienen el criterio conservador donde el riesgo es real.

**Precedencia de peligros explícitos (v0.5 / Safety Gate v1.5.0, Incremento 6.4D, P0):** un peligro explícito y no negado se evalúa inmediatamente después de las frases exactas y **antes de toda clasificación permisiva**: descripción de síntoma "cuando/al + verbo", consulta educativa, contexto profesional, hecho pasado, presupuesto y la calibración v1.4.0. Defecto corregido: "Cuando arranco, la batería tira chispas" no se bloqueaba porque la regla "cuando + verbo" se evaluaba primero.

| Peligro explícito (`hazard-signals.ts`) | Comportamiento | Advertencia preventiva fija |
|---|---|---|
| Chispas en batería, cables o tablero (no el encendido de bujías); batería hinchada, con pérdida de líquido o ácido, muy caliente, con olor a huevo podrido o que explota | Bloqueada | CRITICAL "No toques la batería ni el cableado…" |
| Fuego, llamas o humo (salvo el humo del escape) | Bloqueada | CRITICAL "…alejate del vehículo… llamá a emergencias (911) o a bomberos (100)" |
| Olor a quemado ("huele a quemado", "olor a cable quemado") | Bloqueada | CRITICAL "Detené el vehículo en un lugar seguro…" |
| Olor o pérdida de nafta, combustible, gas o GNC | Bloqueada | CRITICAL "No arranques ni conduzcas el vehículo…" |

Las advertencias dicen qué **no** hacer y derivan a asistencia profesional. Nunca indican manipular la batería, el cableado, el combustible ni componentes de seguridad.

**Negaciones:** un peligro se ignora sólo si está dentro de una negación explícita de percepción o existencia ("no veo chispas ni olor a quemado", "no hay humo", "sin olor a nafta"), en la misma cláusula y antes de un corte ("pero", "y", puntuación). No cuentan como negación:
- la incertidumbre: "no sé si salen chispas";
- la resolución: "ya no sale humo".

La negación nunca oculta "no frena".

**Pérdida de capacidad de frenado (decisión mantenida de FASE 6 / 6.4B):** no entra en la precedencia anterior. Una mención ambigua se bloquea (AM-01). Una descripción con contexto ("al frenar el auto casi no frena"), una pregunta o un hecho pasado se analizan **con** el banner CRITICAL "No conduzcas el vehículo": el riesgo nunca queda en silencio. Bloquear también estos casos es una alternativa más conservadora, pendiente de la revisión experta.

**Precedencia (D-02):** el Safety Gate decide el bloqueo y el Severity Assessor decide el banner. Si una consulta bloqueada describe pérdida de capacidad de frenado, la respuesta 422 incluye la alerta CRITICAL. Desde v1.5.0, una consulta bloqueada por un peligro explícito recibe la advertencia preventiva correspondiente. Ambos componentes son determinísticos y separados. Sólo comparten catálogos de señales sin dependencias entre sí: `brake-capacity-signals.ts`, `hazard-signals.ts` y la normalización `text-normalization.ts`.

**Validación de salida del LLM (D-05):** toda respuesta generativa de la ruta de síntomas pasa por un validador determinístico del lado servidor antes de llegar al usuario. Si recomienda intervenir sistemas críticos, seguir conduciendo, minimizar el riesgo o evitar al taller ante un riesgo reconocido, se retiene completa y se muestra un aviso fijo; las advertencias determinísticas se mantienen. Ninguna lista de expresiones garantiza detectar todos los riesgos.

**Comprobaciones eléctricas en la salida (validador v1.1.0, RC 6.4F, D-14):**
- **Qué se retiene:** la respuesta se retiene completa, con un aviso explícito de no manipular la batería ni el sistema eléctrico, si propone al usuario una comprobación que implique:
  - desconectar, sacar o manipular la batería o sus bornes;
  - puentear cables o usar cables de arranque;
  - tocar o medir componentes de alta tensión.
- **Formas cubiertas:** se detecta en cualquier forma gramatical, por ejemplo "Se confirmaría si al desconectar la batería…" o "puenteando el relé…".
- **Qué no se retiene:**
  - las prohibiciones ("No desconectes la batería");
  - las comprobaciones atribuidas a un profesional ("Un taller puede medir el consumo…");
  - el discurso referido;
  - las preguntas descriptivas ("¿Alguien desconectó la batería?").
- **Límite de las excepciones:** una mención profesional no excusa una indicación directa al usuario ("Desconectá la batería y llevalo al taller"). Tampoco la excusa una recomendación de terceros ("Muchos mecánicos recomiendan desconectar la batería").

**Normalización del formato (RC 6.4F, D-13):**
- Antes del contrato Zod, que no cambia, se eliminan los elementos que exceden sus límites. Nunca se truncan ni se reescriben.
- Una hipótesis que pierde una salvedad baja a confianza "low".
- El texto eliminado también pasa por el validador: si era inseguro, se retiene toda la respuesta.

Ningún agente generativo puede anular un bloqueo determinístico. Si el proveedor está deshabilitado (interruptor de emergencia, presupuesto agotado o almacén de cuotas no disponible), el Safety Gate y las advertencias determinísticas siguen funcionando. El usuario recibe un aviso fijo y nunca una respuesta simulada en su lugar.

**Cobertura no exhaustiva (obligatorio en todo output del gate):**
> "Este análisis automático no reemplaza la inspección de un profesional. Las reglas de seguridad cubren señales conocidas pero no garantizan la detección de todos los riesgos posibles."

**Derivación cuando hay bloqueo:**
> "Por seguridad, este tipo de intervención requiere atención profesional. No realizarla sin asistencia técnica especializada."

## Guías DIY

**En MVP_01:** no se sirven guías DIY de procedimiento. Solo existen los bloqueos.

**En Fase 2+ (FR-11):** solo actividades expresamente aprobadas de bajo riesgo, con:
- Procedimiento revisado por profesional con licencia compatible.
- Riesgo clasificado como bajo por al menos dos revisores.
- EPP requerido, herramientas, condiciones del lugar y condiciones de parada documentadas.
- Referencia técnica versionada para el vehículo/tarea específica.
- Nivel mínimo de experiencia declarada requerido.

Restricciones permanentes para cualquier guía DIY aprobada: no sugerir trabajar debajo del auto sostenido únicamente por un gato, no manipular componentes presurizados, no intervenir sistemas de la lista de bloqueos, no recomendar puentes, anulaciones de seguridad o modificaciones ilegales.

Si faltan datos del modelo o procedimiento específico, abstenerse de dar pasos específicos.

## Información confiable
Distinguir síntoma, evidencia declarada, verificación documentada, hipótesis y conclusión de profesional. No generar citas, valores de mercado, reputaciones ni probabilidades ficticias.

## Auditoría
Registrar por nodo: versión de la política (`policyVersion`), versión del catálogo de señales (`catalogVersion`), señales detectadas (`matchedSignals`), clasificación de intención (`intentClassification`), si se aplicó regla de negación (`negationApplied`).

No registrar el texto libre del usuario en trazas de producción. Los metadatos son estructurales (ver Ajuste C en DECISIONS.md).

Revisar falsos negativos como incidente prioritario. Mantener archivo de cobertura declarada que liste escenarios probados y escenarios reconocidos como NO cubiertos por la versión actual de la política.
