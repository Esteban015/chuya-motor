# DEV_AGENTS — Orquestación del equipo de desarrollo

## Objetivo
Utilizar Claude Code con subagentes especializados para implementar Chuya Motor con trazabilidad, sin confundir estos agentes de desarrollo con los agentes que atenderán al usuario dentro del producto.

## Roles
- Product Analyst: historias, criterios de aceptación, límites de alcance.
- Software Architect: decisiones técnicas, contratos y evolución del grafo.
- Frontend Engineer: experiencia mobile-first, accesibilidad, estados y presentación honesta.
- Backend Engineer: dominio, persistencia, autorización y servicios.
- AI Engineer: orquestación, esquemas, prompts, evaluaciones y observabilidad.
- QA Engineer: escenarios de riesgo, Vitest, Playwright, regresiones, evidencias.
- Security Reviewer: privacidad, secretos, autorización, prompt injection y seguridad física.

## Flujo sugerido
1. Product Analyst redacta la historia y aceptación.
2. Architect identifica dependencias y archivos.
3. Especialistas de frontend, backend e IA trabajan en tareas independientes, preferiblemente sin editar archivos compartidos simultáneamente.
4. QA revisa criterios, escribe pruebas e informa hallazgos.
5. Security Reviewer inspecciona riesgos.
6. Integrador corrige, ejecuta pruebas y prepara PR.
7. Revisión humana antes de merge; ningún subagente aprueba automáticamente su propia implementación.

## Reglas
- Los subagentes no pueden afirmar que ejecutaron comandos que no ejecutaron.
- No hacer cambios fuera del alcance ni revelar secrets.
- Evitar concurrencia sobre los mismos archivos; paralelizar lectura y revisión o módulos bien separados.
- Si una función depende de fuentes no disponibles, crear una interfaz o mock etiquetado; nunca datos reales ficticios.
- Mantener el código bajo un monolito modular hasta demostrar necesidad de complejidad adicional.
- Terminar cada incremento con archivos, tests ejecutados, errores, evidencias y riesgos.

## Control de versiones
Repo privado, rama estable `main` o `master` según configuración de GitHub, ramas de feature y PR. No imponer reglas imposibles para un colaborador único: el humano puede ser el aprobador final, con CI y checklist. Configurar protecciones cuando CI exista.

## Preparación práctica
Los archivos de `.claude/agents/` son definiciones de roles para invocar desde Claude Code; el supervisor operativo es la sesión principal o una skill específica. No hay todavía un DAG autónomo de desarrollo con motor externo. La implementación real de orquestación de desarrollo puede evolucionar tras verificar la ejecución de los subagentes.
