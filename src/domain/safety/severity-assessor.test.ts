/**
 * severity-assessor.test.ts — deterministic severity assessment tests.
 *
 * All tests must run without real LLM calls.
 * RED → GREEN flow: written before implementation, then implementation makes them pass.
 *
 * Note on userText: in production, the falla page sends:
 *   `${symptomText}. Condición de ocurrencia: ${occurrence}.`
 * Many inputs only pass the Safety Gate because "al frenar" / "al arrancar" is appended
 * by the occurrence field. These tests use the combined text to match production behavior.
 */

import { describe, it, expect } from 'vitest'
import { assessSeverity } from './severity-assessor'

// ── SV-01: CRITICAL — pedal extreme travel ───────────────────────────────────

describe('SV-01: CRITICAL — pedal requires extreme travel to brake', () => {
  it('SV-01-A: "pisar el pedal muy a fondo para frenar" → critical', () => {
    const result = assessSeverity(
      'Es necesario pisar el pedal muy a fondo para que comience a frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
    expect(result!.title).toContain('crítico')
  })

  it('SV-01-B: "El pedal de freno se va al fondo" → critical', () => {
    const result = assessSeverity(
      'El pedal de freno se va al fondo. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-01-C: action text directs to professional urgently', () => {
    const result = assessSeverity(
      'Tengo que pisar muy a fondo el pedal para frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
    expect(result!.action).toMatch(/no conduc|asistencia profesional/i)
  })
})

// ── SV-02: CRITICAL — braking clearly insufficient ───────────────────────────

describe('SV-02: CRITICAL — braking clearly insufficient', () => {
  it('SV-02-A: "frena muy poco" → critical', () => {
    const result = assessSeverity(
      'El auto frena muy poco cuando piso el freno. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })
})

// ── SV-03: HIGH — vibration when braking ─────────────────────────────────────

describe('SV-03: HIGH — vibration when braking', () => {
  it('SV-03-A: "vibración al frenar" → high', () => {
    const result = assessSeverity(
      'Siento vibración al frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })

  it('SV-03-B: level high, NOT critical', () => {
    const result = assessSeverity(
      'Noto una vibración cuando freno fuerte. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result?.level).toBe('high')
  })
})

// ── SV-04: HIGH — noise when braking ─────────────────────────────────────────

describe('SV-04: HIGH — noise when braking', () => {
  it('SV-04-A: "ruido al frenar" → high', () => {
    const result = assessSeverity(
      'Escucho un ruido al frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })

  it('SV-04-B: "chirri al frenar" → high', () => {
    const result = assessSeverity(
      'Los frenos chirrían cuando los uso. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })
})

// ── SV-05: NORMAL — non-critical symptom returns null ────────────────────────

describe('SV-05: NORMAL — non-safety-critical symptom', () => {
  it('SV-05-A: engine noise when cold starting → null (no banner)', () => {
    const result = assessSeverity(
      'El motor hace un ruido extraño al arrancar en frío. Condición de ocurrencia: Al arrancar.',
      'symptom',
    )
    // May be null (no banner) or possibly low-severity; must NOT be critical or high
    if (result !== null) {
      expect(result.level).not.toBe('critical')
      expect(result.level).not.toBe('high')
    } else {
      expect(result).toBeNull()
    }
  })

  it('SV-05-B: AC not working → null (no banner)', () => {
    const result = assessSeverity(
      'El aire acondicionado no enfría. Condición de ocurrencia: Siempre.',
      'symptom',
    )
    expect(result).toBeNull()
  })

  it('SV-05-C: windshield wiper issue → null', () => {
    const result = assessSeverity(
      'Los limpiaparabrisas no funcionan bien con lluvia fuerte.',
      'symptom',
    )
    expect(result).toBeNull()
  })
})

// ── SV-06: route guard — only runs for symptom route ─────────────────────────

describe('SV-06: route guard', () => {
  it('SV-06-A: route=budget → null regardless of text', () => {
    const result = assessSeverity(
      'Es necesario pisar el pedal muy a fondo para que comience a frenar.',
      'budget',
    )
    expect(result).toBeNull()
  })

  it('SV-06-B: route=null → null', () => {
    const result = assessSeverity(
      'Es necesario pisar el pedal muy a fondo para que comience a frenar.',
      null,
    )
    expect(result).toBeNull()
  })

  it('SV-06-C: route=clarification → null', () => {
    const result = assessSeverity(
      'El pedal de freno se va al fondo.',
      'clarification',
    )
    expect(result).toBeNull()
  })
})

// ── SV-07: HIGH — steering difficulty ────────────────────────────────────────

describe('SV-07: HIGH — steering problems', () => {
  it('SV-07-A: "dirección muy dura" → high', () => {
    const result = assessSeverity(
      'La dirección está muy dura, cuesta mucho girar el volante.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })

  it('SV-07-B: "vibración en el volante" → high', () => {
    const result = assessSeverity(
      'Siento vibración en el volante cuando manejo a alta velocidad.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })
})

// ── SV-08: HIGH — engine temperature ─────────────────────────────────────────

describe('SV-08: HIGH — engine temperature', () => {
  it('SV-08-A: "temperatura del motor elevada" → high', () => {
    const result = assessSeverity(
      'La luz de temperatura del motor se enciende en el tablero.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })
})

// ── SV-09: HIGH — fluid loss ──────────────────────────────────────────────────

describe('SV-09: HIGH — visible fluid loss', () => {
  it('SV-09-A: "pierde aceite" → high', () => {
    const result = assessSeverity(
      'El motor pierde aceite, veo manchas en el piso.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
  })
})

// ── SV-10: assessment structure completeness ──────────────────────────────────

describe('SV-10: assessment structure', () => {
  it('SV-10-A: critical result has all required fields', () => {
    const result = assessSeverity(
      'Tengo que pisar muy a fondo el pedal para frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(typeof result!.level).toBe('string')
    expect(typeof result!.title).toBe('string')
    expect(typeof result!.message).toBe('string')
    expect(typeof result!.action).toBe('string')
    expect(result!.title.length).toBeGreaterThan(0)
    expect(result!.message.length).toBeGreaterThan(0)
    expect(result!.action.length).toBeGreaterThan(0)
  })

  it('SV-10-B: high result has all required fields', () => {
    const result = assessSeverity(
      'Siento vibración al frenar. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('high')
    expect(result!.title.length).toBeGreaterThan(0)
    expect(result!.action.length).toBeGreaterThan(0)
  })
})

// ── SV-11: CRITICAL — frenos no se accionan con pedal al fondo ───────────────

describe('SV-11: CRITICAL — frenos no se accionan con pedal al fondo', () => {
  it('SV-11-A: "frenos no se accionan al apretar el pedal al fondo" → critical', () => {
    const result = assessSeverity(
      'Los frenos no se accionan al apretar el pedal al fondo.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-11-B: critical action directs not to drive', () => {
    const result = assessSeverity(
      'Los frenos no se accionan al apretar el pedal al fondo.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.action).toMatch(/no conduzc|asistencia profesional/i)
  })
})

// ── SV-12: CRITICAL — pedal se hunde hasta el fondo ──────────────────────────

describe('SV-12: CRITICAL — pedal de freno se hunde hasta el fondo', () => {
  it('SV-12-A: "El pedal de freno se hunde hasta el fondo y no frena" → critical', () => {
    const result = assessSeverity(
      'El pedal de freno se hunde hasta el fondo y no frena.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })
})

// ── SV-13: CRITICAL — freno al/hasta el fondo sin usar pedal/pisar ───────────
// Estos casos NO son detectados por la implementación actual → RED

describe('SV-13: CRITICAL — freno hasta/al fondo sin "pedal" ni "pisar"', () => {
  it('SV-13-A: "Tengo que apretar el freno hasta el fondo para detener el auto" → critical', () => {
    const result = assessSeverity(
      'Tengo que apretar el freno hasta el fondo para detener el auto.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-13-B: "Presiono el freno al fondo y el auto no se detiene" → critical', () => {
    const result = assessSeverity(
      'Presiono el freno al fondo y el auto no se detiene correctamente.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-13-C: "frenos al fondo sin respuesta" → critical', () => {
    const result = assessSeverity(
      'Los frenos al fondo no responden.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })
})

// ── SV-14: CRITICAL — apenas frena ───────────────────────────────────────────
// Estos casos NO son detectados por la implementación actual → RED

describe('SV-14: CRITICAL — apenas frena o frenado insuficiente', () => {
  it('SV-14-A: "El vehículo apenas frena" → critical', () => {
    const result = assessSeverity(
      'El vehículo apenas frena.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-14-B: "apenas puedo frenar" → critical', () => {
    const result = assessSeverity(
      'Apenas puedo frenar cuando necesito detenerme.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-14-C: "frena apenas" → critical', () => {
    const result = assessSeverity(
      'El auto frena apenas cuando piso el pedal con fuerza.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })
})

// ── SV-15: NORMAL — frena correctamente, sin crítico ─────────────────────────

describe('SV-15: NORMAL — frena correctamente, negaciones benignas', () => {
  it('SV-15-A: "El auto frena normalmente" → not critical', () => {
    const result = assessSeverity(
      'El auto frena normalmente sin ningún problema.. Condición de ocurrencia: Siempre.',
      'symptom',
    )
    if (result !== null) expect(result.level).not.toBe('critical')
  })

  it('SV-15-B: "No tengo problemas con los frenos" → not critical', () => {
    const result = assessSeverity(
      'No tengo problemas con los frenos, todo funciona bien.. Condición de ocurrencia: Siempre.',
      'symptom',
    )
    if (result !== null) expect(result.level).not.toBe('critical')
  })

  it('SV-15-C: "freno al final de la calle sin problemas" → not critical', () => {
    // "freno al final" should NOT trigger the fren+fondo rule (no "fondo" in text)
    const result = assessSeverity(
      'Freno al final de la calle sin problemas.. Condición de ocurrencia: Siempre.',
      'symptom',
    )
    if (result !== null) expect(result.level).not.toBe('critical')
  })

  it('SV-15-D: "apenas llueve freno con más cuidado" → not critical (apenas not related to braking)', () => {
    // "apenas" appears but not adjacent to a brake verb → should NOT be critical
    const result = assessSeverity(
      'Apenas llueve tiendo a frenar con más cuidado. Condición de ocurrencia: Intermitente.',
      'symptom',
    )
    if (result !== null) expect(result.level).not.toBe('critical')
  })
})

// ── SV-16: Responsabilidades separadas ───────────────────────────────────────

describe('SV-16: responsabilidades separadas Safety Gate vs Severity Assessor', () => {
  it('SV-16-A: assessSeverity opera independientemente del Safety Gate', () => {
    // La función solo recibe texto normalizado y route — no llama al Safety Gate
    const result = assessSeverity(
      'El pedal de freno se va al fondo sin resistencia.. Condición de ocurrencia: Al frenar.',
      'symptom',
    )
    // "pedal" + " de freno se va al " (19 chars) + "fond" → 19 ≤ 35 → Rule 1 matches
    expect(result).not.toBeNull()
    expect(result!.level).toBe('critical')
  })

  it('SV-16-B: route no-symptom siempre retorna null sin importar el texto', () => {
    const criticalText = 'Tengo que apretar el freno hasta el fondo para detener el auto.'
    expect(assessSeverity(criticalText, 'budget')).toBeNull()
    expect(assessSeverity(criticalText, null)).toBeNull()
    expect(assessSeverity(criticalText, 'clarification')).toBeNull()
  })
})

// ── SV-17: Safety Gate — consultas bloqueadas no reciben severity ─────────────

describe('SV-17: consultas bloqueadas por Safety Gate — severity es null en API', () => {
  it('SV-17-A: assessSeverity nunca es invocado cuando safetyBlocked=true (ruta en route.ts)', () => {
    // Este test verifica la garantía del contrato de route.ts:
    // severity: output.safetyBlocked ? null : assessSeverity(userText, output.route)
    // No podemos testear route.ts directamente aquí, pero verificamos que
    // assessSeverity no "bloquea" por sí misma — el bloqueo pertenece al Safety Gate.
    // El Severity Assessor solo clasifica; no tiene acceso a safetyBlocked.
    const textThatSafetyGateBlocks = 'El pedal al fondo y los frenos no frenan nada.'
    // Llamado directamente con route=symptom, retorna un resultado
    // (en producción nunca llegaría aquí si safetyBlocked=true)
    const result = assessSeverity(textThatSafetyGateBlocks, 'symptom')
    // La función retorna un resultado o null — no lanza ni bloquea
    expect(() => assessSeverity(textThatSafetyGateBlocks, 'symptom')).not.toThrow()
    if (result !== null) {
      expect(['normal', 'high', 'critical']).toContain(result.level)
    }
  })
})
