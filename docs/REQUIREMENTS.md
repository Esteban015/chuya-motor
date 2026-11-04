# REQUIREMENTS — Chuya Motor

Versión v0.2. Prioridades P0 (MVP), P1 (siguiente), P2 (visión).

## P0 — MVP hackatón
- FR-01: visitante puede describir síntomas y contexto mínimo del vehículo, con preguntas guiadas y mensajes de privacidad.
- FR-02: usuario recibe hipótesis **orientativas**, información faltante y sugerencias seguras; sistema no afirma diagnóstico concluyente.
- FR-03: casos con señales de peligro activan derivación profesional y bloquean instrucciones DIY no autorizadas.
- FR-04: usuario introduce presupuesto en texto; sistema identifica partidas y detecta importes/totales no consistentes, sin inventar precios.
- FR-05: informe distingue hechos del usuario, información respaldada, hipótesis e incertidumbres; ofrece preguntas concretas al taller.
- FR-06: ejecución multiagente deja traza por nodo con versiones, rutas, fallos y fuentes sin exponer secretos.
- FR-07: demo con datos sintéticos claramente etiquetados; nunca se presenta como cotización real.
- FR-08: pruebas unitarias para reglas/cálculos, integración con agentes simulados y E2E del recorrido principal.

## P1 — Producto ampliado
- FR-09: perfil de vehículo e historial voluntario.
- FR-10: entrada de imágenes/PDF con revisión humana de extracción.
- FR-11: biblioteca de guías DIY de bajo riesgo, aprobadas por modelo y tarea, y evaluación del nivel de experiencia.
- FR-12: costos por pieza/trabajo con fuente, localidad, fecha, impuestos, garantía y condiciones; abstención si faltan datos.
- FR-13: presupuestos profesionales y evidencias aportadas por talleres.

## P2 — Ecosistema
- FR-14: marketplace de talleres especializado y geolocalizado.
- FR-15: reputación basada en reparaciones documentadas, controles antiabuso y derecho de réplica.
- FR-16: comparación de presupuestos equivalentes y seguimiento de resultados.
- FR-17: soporte para mercados LATAM y fuentes locales.

## Criterios de aceptación transversales
- Un presupuesto incorrecto no debe reportarse como suma válida.
- Una afirmación sin respaldo debe aparecer marcada como hipótesis o dato faltante.
- No se muestran instrucciones peligrosas de intervención en frenos, dirección, airbags, alta tensión, combustibles o GNC.
- Cada tarea DIY necesita clasificación de riesgo, precauciones, condiciones de parada y referencia técnica revisada.
- Las respuestas no podrán inventar talleres, reputación, precios ni fuentes.
- Una falla de proveedor LLM no provoca una respuesta de certeza falsa; se utiliza fallback explícito.
- El usuario conserva control sobre datos personales y evidencias de su vehículo.

## No objetivos iniciales
Diagnóstico definitivo remoto, sustitución de profesionales, pagos, mecánicos certificados automáticamente, scraping masivo, lectura OBD2 real, app móvil nativa, instrucciones de reparación sobre sistemas críticos.

## Definition of Done
Criterio de aceptación implementado, tests reproducibles y en verde, estados de error, seguridad revisada, accesibilidad básica, trazas revisadas, documentación y demo comprobada; no afirmar pruebas no ejecutadas.
