# ARCHITECTURE — Chuya Motor

Versión v0.2 — propuesta, todavía sin código productivo.

## Decisiones iniciales
- Monolito modular: Next.js App Router, TypeScript, Tailwind.
- Persistencia futura: PostgreSQL/Supabase con Row Level Security, almacenamiento de adjuntos privado y políticas de retención.
- Motor de orquestación de producto: LangGraph JS, en servicio backend (nunca en navegador con credenciales).
- Modelos mediante adaptador desacoplado; configurables por proveedor y con test doubles.
- Esquemas Zod para contratos de estados y resultados; cálculos determinísticos en dominio.
- Vitest para lógica y grafos simulados, Playwright E2E, GitHub Actions CI.

## Módulos
1. web: experiencia, casos e informes.
2. domain: vehículo, caso, presupuesto, evidencias y políticas.
3. agents: orquestador, especialidades, adaptadores LLM y observabilidad.
4. sources: recuperación de documentos autorizados, cotizaciones fechadas y registros de talleres cuando existan.
5. persistence: datos privados, estados de caso, trazas y consentimiento.

## Entidades previstas
User, Vehicle, Case, Symptom, Observation, Evidence, DocumentSource, AgentRun, Budget, BudgetLine, Workshop, RepairJob, Feedback.

Todo precio debe modelar moneda, jurisdicción, vigencia, fuente, unidad, impuestos y condiciones. Para dinero utilizar decimales exactos o enteros en unidad menor, nunca floats para totalización financiera.

## Flujo
Cliente -> API autenticada -> validación de entrada -> política de seguridad -> grafo -> herramientas verificadas -> validador -> respuesta estructurada -> UI.

## Seguridad técnica
Validación y límites del lado servidor, cuotas por usuario, control del acceso a herramientas, ningún secreto en prompts o traces, prevención de prompt injection en documentos, filtrado de PII, autorización a nivel de fila, consentimiento para compartir casos. No ejecutar comandos ni herramientas con privilegios arbitrarios inducidos por un texto del usuario.

## Decisiones pendientes
Estrategia de despliegue duradero del grafo, versiones de proveedores LLM, fuente inicial de documentación técnica con licencias adecuadas, política de retención y criterios de revisión profesional.

Consultar [orquestación](AGENT_ORCHESTRATION.md) y [seguridad](SAFETY.md).
