# MVP_01 — Primer incremento implementable

## Resultado observable
Un usuario ingresa un vehículo de ejemplo y una consulta de síntomas o presupuesto en texto. El sistema ejecuta una ruta visible, respeta bloqueos de seguridad y genera un informe que separa hechos, hipótesis, fuentes y preguntas pendientes.

## Alcance de implementación (no realizado aún)
1. Next.js mobile-first y página principal con dos recorridos: «Tengo una falla» y «Quiero entender mi presupuesto».
2. Casos sintéticos marcados como demo: tren delantero con ruido y un presupuesto de repuestos.
3. Grafo LangGraph básico: validator → safety gate → router → diagnóstico orientativo o parser de presupuesto → validador → informe.
4. Proveedor de agentes simulado para tests y un adaptador opcional real configurable por entorno.
5. Reglas críticas determinísticas que no dependen de IA.
6. Contratos de datos validados con Zod, cálculo de importes con precisión adecuada.
7. Visualizador de trazas por nodo en modo desarrollo, con datos sensibles minimizados.
8. Vitest y Playwright E2E con pruebas de flujo feliz, datos incompletos y bloqueo por riesgo.

## Escenarios Gherkin
```gherkin
Scenario: Presupuesto con suma incorrecta
  Given un presupuesto de ejemplo con dos partidas y un total inconsistente
  When el usuario solicita su análisis
  Then se calcula el total desde importes estructurados
  And el informe destaca la diferencia sin afirmar fraude

Scenario: Consulta con riesgo en frenos
  Given un usuario describe pérdida de líquido y mal funcionamiento del freno
  When solicita instrucciones para arreglarlo
  Then el motor bloquea las instrucciones DIY peligrosas
  And presenta derivación profesional clara

Scenario: Falla sin evidencia suficiente
  Given un usuario describe un ruido sin datos de inspección
  When consulta posibles causas
  Then recibe hipótesis orientativas y preguntas de seguimiento
  And no recibe un diagnóstico definitivo
```

## No alcance
Precios reales, marketplace, OCR/PDF, pagos, registro completo de talleres, rutas DIY sobre sistemas críticos, app móvil nativa, producción con IA sin evaluaciones.

## Checklist de entrega
- [ ] Código y tipado
- [ ] Pruebas unitarias y E2E ejecutadas
- [ ] Seguridad revisada
- [ ] Accesibilidad y mobile
- [ ] Documentación y decisiones actualizadas
- [ ] Demo reproducible y video/pitch
