# SAFETY — Política de asistencia automotriz

Estado: política v0.3 — 2026-11-04. Requiere revisión experta antes de uso en producción real.

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

Ningún agente generativo puede anular un bloqueo determinístico.

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
