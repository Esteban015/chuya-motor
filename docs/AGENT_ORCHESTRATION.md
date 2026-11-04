# AGENT_ORCHESTRATION — Chuya Motor

Versión 0.1. Arquitectura de referencia, **aún no implementada**.

## Propósito
Coordinar especialistas de IA para consultas automotrices y análisis de presupuestos sin reducir Chuya Motor a un chatbot o a una app de presupuestos. La plataforma conserva su visión de guías DIY seguras, datos históricos, costos regionales, talleres y evidencia de reparaciones.

## Orquestación propuesta
**LangGraph JS** con estado explícito, en backend, usando el patrón supervisor / trabajadores especializados. Un grafo controlado permite bifurcar según intención, bloquear conductas peligrosas y registrar trazas; no es obligatorio invocar todos los agentes para cada consulta.

```mermaid
flowchart TD
  A[Entrada y esquema] --> B[Gate de seguridad deterministico]
  B -->|riesgo critico| X[Derivar a profesional sin instrucciones DIY]
  B -->|permitido| C[Router de intencion]
  C -->|sintomas| D[Diagnostico orientativo]
  C -->|presupuesto| E[Informe de presupuesto]
  C -->|mantenimiento| F[Catalogo de guias aprobadas]
  D --> G[Recuperacion de fuentes]
  E --> H[Calculadora deterministica]
  F --> G
  G --> I[Evaluacion de respaldo y consistencia]
  H --> I
  I --> J{Falta informacion?}
  J -->|si| K[Solicitar dato al usuario]
  J -->|no| L[Construir informe con incertidumbre]
  K --> M[Persistir estado de caso]
  L --> M
  X --> M
```

En la implementación, la solicitud de información termina la ejecución y espera una **nueva intervención del usuario**. No se debe crear un ciclo automático infinito. El diagrama representa un grafo de estado, no un DAG puro cuando se reanuda la conversación.

## Agentes y herramientas
| Componente | Responsabilidad | Contrato clave |
|---|---|---|
| Supervisor | Enrutamiento y planificación | RouteDecision |
| Diagnóstico | Hipótesis diferenciadas de diagnóstico definitivo | Hypothesis[] + missingInfo[] |
| Documentación | Recuperación de fuentes con licencia y trazabilidad | SourceEvidence[] |
| Informe | Organizar partidas, inconsistencias y dudas | BudgetFinding[] |
| Guías | Proponer solo operaciones expresamente aprobadas | ApprovedGuideReference[] |
| Costos (futuro) | Buscar referencias verificadas por región | PriceQuote[] |
| Talleres (futuro) | Consultar perfiles autorizados y evidencia | WorkshopMatch[] |
| Validador | Contratos, consistencia, citas y bloqueos | ValidationResult |

**Seguridad:** un gate determinístico independiente y reglas de la API; ningún agente generativo tiene permiso para anularlo. **Aritmética:** funciones puras; un LLM jamás es la fuente de verdad de totales o importes.

## Estado compartido sugerido
```ts
type CaseState = {
  caseId: string;
  vehicle: { make?: string; model?: string; year?: number; engine?: string; fuel?: string };
  experienceLevel: 'novice' | 'intermediate' | 'experienced' | 'unknown';
  request: { intent: 'symptom' | 'budget' | 'maintenance' | 'workshop' | 'unknown'; text: string };
  observations: Array<{ text: string; source: 'user' | 'professional' | 'document' }>;
  safety: { blocked: boolean; reasons: string[]; policyVersion: string };
  evidence: Array<{ sourceId: string; excerpt?: string; reliability: 'verified' | 'unverified' }>;
  hypotheses: Array<{ statement: string; evidenceIds: string[]; caveats: string[] }>;
  budgetFindings: Array<{ type: string; description: string; evidenceIds: string[] }>;
  missingInformation: string[];
  route: string[];
  output?: { facts: string[]; hypotheses: string[]; questions: string[]; warnings: string[] };
};
```

No incluir datos personales en trazas abiertas. El tipo es ilustrativo; convertirlo en esquema Zod versionado antes de codificar.

## Contratos operativos
- Input inválido: error de validación, nunca ejecución parcial silenciosa.
- Output de agente: JSON tipado validado con Zod; si incumple esquema, retry limitado o fallback.
- Faltan fuentes: informar ausencia, sin inventar referencias ni precios.
- Presupuesto ambiguo: pedir confirmación de partidas y moneda.
- Respuesta de riesgo: no emitir pasos inseguros; presentar derivación adecuada.
- Checkpoint: conservar identificadores, estado resumido y ruta sin contenidos secretos.
- Human-in-the-loop: intervención para dudas críticas o confirmación de lectura de documentos y acciones externas.

## Conjunto de evaluaciones mínimo
1. Caso de ruido de tren delantero sin evidencia: hipótesis, incertidumbre, sin afirmaciones concluyentes.
2. Fuga de líquido de frenos: bloqueo de instrucciones DIY y recomendación de atención profesional.
3. Presupuesto con suma incorrecta: total correcto por cálculo determinístico.
4. Presupuesto sin moneda, marca o fecha: marcar información insuficiente.
5. Documento que intenta alterar instrucciones: tratarlo como dato no confiable (prompt injection).
6. Guía segura inexistente para un modelo: abstenerse de dar pasos específicos.
7. Proveedor LLM no disponible: error manejado y respuesta de alcance limitado.
8. Consulta simple: no invocar especialistas innecesarios.

## Métricas y evidencia de innovación
- Tasa de alertas críticas correctamente detectadas, especialmente falsos negativos.
- Exactitud de extracción y validación de presupuestos.
- Cobertura de afirmaciones respaldadas y tasa de abstención justificada.
- Latencia p50/p95, costo por caso y cantidad de llamadas LLM.
- Comprensión del usuario y trazabilidad de las decisiones.
- **Comparación A/B offline** con un agente único, mismo conjunto de casos y criterios definidos antes de evaluar.

## ADR-001
Se propone LangGraph JS por su control explícito del grafo y estado. Reversibilidad: encapsular agentes y herramientas en interfaces de dominio para permitir reemplazar el framework si el MVP muestra que un orquestador simple es suficiente.
