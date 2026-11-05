// STUB MVP_01 — Evidencias sintéticas para demo y tests.
// Reemplazar con implementación real en Fase 2 cuando existan fuentes verificadas con licencia.
// NUNCA presentar estas evidencias como fuentes reales al usuario.
import type { DocumentSourcePort, SearchContext, SourceEvidence } from './sources-port'

const SYNTHETIC_EVIDENCES: SourceEvidence[] = [
  {
    sourceId: 'stub-brake-001',
    title: 'Síntomas de desgaste de pastillas de freno [DATO DE PRUEBA]',
    excerpt:
      'El ruido al frenar, la vibración en el pedal y el aumento del recorrido son señales de desgaste. [Dato sintético — no usar como referencia real]',
    reliability: 'unverified',
  },
  {
    sourceId: 'stub-noise-001',
    title: 'Causas comunes de ruido en tren delantero [DATO DE PRUEBA]',
    excerpt:
      'El ruido puede indicar desgaste de bujes, rótulas o rodamientos. Se requiere inspección visual. [Dato sintético — no usar como referencia real]',
    reliability: 'unverified',
  },
]

export class StubDocumentSource implements DocumentSourcePort {
  async search(_query: string, _context: SearchContext): Promise<SourceEvidence[]> {
    return SYNTHETIC_EVIDENCES
  }
}
