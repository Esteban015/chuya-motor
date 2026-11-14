# Incremento 7D.2 — Selector vehicular con catálogo argentino real (DNRPA)

Fecha: 2026-11-14 · Rama: `feature/vehicle-catalog-7d` (sin commit, PR ni deploy) · Stash 6.5 intacto · `.env.local` sin cambios.

## 1. Fuente elegida y condiciones de uso

**Fuente:** DNRPA — *Tabla de Valuación de Automotores y Motovehículos*, anexo de la Disposición DN 160/2026, vigencia 01/11/2026.
- URL oficial: https://www.dnrpa.gov.ar/valuacion/informacion/01-11-2026.pdf
- SHA-256: `6b841352d4f7f35feb43bf185e9612827d5fe140b27c551bcb5776d8b20dc1ba`
- 217 páginas.

### Búsqueda de una autorización general (verificada)

| Pregunta | Resultado |
|---|---|
| ¿El PDF o dnrpa.gov.ar publican una licencia o términos de uso? | **No.** La página de valuación no tiene términos. El único aviso de licencia (CC BY 4.0) está **dentro de un comentario HTML**, no se muestra y se refiere a Argentina.gob.ar |
| ¿Alcanza la licencia CC BY 4.0 de argentina.gob.ar? | **No, de forma directa.** Sus términos la limitan a los "Servicios Digitales" que enumeran (portal argentina.gob.ar, Turnos, ciertas apps); no mencionan dnrpa.gov.ar |
| ¿Está el dataset en datos.gob.ar (con licencia abierta)? | **No.** Solo hay estadísticas de trámites |
| ¿Hay términos que **prohíban** la reutilización? | **No se encontraron** |
| ¿Hay un marco general? | **Sí.** La **Ley 27.275, art. 1, principio de apertura**: la información pública debe ser accesible en formatos que permitan su reutilización o redistribución por terceros. Además, el Decreto 117/2016 (apertura de datos) promueve licencias que habiliten la reutilización |

### Decisión

- **Base de uso:** se usa la tabla como **información pública oficial**, bajo la Ley 27.275, con atribución visible:
  - **art. 1:** presunción de publicidad ("toda la información en poder del Estado se presume pública") y apertura (formatos que faciliten su procesamiento y reutilización);
  - **art. 2:** el derecho de acceso comprende "copiar, analizar, reprocesar, reutilizar y redistribuir" la información en poder de los sujetos obligados.
  - **No existe una licencia específica del PDF.** Esto **no** es una autorización individual de la DNRPA. Ver `docs/reviews/vehicle-catalog-7d2-publication-review.md` §2.
  - En el dataset queda como `license.status = "public_information"`, con la referencia legal y la atribución.
  - Es un estado **distinto** de `authorized`, para no presentarlo como un permiso individual.
- **Datos que se usan:** solo datos de identificación (marca, modelo, texto de versión, carrocería registral, años con valuación y códigos registrales como trazabilidad). **Ninguna valuación se copia.** Lo verifica un test sobre el archivo distribuido.
- **Es una interpretación, no un permiso individual.** Ver §9: la habilitación pública queda sujeta a que lo aceptes explícitamente (o a un dictamen legal).

**Alternativas evaluadas:** ArgAutos (sin términos publicados, autor individual, datos de terceros; requiere permiso escrito) y Mercado Libre (sus términos apuntan a operar en ML). Ninguna es mejor que la DNRPA en términos de uso.

## 2. Ingesta reproducible (PDF → JSON versionado)

```
npm run catalog:dnrpa-extract -- --pdf <tabla.pdf> --out <dir>      # xpdf pdftotext 4.x (-raw + -table)
npm run catalog:ingest -- --input <dir>/registry.csv --config data/vehicle-catalog/dnrpa/source.json \
                          --out data/vehicle-catalog/dnrpa-2026-11-01
```

### Extracción (`src/server/vehicle-catalog/sources/dnrpa-extract.ts`)

- **`-raw`:** descripciones limpias. Las filas largas cortadas en dos líneas se vuelven a unir (3 845 líneas de continuación). También se eliminan los pies "PÁGINA x DE 217".
- **`-table`:** posición de cada valor bajo su columna (0Km, 2025…2002).
- **Años:** solo se emiten si la cantidad de valores coincide entre ambas extracciones y cada valor cae en una columna distinta y en orden. Si no, el año queda **vacío**, se reporta y no se adivina.
- **Separación de campos:**
  - la **marca** sale de un diccionario tomado de la columna de marcas, descartando las celdas que el PDF pegó con el modelo;
  - la **carrocería** sale de una lista curada de 50 carrocerías registrales, buscada como sufijo (también cuando el PDF la pega a la palabra anterior: 343 casos);
  - el **modelo** es lo que queda.
- **Valuaciones:** se leen solo para saber qué años tienen dato y **nunca se copian**.

| Calidad de extracción | Valor |
|---|---|
| Filas | 18 180 (14 575 automotores y 3 605 motovehículos) |
| Años alineados con certeza | **17 837 (98,1 %)** |
| Sin alinear: años vacíos, sin adivinar | 343 (sobre todo cuadriciclos y camiones con celdas superpuestas) |
| Marca no resuelta: filas rechazadas | 27 (Harley-Davidson: el PDF pega marca y modelo) |
| Carrocería no reconocida | 72 (cuadriciclos pesados y textos fuera de la lista) |

### Normalización y validación (`ingest/`)

- **Marcas:** "MERCEDES" + "BENZ …" se corrige como continuación de marca, con override revisado.
- **Familias de varias palabras curadas:** GOL TREND, HILUX SW4, PALIO WEEKEND, ONIX PLUS, etc.
- **Categoría:** la carrocería registral define la categoría. "RURAL", "SIN ESPECIFICACION" y "TRANS. DE PASAJEROS" son ambiguas y van a **cuarentena**, salvo un **override curado** a nivel modelo (`data/vehicle-catalog/dnrpa/source.json`).
  - Ese override es una clasificación editorial documentada, no un dato de la fuente. Ejemplos: Peugeot 2008, Ecosport y Renegade → SUV; Palio Weekend → auto; Kangoo y Ducato → utilitario.
- **Motor y combustible:** solo si figuran en el texto de la versión (evidencia `label`).
  - Diésel se detecta por TD, TDI, HDI, DCI, JTD, D4D, CDI…; GNC por "GNC".
  - "Nafta" **nunca** se infiere: en 2 129 versiones se lee diésel y en 31 GNC; el resto queda con combustible desconocido.
- **Duplicados:** el mismo vehículo con código importado y nacional se fusiona (690 casos), conservando todos los códigos como procedencia.
- **IDs:** estables y deterministas (`b:fiat`, `m:fiat-palio`, `v:fiat-palio-<hash>`).
- **Archivo final:** dataset con hash SHA-256; integridad verificada al generarlo y al cargarlo.

**Archivos versionados** en `data/vehicle-catalog/dnrpa-2026-11-01/`:

| Archivo | Contenido |
|---|---|
| `dataset.json` | 7,0 MB compacto |
| `report.md` / `report.json` | Cobertura, cuarentena, alias y duplicados |
| `extraction-report.json` | Calidad de extracción y hash del PDF |

No contienen rutas locales ni valuaciones; ambas cosas están verificadas.

## 3. Cobertura del catálogo

| Categoría | Marcas | Modelos | Versiones |
|---|---|---|---|
| Auto | 66 | 752 | 6 425 |
| Moto | 92 | 1 397 | 2 469 |
| Pick-up | 47 | 170 | 1 499 |
| SUV | 56 | 249 | 2 035 |
| Utilitario | 41 | 109 | 1 335 |
| Camión | 39 | 719 | 2 025 |
| Otro (cuatriciclos, etc.) | 34 | 506 | 746 |
| **Total** | **202** | **3 902** | **16 534** |

**Resultado de la ingesta:**
- Filas: 18 180 → **aceptadas 17 280** · cuarentena 770 · rechazadas 130.
- Con años: 97 % · con cilindrada: 36 % · con combustible: 14 %.
- Modelos discontinuados (sin 0 km y último año menor a 2025): 2 812.

**Casos pedidos (verificados en tests):**
- **Auto → Fiat → Palio → 2017:** 12 versiones, discontinuado; "FIRE 1.4 8V" con cilindrada y sin combustible.
- **Moto → Bajaj → Rouser:** 16 versiones; motor **no informado** en todas.
- **Pick-up → Toyota → Hilux:** 51 versiones; diésel 2.8 leído de "TDI".
- **SUV → Peugeot → 2008:** con override; 2026 ofrecido como "0 km", tratado como dato sin verificar.

**Huecos conocidos:**
- vehículos anteriores a 2002 (la tabla empieza en 2002);
- 770 filas en cuarentena, sobre todo "RURAL" de modelos no curados;
- 855 modelos con nombre registral (Motomel B110, Gilera VC150…) **sin** nombre comercial, porque no se inventa;
- motor y combustible faltantes en la mayoría de las motos y de muchos autos.

## 4. API y servidor

**Fuente por defecto:** el catálogo real (`VEHICLE_CATALOG_SOURCE` = `dnrpa`).
- **Interruptor de apagado:** `VEHICLE_CATALOG_ENABLED=false`, que vuelve a los campos libres.
- **Catálogo sintético:** solo con `VEHICLE_CATALOG_SOURCE=fixture`, y nunca en producción.
- **Si el dataset falta o falla su integridad,** el catálogo se apaga y queda el modo manual.

**Carga:**
- El JSON se lee una vez por instancia: una sola validación de esquema, integridad e índices, **≈430–490 ms en frío**.
- `next.config.ts` lo incluye en las funciones que lo leen (`outputFileTracingIncludes`).

**Consultas:**
- `GET /api/vehicle-catalog`: un nivel por consulta, resuelto con índices en memoria, sin ninguna llamada externa.
- **Límite por cliente:** 120 por minuto, con respuesta 429 + `Retry-After`.
- **Procedencia:** se quita de cada respuesta.
- **Tamaño:** la respuesta más grande medida no supera los 200 KB; el dataset completo nunca se envía.

**`/api/analyze`:**
- Revalida toda la cadena de IDs y calcula el nivel de identificación.
- Un año 0 km posterior a los listados (modelo vigente) queda `year_unverified`, no como contradicción.

## 5. UX pública (`/demo/falla` y `/demo/presupuesto`)

- **Selector:** tipo → marca → modelo → año → versión, con búsqueda en listas largas (marcas, modelos, versiones).
- **Versiones legibles:** "FIRE 1.4 8V · Sedan 5 puertas", sin repetir el modelo, y "motor no informado" cuando la fuente no lo dice.
- **Opciones de desconocimiento:** "No sé el año", "No conozco el motor ni la versión" y "No encuentro mi vehículo" (manual, rotulado como no verificado).
- **El motor desconocido no bloquea la consulta.**
- **Combustible:** se pregunta solo si la versión no lo informa.
- **Atribución visible:** "Fuente: DNRPA — Tabla de Valuación… (vigencia 01/11/2026). Sirve para identificar el vehículo; no certifica la compatibilidad de repuestos."
- **Estados:** carga, vacío, error, timeout, sin conexión y 429, todos con salida manual.
- **Cliente:** caché de sesión, sin solicitudes redundantes.
- **Móvil 320/390:** sin desborde, controles de 44 px, teclado en el grupo de tipos.

## 6. Integración con agentes y repuestos

| Destino | Qué llega |
|---|---|
| `/api/analyze` → DiagnosisAgent | Marca y modelo del catálogo, año, versión, motor (etiqueta de la versión), combustible solo si consta, nivel de identificación. El prompt v2.3.0 aclara que identificar no certifica compatibilidad |
| BudgetParser | No usa el vehículo (analiza el texto del presupuesto); el vehículo viaja en el estado del grafo |
| PartSearchBuilder (7B) | `Fiat Palio 1.4 2017`. El motor se reduce a cilindrada y combustible documentados ("1.4", "2.8 diesel"); nunca la etiqueta entera ni "nafta" por omisión (test y E2E) |
| Matching 7C | Recibe "2.8 diesel" o "1.4", y aplica las reglas de motor y diésel de 7C. **El proveedor SerpApi no se modificó ni se habilitó** |

**Safety Gate:** sin cambios.

## 7. Rendimiento (resultados reales)

**Hardware:** Intel Core i5-1135G7 @ 2.40 GHz × 8 · 31,4 GiB RAM · Windows 11 (10.0.26100) x64 · Node v25.9.0.

**Entorno:** `next start` (producción) en local, `LLM_PROVIDER=stub`. El benchmark es `npm run bench:catalog`: recorridos aleatorios con semilla fija, cada usuario virtual con su propia IP.

| Escenario | Muestra | p50 | p95 | p99 | Máx. | Throughput |
|---|---|---|---|---|---|---|
| En proceso (proveedor indexado) | 10 000 consultas | 0,00 ms | 0,01 ms | 0,01 ms | 0,08 ms | — |
| HTTP, 10 usuarios concurrentes | 3 040 | 12,4 ms | **20,6 ms** | 29,8 ms | 40,8 ms | 724 req/s |
| HTTP, 20 usuarios | 3 090 | 23,7 ms | **31,8 ms** | 52,1 ms | 105 ms | 790 req/s |
| HTTP, 50 usuarios | 3 245 | 58,8 ms | **66,9 ms** | 83,6 ms | 125 ms | 831 req/s |
| HTTP, 20 usuarios con el límite real (120/min) | 3 019 | 25,1 ms | 42,5 ms | 58,6 ms | 94,8 ms | 729 req/s (619 respuestas 429: el límite actúa) |
| Carga en frío del dataset (una vez por instancia) | — | — | — | — | 428–485 ms | — |

**Notas:**
- Las filas sin límite usan `VEHICLE_CATALOG_RATE_PER_MINUTE=10000` solo en el servidor del benchmark.
- **Objetivo p95 < 200 ms: cumplido** en todos los escenarios con carga controlada.
- El test `DN-05` (Vitest) lo verifica en cada corrida: 600 consultas, p95 < 200 ms, respuesta < 200 KB.

## 8. Tests

**RED → GREEN:** `dnrpa-catalog.test.ts` falló primero porque el cargador del dataset no existía, y pasó después.

| Suite | Cobertura |
|---|---|
| `dnrpa-catalog.test.ts` (12) | Procedencia y atribución; sin valuaciones; categorías; Palio 2017, Rouser, Hilux, 2008; `identity_full` con IDs reales; IDs manipulados; 0 km vigente vs. discontinuado; selección → PartSearchBuilder; diésel hacia el matching; rendimiento de la ruta |
| `vehicle-selector.test.tsx` VS-08 (3) | Etiqueta de versión, año 0 km, atribución sin "compatible" |
| `vehicle-catalog.test.ts` VC-05 (actualizado) | Real por defecto, interruptor de apagado, fuentes desconocidas apagadas, fixture fuera de producción |
| `e2e/vehicle-selector.spec.ts` (13, catálogo real) | Palio 2017 → `/api/analyze`; Rouser con motor desconocido; Hilux diésel; 2008 0 km; resets; búsqueda; modo manual; fallo y sin conexión; IDs manipulados; presupuesto → búsqueda 7B; 390 y 320 con teclado; capturas |

| Regresión | Resultado |
|---|---|
| Vitest | **1807/1807** (77 archivos) |
| Playwright producción (copia aislada) | **116/116** (103 previos sin cambios + 13) |
| Playwright desarrollo | **3/3** |
| TypeScript | OK |
| ESLint | OK (solo el warning habitual de `layout.tsx`) |
| Build | OK |
| Bundle cliente | No contiene datos del catálogo, códigos ni secretos (1,2 MB en `.next/static`) |

Sin llamadas reales a LLM ni SerpApi.

**Capturas** en `reviews-local/screenshots/7d2-vehicle-selector/`:
- `falla-palio-1280.png`;
- `falla-moto-390.png` y `falla-moto-320.png`;
- `presupuesto-palio-390.png` y `presupuesto-palio-320.png`;
- `presupuesto-hilux-1280.png`.

## 9. Riesgos residuales

1. **Legal: la base de uso es una interpretación.**
   - Se apoya en la Ley 27.275 y en la ausencia de términos restrictivos; no existe una licencia expresa del PDF.
   - Mitigación: solo datos de identificación, sin valuaciones; atribución visible; estado `public_information` distinguible; un interruptor que apaga todo sin desplegar código.
   - Si se quiere certeza, conviene un pedido de acceso a la información pública o una nota a la DNRPA.
2. **La clasificación SUV/auto depende de overrides curados** (135 modelos). Los modelos no curados con carrocería "RURAL" quedan en cuarentena (770 filas) y no aparecen.
3. **Nombres registrales sin nombre comercial** (855 modelos, sobre todo motos): la persona puede no reconocer "Motomel B110".
4. **Motor y combustible incompletos:** 36 % de las versiones con cilindrada y 14 % con combustible. Lo habitual en motos va a ser "motor no informado".
5. **Sin vehículos anteriores a 2002.** Pasan por modo manual.
6. **El catálogo envejece:** hay que regenerarlo con cada nueva disposición, con el proceso de la §2 y una revisión del diff.
7. **Carga en frío de ~0,5 s** en la primera consulta de cada instancia serverless.
8. **El límite por cliente es por instancia** si no hay store compartido.
9. **El prompt v2.3.0 no está evaluado con el modelo real.**
10. **Extracción:** depende de xpdf `pdftotext` 4.x; Poppler no tiene `-table`.

## 10. GO / NO-GO para habilitarlo públicamente

**GO técnico:** se cumplen los criterios de producto, rendimiento, seguridad y QA. Con este cambio, el selector queda **activo por defecto**: al desplegar la rama, la demo pública usa el catálogo real.

**Condición para publicar:**
- **Aceptación explícita de la base de uso legal** (§1: Ley 27.275, información pública oficial, sin valuaciones, con atribución).
- **Si preferís esperar** una confirmación escrita de la DNRPA, se despliega igual con `VEHICLE_CATALOG_ENABLED=false` y se activa después, sin cambiar código.

**NO-GO:** usar el catálogo sintético para usuarios reales (está bloqueado en producción) o publicar las valuaciones (no están en el dataset).
