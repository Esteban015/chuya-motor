# Chuya Motor

**Claridad entre vos y tu taller.**

Plataforma automotriz orientada a LATAM que acompaña al propietario desde la aparición de una falla hasta su resolución: orientación sobre síntomas, mantenimiento y reparaciones sencillas de bajo riesgo, comprensión de presupuestos, comparación de costos cuando existen fuentes verificables, registro de reparaciones y confianza entre conductores y talleres.

> Estado: diseño y validación de MVP para Hackatón Tren Solar (noviembre de 2026). No es una herramienta de diagnóstico definitivo ni sustituye una inspección profesional.

## Líneas del producto

- **Chuya Asistente:** hipótesis orientativas, preguntas guiadas y contexto del vehículo.
- **Chuya Guías:** mantenimiento y tareas de bajo riesgo adaptadas a la experiencia del usuario.
- **Chuya Informe:** lectura y contraste de presupuestos, datos faltantes y evidencia.
- **Chuya Taller:** presupuestos claros y trazabilidad de trabajos por profesionales.
- **Chuya Confianza:** reputación vinculada a reparaciones documentadas, sin certificaciones inventadas.

## Documentación

- [Visión de producto](docs/PRODUCT.md)
- [Requisitos y alcance](docs/REQUIREMENTS.md)
- [Arquitectura general](docs/ARCHITECTURE.md)
- [Arquitectura multiagente](docs/AGENT_ORCHESTRATION.md)
- [Agentes de desarrollo](docs/DEV_AGENTS.md)
- [Seguridad y límites](docs/SAFETY.md)
- [Roadmap](docs/ROADMAP.md)
- [Evidencia de validación](docs/VALIDATION.md)
- [Primer incremento](docs/MVP_01.md)

## Principios

1. Evidencias diferenciadas de hipótesis, sin certeza inventada.
2. Seguridad física primero; no se promueven maniobras peligrosas.
3. Mecánicos y propietarios como colaboradores, no adversarios.
4. Fuentes y precios fechados, con localidad y condiciones.
5. Diseño mobile-first, accesible y trazable.
6. IA solo donde aporta valor; cálculos y controles críticos determinísticos.

## Desarrollo

Arquitectura propuesta: Next.js + TypeScript, Supabase/PostgreSQL, LangGraph JS para los flujos del producto, Claude Code con subagentes para desarrollo; Vitest y Playwright para pruebas. El stack es una **decisión propuesta**, todavía no implementada.

Licencia: pendiente de decisión. Repositorio privado.
