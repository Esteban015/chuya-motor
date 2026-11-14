# 7D.2 — Revisión final para publicar el selector escalonado

Fecha: 2026-11-14 · Rama: `feature/vehicle-catalog-7d` · Sin commit, PR ni deploy · Stash 6.5 y `.env.local` intactos.

**Alcance:** revisión sin ampliar funcionalidades. Solo se corrigieron los defectos encontrados.

## 1. Trazabilidad de fuente y fecha

**El manifest del catálogo distribuible** (`data/vehicle-catalog/dnrpa-2026-11-01/dataset.json`, versión `dnrpa-2026-11-01.2`) identifica:

| Campo | Valor |
|---|---|
| Fuente | `dnrpa` — Tabla de Valuación de Automotores y Motovehículos |
| Edición | Disposición DN 160/2026 · anexo vigente desde 01/11/2026 (`publishedAt: 2026-11-01`) |
| Documento | **nuevo:** `url` = https://www.dnrpa.gov.ar/valuacion/informacion/01-11-2026.pdf |
| Hash del PDF | **nuevo:** `documentSha256` = `6b841352…dc1ba` |
| Base de uso | `license.status = public_information` + `reference` (arts. 1 y 2, ver §2) |
| Atribución | "Fuente: DNRPA — Tabla de Valuación… (vigencia 01/11/2026)." |
| Generación | `generatedAt`, `generator: chuya-catalog-ingest/2` y hash SHA-256 del contenido |
| Derivaciones | **nuevo:** `manifest.derivations` explica cada campo derivado (`discontinued`, motor, años, editorial) |

**Cadena de evidencia:**
1. `extraction-report.json` tiene el hash del PDF.
2. `report.json` tiene el hash del CSV intermedio.
3. Cada versión y cada modelo guarda los códigos registrales de origen (`dnrpa:I:04405662:A`) y el texto crudo.

**Exposición en la API:** `meta.sourceUrl`, `sourceVersion`, `sourcePublishedAt` y `licenseStatus`.

**Defecto corregido (D1):** antes el dataset por sí solo no identificaba el documento exacto (faltaban URL y hash del PDF).

## 2. Fundamento de reutilización (Ley 27.275)

**Ley 27.275 de Acceso a la Información Pública:**
- **Art. 1 — principios:**
  - *presunción de publicidad*: "toda la información en poder del Estado se presume pública";
  - *apertura*: la información debe ser accesible en formatos electrónicos abiertos que faciliten su procesamiento y su reutilización o redistribución por terceros.
- **Art. 2 — alcance del derecho de acceso:** comprende buscar, acceder, solicitar y recibir la información, y también "copiar, analizar, reprocesar, reutilizar y redistribuir" la información bajo custodia de los sujetos obligados del art. 7, con las limitaciones y excepciones de la ley (art. 8). Ninguna excepción del art. 8 alcanza a una tabla de marcas y modelos, que no contiene datos personales.

**La DNRPA:**
- es un organismo del Poder Ejecutivo Nacional (sujeto obligado);
- publica la tabla en dnrpa.gov.ar como anexo de un acto administrativo.

**Límites del fundamento** (también en el dataset):
- **No existe una licencia específica del PDF.**
  - dnrpa.gov.ar no publica términos.
  - El aviso CC BY 4.0 del sitio está comentado en el HTML y se refiere a Argentina.gob.ar.
  - La licencia de argentina.gob.ar se limita a sus propios servicios.
- **No es una autorización individual de la DNRPA.**
- **Solo se usan datos de identificación,** nunca las valuaciones, y siempre con atribución visible.

**Dónde queda registrado:** `data/vehicle-catalog/dnrpa/source.json` → `license.reference`, copiado al manifest. Un test (`DN-06`) verifica que la referencia cite los arts. 1 y 2 y la ausencia de licencia o autorización.

## 3. Solo datos de identificación, sin valuaciones

**Contenido del dataset:**
- marca, modelo, texto de versión y carrocería registral;
- años con dato y códigos registrales como procedencia;
- marcas editoriales y campos faltantes.

**Verificaciones:**
- Se tomaron las 19 037 celdas de valuación de la tabla (columnas 0Km…2002) y se cruzaron con todos los números de etiquetas, nombres de modelos, `dataset.json`, `report.json`, `report.md` y `extraction-report.json`: **0 coincidencias**.
- Test permanente (`DN-01`): valuaciones conocidas del PDF ausentes del archivo y ningún número de 7–9 dígitos fuera de la procedencia.

## 4. Auditoría de inferencias de motor, combustible, año y versión

| Campo | Hallazgo | Estado |
|---|---|---|
| Cilindrada | **D2:** nombres de modelo leídos como cilindrada: Saab "9.3" / "9.5" → 9,3 L / 9,5 L | **Corregido.** Se excluyen los decimales que forman parte de la familia del modelo; "9.3 VECTOR 2.0 T" → 2,0 L |
| Cilindrada | **D3:** motos con nombres de versión leídos como litros ("MOTARD 2.0", "TR2.0", "FZ-S V3.0"; 11 versiones) | **Corregido.** Nunca se infiere cilindrada decimal en motovehículos ni pegada a letras |
| Cilindrada | **D4:** etiquetas con varias cilindradas ("HILUX 2.4/2.8/D/4WD") → se tomaba la primera | **Corregido.** Si hay varias distintas, queda desconocida |
| Cilindrada | Rango plausible | **Nuevo.** Solo entre 0,6 y 8,0 L |
| Combustible | "D/C" (doble cabina) podía leerse como diésel tras una cilindrada | **Prevenido** (0 casos en el dataset actual); test |
| Combustible | Diésel o GNC solo con marcador explícito; nafta nunca inferida | Verificado en las 16 534 versiones (test `DN-06`) |
| Año | Solo años con valor alineado en la tabla (98,1 %); el resto queda vacío; 0 km no se convierte en año; nada anterior a 2002 | Verificado (tests `DN-06`, `IN-02`) |
| Versión | Texto verbatim de la fuente; sin completar | Sin cambios |

**Impacto:**
- 61 versiones cambiaron su motor al regenerar (de `.1` a `.2`, quitando o corrigiendo cilindradas).
- **Ningún ID cambió:** diff +0 / −0, de modo que las selecciones guardadas siguen siendo válidas.

## 5. Valores editoriales distinguibles de los de la DNRPA

**Defecto D5:** las decisiones editoriales (overrides) no quedaban marcadas en el dataset ni en la API.

**Corrección:**
- `models[].editorial` lista qué parte de la identificación es editorial:
  - `category`: el override decidió algo que la carrocería registral no decía;
  - `family`: familia de varias palabras curada;
  - `brand`: continuación o alias de marca;
  - `name`: nombre comercial revisado.
- Se marcaron 370 modelos (categoría 118, familia 31, marca 240: Mercedes Benz).
- `discontinued` se documenta como **derivado** en `manifest.derivations`.
- La API expone `editorial` en cada modelo.
- La UI avisa: "La clasificación de tipo de este modelo (o de algunas de sus versiones) es una revisión de Chuya Motor, no un dato de la fuente."
- Tests: `IN-06`, `DN-06`, `VS-09`.

**Defecto D6 (texto):** la primera redacción del aviso ("la fuente lo registra con otra carrocería") era inexacta para modelos como Palio o Hilux, donde solo algunas versiones tenían carrocería ambigua. Corregida tras revisar las capturas.

## 6. Carga, rendimiento y tamaño (build compatible con Vercel)

**Build de producción** (`next build`, CI) en una copia aislada sin `.env.local`.

**Trazas `.nft.json`:**
- El dataset está incluido en `/api/vehicle-catalog`, `/api/analyze`, `/demo/falla` y `/demo/presupuesto`, mediante `outputFileTracingIncludes`.
- No está en `/api/budget/parts-prices`.
- **Lo que no se verificó:** un deploy real en Vercel (no se hizo deploy). Las trazas son el mecanismo que usa Vercel para empaquetar archivos.

| Medición (i5-1135G7, 31 GiB, Windows 11, Node 25.9, `next start`) | Resultado |
|---|---|
| `dataset.json` | 6,8 MB (590 KB comprimido); la función queda muy por debajo del límite de 250 MB de Vercel |
| Bundle cliente `.next/static` | 1,2 MB; **sin** datos del catálogo, códigos ni secretos |
| TTFB `/demo/falla` sin el catálogo cargado | **37 ms** |
| Primera consulta al catálogo (lectura + validación + índices) | **441 ms**, una vez por instancia |
| Consultas siguientes (types → versions de Palio 2017) | 4–6 ms; respuestas de 0,5 a 7,2 KB |
| HTTP, 20 usuarios concurrentes, límite real 120/min | p95 **41 ms**, p99 60 ms, 731 req/s (los 429 confirman el límite) |
| HTTP sin límite (medición previa de 7D.2) | p95 21 ms (10 usuarios), 32 ms (20) y 67 ms (50) |

**Defecto D7 (rendimiento):** las páginas `/demo/*` cargaban y validaban el dataset de 6,8 MB solo para decidir si mostrar el selector, así que la primera visita de cada instancia pagaba unos 0,45 s de TTFB. **Corregido:** la página solo comprueba la configuración y que el archivo exista; la API es la que carga el dataset.

## 7. Selectores con datos reales en las demos

E2E `vehicle-selector.spec.ts` (13 tests), servidor de producción con el catálogo activo:
- `/demo/falla`: Auto → Fiat → Palio → 2017 → "FIRE 1.4 8V · Sedan 5 puertas" (los IDs llegan a `/api/analyze`).
- Moto → Bajaj → Rouser, con motor no informado: "No conozco el motor" no bloquea.
- Pick-up → Toyota → Hilux, con diésel leído del texto.
- SUV → Peugeot → 2008, con "2026 (0 km)".
- Resets en cascada, búsqueda en listas, IDs manipulados, fallo de la API y modo sin conexión.
- `/demo/presupuesto`: búsqueda 7B "Fiat Palio 1.4 2017" y análisis de presupuesto con los IDs.

## 8. Fallback manual para modelos ausentes o anteriores a 2002

"No encuentro mi vehículo" está siempre visible y ahora explica: "El catálogo incluye vehículos desde 2002. Si el tuyo es anterior o no aparece, escribí los datos a mano." El texto solo aparece con la fuente DNRPA (test `VS-09`).

Lo que sale por modo manual:
- no envía IDs y queda `user_declared`;
- motor y combustible se toman como declarados (E2E `VSE-06`).

## 9. Safety Gate, SerpApi y cuotas

`git diff origin/master` sobre `src/domain/safety`, `src/server/parts-pricing`, `src/server/llm-protection`, `safety-gate.ts`, `output-safety-guard.ts` y `src/domain/budget`: **sin cambios**.

Los E2E corren con `LLM_PROVIDER=stub` y `PARTS_PRICING_PROVIDER=none`; no hubo llamadas reales. El límite del catálogo es independiente de las cuotas del LLM y de los precios.

## 10. Regresión y capturas

| Verificación | Resultado |
|---|---|
| Vitest | **1823/1823** (77 archivos) |
| Playwright producción (copia aislada) | **116/116** |
| Playwright desarrollo | **3/3** |
| TypeScript | OK |
| ESLint | OK (solo el warning habitual de fuentes en `layout.tsx`) |
| Build | OK |

**Capturas** revisadas en `reviews-local/screenshots/7d2-vehicle-selector/`: falla Palio 1280; falla Moto 390 y 320; presupuesto Palio 390 y 320; presupuesto Hilux 1280.
- Sin desborde horizontal.
- Controles ≥ 44 px.
- Atribución y aviso editorial visibles.
- De ahí salió D6.

## 11. Cambios exactos de esta revisión

| Archivo | Cambio |
|---|---|
| `src/server/vehicle-catalog/ingest/normalize.ts` | Cilindrada inequívoca: un solo valor, no en la familia, no pegado a letras, no en motos, 0,6–8,0 L. "D/C" no es diésel. `parseEngineFromLabel(text, { family, vehicleClass })` |
| `src/server/vehicle-catalog/ingest/ingest.ts` | Marcas editoriales por fila y por modelo (`brand`, `category`, `family`, `name`); `manifest.derivations`; generador `/2`; contexto de motor |
| `src/server/vehicle-catalog/catalog-dataset.ts` | Esquema: `source.url`, `source.documentSha256`, `manifest.derivations`, `models[].editorial`; `reference` hasta 600 caracteres |
| `src/domain/vehicle/vehicle-catalog.ts` | `CatalogSource.url` y `documentSha256`, `CatalogMeta.sourceUrl`, `CatalogModel.editorial`; `discontinued` documentado como derivado |
| `src/server/vehicle-catalog/static-catalog-provider.ts` | Expone `editorial` y `sourceUrl` |
| `src/server/vehicle-catalog/datasets.ts` | `dnrpaDatasetPresent()`, chequeo liviano para las páginas |
| `src/server/vehicle-catalog/catalog-config.ts` | `isVehicleCatalogEnabled` ya no carga el dataset |
| `src/components/vehicle/vehicle-selector.tsx` | Aviso de clasificación editorial; texto del fallback "desde 2002" |
| `data/vehicle-catalog/dnrpa/source.json` | URL y hash del PDF; base legal con arts. 1 y 2; versión `.2` |
| `data/vehicle-catalog/dnrpa-2026-11-01/*` | Regenerado (`dnrpa-2026-11-01.2`; IDs sin cambios; 61 motores corregidos) |
| Tests | `IN-05` (8 + 1), `IN-06`, `DN-06` (4), `VS-09` (2) |
| Docs | Este informe; `vehicle-catalog-7d2-dnrpa.md` §1 con arts. 1 y 2 |

## 12. Riesgos residuales

1. **Legal.** El fundamento es la Ley 27.275 (arts. 1 y 2) sin licencia específica ni autorización individual. Es razonable, pero no es una certeza jurídica. Mitigación: sin valuaciones, con atribución, con `public_information` distinguible y con un interruptor que apaga el catálogo sin deploy (`VEHICLE_CATALOG_ENABLED=false`).
2. **Clasificación editorial:** 370 modelos dependen de decisiones curadas. Están marcadas, pero un error de curaduría afecta la categoría mostrada. La categoría no se usa para compatibilidad de repuestos.
3. **Cobertura:**
   - 770 filas en cuarentena y 130 rechazadas;
   - 855 modelos con nombre registral;
   - sin vehículos anteriores a 2002;
   - motor en el 35 % de las versiones y combustible en el 14 %.
4. **Deploy:** no se verificó en Vercel. Primera consulta de cada instancia de unos 0,45 s.
5. **Mantenimiento:** hay que regenerar el catálogo con cada nueva disposición (proceso documentado y reproducible).
6. **Límite por cliente:** es por instancia sin store compartido.

## 13. GO / NO-GO

- **PR: GO.** Los defectos D1–D7 están corregidos y la regresión completa está en verde.
- **Producción: GO condicionado** a dos cosas:
  1. tu aceptación explícita del fundamento legal de §2;
  2. la verificación en un **preview de Vercel** de que `/api/vehicle-catalog?level=types` responde 200 con `meta.source = "dnrpa"`. Si responde 404, el archivo no se empaquetó y el selector queda en modo manual: seguro, pero sin catálogo.

  Sin la aceptación legal, desplegar con `VEHICLE_CATALOG_ENABLED=false`.
