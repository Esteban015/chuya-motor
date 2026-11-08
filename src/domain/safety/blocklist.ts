// D-1: Versioned safety signal catalog.
// Each group: category, keywords (single tokens), phrases (multi-token).
// Policy version bumped when groups are added/changed.
export const SAFETY_POLICY_VERSION = '1.3.0'

export interface SignalGroup {
  category: string
  keywords: string[]
  phrases: string[]
}

export const SAFETY_SIGNAL_GROUPS: SignalGroup[] = [
  {
    category: 'brakes',
    keywords: ['frenos', 'frenado', 'pastillas', 'discos', 'freno', 'abs', 'hidraulico', 'liquido'],
    phrases: [
      'falla de frenos',
      'frenos no responden',
      'pedal al piso',
      'perdida de frenado',
      'perdida de frenos',
      'pedal se hunde',
      'pedal al fondo',
      'pedal blando',
      'sigue sin frenos',
      'frenos siguen fallando',
    ],
  },
  {
    category: 'steering',
    keywords: ['direccion', 'volante', 'servodireccion', 'cremallera'],
    phrases: ['perdida de direccion', 'volante no responde', 'fallo de direccion'],
  },
  {
    category: 'fuel_leak',
    keywords: ['combustible', 'nafta', 'gasolina', 'diesel', 'gasoil'],
    phrases: ['perdida de combustible', 'olor a nafta', 'olor a gasolina', 'fuga de combustible', 'goteo de combustible'],
  },
  {
    category: 'gnc_leak',
    keywords: ['gnc', 'gas'],
    phrases: ['perdida de gas', 'fuga de gnc', 'olor a gas', 'escape de gas', 'fuga de gas'],
  },
  {
    category: 'airbag',
    keywords: ['airbag', 'bolsa'],
    phrases: ['airbag desplegado', 'bolsa de aire', 'luz de airbag', 'sensor de airbag'],
  },
  {
    category: 'high_voltage',
    keywords: ['electrico', 'bateria', 'cargador', 'inversor', 'electronico'],
    phrases: [
      'sistema electrico',
      'fallo electrico',
      'cortocircuito',
      'bateria de alta tension',
      'sistema de alta tension',
      'falla electrica',
    ],
  },
  {
    category: 'fire_smoke',
    keywords: ['fuego', 'humo', 'incendio', 'llama', 'quema'],
    phrases: ['sale humo', 'olor a quemado', 'humo del motor', 'principio de incendio', 'vehiculo en llamas'],
  },
  {
    category: 'overheat_severe',
    keywords: ['temperatura', 'recalentamiento', 'refrigerante', 'termostato'],
    phrases: [
      'motor recalentado',
      'temperatura maxima',
      'luz de temperatura',
      'perdida de refrigerante',
      'motor en rojo',
      'se fue el agua',
    ],
  },
  {
    category: 'tires_critical',
    keywords: ['neumatico', 'llanta', 'goma', 'rueda', 'reventar'],
    phrases: ['neumatico reventado', 'llanta en llanta', 'perdida de presion', 'explosion de neumatico', 'rueda reventada'],
  },
  {
    category: 'vehicle_instability',
    keywords: ['derrape', 'volcamiento', 'inestable', 'vibracion'],
    phrases: [
      'vehiculo inestable',
      'perdida de control',
      'derrape del vehiculo',
      'riesgo de vuelco',
      'vibracion severa',
    ],
  },
]

// D-1: coverageDisclaimer — always present in safety output. Text approved in DECISIONS.md D-1.
export const COVERAGE_DISCLAIMER =
  'Este análisis automático no reemplaza la inspección de un profesional. Las reglas de seguridad cubren señales conocidas pero no garantizan la detección de todos los riesgos posibles.'

// D-5: Fallback text — fixed
export const FALLBACK_TEXT =
  'No pudimos completar el análisis automático. No contamos con información suficiente para emitir una orientación confiable. Podés volver a intentarlo o consultar con un profesional.'

// D-4: Privacy notice — fixed
export const PRIVACY_NOTICE =
  'Chuya Motor está en desarrollo. Esta versión demostrativa utiliza datos de prueba. No ingreses información personal, patentes, documentación privada ni información sensible. Las orientaciones no sustituyen una inspección profesional.'
