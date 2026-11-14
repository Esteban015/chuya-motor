# Auditoría final — Incremento 7B (Presupuestos 2.0)

Rama `feature/budget-research-v2`. Sin llamadas reales a proveedores LLM.

## 1. Contratos de seguridad por modo

| | Modo A — Consultar repuestos | Modo B — Comparar presupuesto |
|---|---|---|
| Operación de servidor | **Ninguna.** Todo corre en el navegador. | `POST /api/analyze` (sin cambios). |
| LLM | Nunca. | La misma única llamada de antes (parseo del presupuesto). |
| Salidas | Textos fijos y un enlace de búsqueda de Google por repuesto. | Informe del servidor + separación local de partidas, búsqueda, referencias y comparación. |
| Autoridad de seguridad | `local-safety.ts` (mismo Safety Gate, política acotada). | Safety Gate del servidor (autoritativo). La separación local no decide nada en el servidor. |
| Rate limit / cuota | No aplica (no hay request). | Sin cambios. |

**Política del Modo A** (las reglas del Safety Gate no se modificaron):

1. Texto completo por `checkSafetyGate`: se bloquea si el motivo es intención (reparación por cuenta
   propia, descripción de síntoma…), un peligro explícito o pérdida de frenado.
2. Cada línea por `screenPartDescription`: se bloquea si alguna es **insegura** (verbos de acción como
   anular, desconectar, puentear o reparar, preguntas o síntomas sobre un sistema de seguridad). Las
   líneas que no son repuestos pero no son peligrosas (“¿Dónde queda el taller?”) se rechazan como
   error del formulario, sin construir búsqueda.
3. El nombre de una pieza de un sistema de seguridad (“Pastillas de freno Fiat Palio 2017”, “Precio de
   bomba de nafta”) se permite: es una consulta comercial y no genera texto. Se muestra “conviene que
   la instalación la haga un taller”.
4. `screenPartDescription` también se aplica **al renderizar** cada tarjeta: descripciones agregadas,
   editadas o inyectadas en el estado nunca producen un enlace de búsqueda si no pasan el filtro
   (vale también para las partidas del Modo B).

Ninguna decisión del servidor depende de validaciones del navegador: el Modo A no tiene operaciones
de servidor y el Modo B sigue validado por el servidor.

## 2. Hallazgos confirmados y correcciones

| # | Hallazgo | Severidad | Corrección |
|---|---|---|---|
| H1 | El Modo A generaba búsquedas para “Cómo anular el sensor de frenos”, “Anular sensor ABS”, “Pastillas de freno + Cómo desconectar el ABS…”, “Bomba de nafta + puentear…”, “Manguera de nafta pierde” (el gate los marca *ambiguous* y la excepción por nombre de pieza era demasiado amplia). | Alta | Filtro por línea (`screenPartDescription`) en `localSafetyCheck`. |
| H2 | Las descripciones agregadas/editadas después del chequeo (o inyectadas en el estado) generaban búsquedas sin volver a validarse, también en el Modo B. | Alta | Validación al renderizar `PartCard` y en “Agregar repuesto”. |
| H3 | Estado alterado (precio NaN o decimal, cantidad no entera) hacía lanzar `BigInt` y rompía la tarjeta; `formatArs` podía mostrar “NaN”. | Media | El comparador valida enteros seguros y cantidades 1–999 (nuevo motivo `invalid_quantity`); `formatArs` muestra “—”. |
| H4 | Caracteres de control, de ancho cero y de dirección (RTL) pasaban a las descripciones. | Baja | `stripInvisible` en el parser y en el filtro. |
| H5 | Falso positivo evitado: “Cambio de pastillas” / “Reemplazo de bomba” son líneas válidas de un presupuesto; solo las formas verbales cuentan como acción. | — | Lista de verbos acotada + test. |

## 3. Comparabilidad verificada

Se compara solo con confirmación de equivalencia y misma presentación: unidad–unidad, par–par,
juego–juego, kit–kit. Nunca unidad–par, unidad–juego, par–juego, juego–kit ni litro–unidad.
Dos unidades presupuestadas contra precio unitario: la referencia se multiplica por 2. Marca o código
desconocidos no impiden la aritmética si la persona confirmó la equivalencia (la tarjeta muestra
“Marca de la pieza sin indicar”). “No es equivalente” y “No lo sé todavía” no se comparan. Toda
referencia se rotula “Informada por el usuario, sin verificación independiente” y la diferencia
siempre aclara que no indica que el taller cobre de más ni define un precio justo.

## 4. Limitaciones residuales

- Los filtros son listas de frases en español: una paráfrasis no prevista de una instrucción
  peligrosa podría pasar como nombre de pieza. El impacto se limita a un enlace de búsqueda de Google
  (Chuya Motor no genera instrucciones).
- La lista de verbos puede rechazar como “no es un repuesto” algún nombre comercial poco común; el
  mensaje indica cómo reescribirlo.
