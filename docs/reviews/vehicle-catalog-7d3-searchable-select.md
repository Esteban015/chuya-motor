# 7D.3 — Searchable Select: un único control para buscar y elegir

Rama `feature/vehicle-catalog-7d`. Sin commit, PR ni deploy. Catálogo DNRPA, backend, Safety Gate, SerpApi, variables de entorno y stash 6.5 sin cambios.

## 1. Problema

Marca, Modelo y Versión / motor mostraban dos controles por dato: un `input type="search"` ("Buscar marca…") y, debajo, un `<select>` con las opciones filtradas. Era redundante y confuso, sobre todo en móvil (doble altura, dos focos de teclado por campo).

## 2. Inspección y decisión

- Dependencias de UI instaladas: ninguna (sin Radix, Headless UI, Downshift, React Aria). Solo React 19 + Tailwind.
- Decisión: componente propio `src/components/ui/searchable-select.tsx` (~340 líneas, sin dependencias), siguiendo el patrón WAI-ARIA APG «Editable Combobox With List Autocomplete». Agregar una librería de combobox (≈15–60 KB) no se justificaba para tres campos.

## 3. Componente `SearchableSelect`

Props: `id`, `label`, `options` (`value`, `label`, `keywords?`), `value`, `onChange`, `placeholder`, `disabled`, `loading` / `loadingText`, `emptyMessage`, `clearable`, `pinnedOptions` (siempre ofrecidas, p. ej. «No conozco el motor ni la versión»), `valueLabel` (etiqueta a mostrar si el valor no está entre las opciones: nunca se muestra el ID), `hint`, `maxVisible` (150 por defecto).

- Búsqueda: sin distinguir mayúsculas ni tildes (NFD), parcial, todas las palabras deben aparecer, coincidencias por prefijo primero; los alias de marca/modelo del catálogo cuentan como `keywords`.
- El texto escrito nunca es un valor: al salir (blur, Escape, Tab) vuelve la etiqueta elegida.
- Listas largas: se renderizan como máximo 150 opciones con «Mostrando 150 de N. Escribí para acotar la lista.» (prueba: 1.200 opciones, filtrado < 1 s en jsdom).
- La lista se renderiza en un portal a `<body>` con `position: fixed`, alineada al campo y con su mismo ancho, y se abre hacia arriba si falta espacio abajo (teclado del teléfono). Motivo: las tarjetas de ambos formularios usan `overflow-hidden` y recortaban la lista (detectado en la captura de escritorio, ver §6).
- Con valor elegido, el botón × reemplaza al chevron para dejar más espacio a etiquetas largas; `title` con el texto completo.

### Accesibilidad

- `input role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` → `ul role="listbox"` con `aria-label`; `li role="option"` con `aria-selected`; `aria-activedescendant` mientras se recorre con flechas; `aria-busy` al cargar.
- Teclado: ↓/↑ abren y recorren (al abrir se parte de la opción elegida), Home/End, Enter elige (y no envía el formulario cuando la lista está abierta), Escape cierra, Tab sale sin elegir. El foco por Tab no abre la lista.
- Conteo de resultados en región `aria-live="polite"` (`aria-describedby` del campo).
- Botón «Borrar marca / modelo / versión / motor» de 44×44 px, devuelve el foco al campo.
- Foco visible: anillo del campo y contorno en la opción activa. Filas de 44 px; texto de 16 px en móvil (evita el zoom de iOS).

## 4. Integración en `VehicleSelector`

- Marca, Modelo y Versión / motor → `SearchableSelect` (un control por dato).
- Se mantienen: Tipo como radios; Año como `<select>` nativo (`PlainSelect`, sin buscador); el año libre para modelos sin años; Combustible (fuera del selector); «No encuentro mi vehículo»; mensajes de vacío/error/timeout/offline/rate limit; aviso editorial y de 2002.
- Nueva acción del reducer cliente `{ type: 'clear', field: 'brand' | 'model' | 'version' }`: borra el campo y sus dependientes y lo anuncia («Se borraron la marca, el modelo, el año y la versión.»). Sin efecto en modo manual o si el campo ya estaba vacío.
- El estado de carga se muestra en el propio campo («Cargando marcas…») en vez de una línea extra debajo (menos saltos de layout).
- El contrato con el servidor no cambia: siguen viajando solo IDs, revalidados en el servidor.

## 5. Pruebas (TDD: RED → GREEN)

RED confirmado antes de implementar: suite del componente sin módulo, 3 tests del reducer y 10 del selector fallando.

| Suite | Resultado |
|---|---|
| Vitest completo | 1852/1852 (78 archivos; +29 nuevos) |
| `searchable-select.test.tsx` (SS-01…07) | 20: normalización, filtrado/orden, estructura ARIA, portal, mouse, reapertura, filtrado, vacío, restaurar etiqueta, opciones fijas, teclado (↓↑ Home End Enter Escape Tab), limpiar, disabled, loading, `valueLabel`, 1.200 opciones |
| `vehicle-selector.test.tsx` VS-10 | 6: un control por dato (3 combobox + 1 select, sin buscadores), solo teclado, limpiar marca con reset en cascada, reabrir modelo y cambiar, sin coincidencias, loading |
| `vehicle-selection.test.ts` SEL-04 | 3: acción `clear` |
| Playwright producción (copia aislada, CI) | 117/117 (incluye VSE-12 nuevo: Tab, escribir, flechas, Enter, Escape, Tab, borrar) |
| Playwright desarrollo | 3/3 |
| TypeScript / ESLint / build | OK (solo la advertencia habitual de fuentes en `layout.tsx`) |

E2E del selector con catálogo real: Palio 2017, Rouser con «No conozco el motor», Hilux 2.8 TDI (diésel), 2008 con año 0 km, resets, búsqueda en el mismo campo (`BAJA` → Bajaj), sin coincidencias, alternativa manual, fallo/offline, IDs manipulados, `/demo/presupuesto` (búsqueda 7B y comparación), 320/390 px (sin overflow horizontal, campos y filas ≥ 44 px, botón × 44×44, lista dentro del ancho del campo) y escritorio (lista abierta sin recorte por la tarjeta). Sin llamadas externas; LLM stub; SerpApi no se toca (`src/server`, `src/app` sin cambios).

Nota de entorno: la primera corrida completa dio 8 fallos en `budget-research` y `telemetry-feedback` porque la copia QA se compiló sin `NEXT_PUBLIC_FEEDBACK_FORM_URL` (CI la define al compilar). Recompilado con el mismo valor que CI: 117/117. No era una regresión.

## 6. Capturas

`reviews-local/screenshots/7d3-searchable-select/before/` (7D.2) y `…/after/`:
`falla-moto-320/390`, `falla-marca-abierta-320/390` (lista abierta), `presupuesto-palio-320/390`, `falla-palio-1280`, `presupuesto-hilux-1280`, `presupuesto-version-abierta-1280`.

Revisadas: ya no hay buscador + select duplicados. Defectos vistos en capturas y corregidos: (1) lista recortada por `overflow-hidden` de la tarjeta → portal fijo; (2) etiquetas cortadas a 320 px («Palio (ya no se fabric…») → el × reemplaza al chevron.

## 7. Archivos

- Nuevo: `src/components/ui/searchable-select.tsx`, `src/components/ui/searchable-select.test.tsx`.
- Modificados: `src/components/vehicle/vehicle-selector.tsx` (+ test), `src/domain/vehicle/vehicle-selection.ts` (acción `clear`, + test), `e2e/vehicle-selector.spec.ts`.

## 8. Riesgos residuales

- No hay prueba con lectores de pantalla reales (NVDA/VoiceOver/TalkBack); la estructura ARIA está verificada por tests. Recomendado antes de producción: una pasada manual con VoiceOver iOS y TalkBack.
- No probado en Safari iOS ni en teléfonos reales (solo Chromium emulando 320/390). La lista fija se recoloca con `scroll`/`resize`/`visualViewport`; conviene verificarlo con el teclado virtual abierto.
- A 320 px las versiones largas siguen truncándose dentro del campo cerrado (texto completo en la lista y en `title`).
- Más de 150 coincidencias exigen escribir para acotar (mensaje visible).

## 9. GO / NO-GO

- PR: **GO**.
- Producción: **GO**, con las mismas condiciones de 7D.2 para el catálogo (aceptación de la base legal de la Ley 27.275 y verificación en el preview de Vercel), y recomendando una prueba manual en un iPhone/Android real con lector de pantalla.
