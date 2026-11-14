# Incremento 7D.1 — Infraestructura de catálogo vehicular y recuperación del trabajo 6.5

Fecha: 2026-11-14 · Rama: `feature/vehicle-catalog-7d`, creada desde `origin/master` (`b0ecab8`, ya incluye 7C) · Sin commit, PR ni deploy.

## 0. Preparación de Git

- `git fetch`: `origin/master` avanzó a `b0ecab8` (merge del PR #16, 7C).
- Rama nueva `feature/vehicle-catalog-7d` creada desde `origin/master`, **sin upstream**: un `git push` no puede ir a master por accidente.
- **Stash 6.5 intacto.** Sigue como `stash@{0}` y nunca se aplicó, ni con `pop`, ni con `apply`, ni con `drop`. Sus archivos se leyeron con `git show stash@{0}:<ruta>` hacia el scratchpad. La base del stash es `c865c2f`, de la era Groq RC, muy anterior a master.

## 1. Stash 6.5: qué se reutilizó y qué se descartó

| Archivo del stash | Decisión | Motivo |
|---|---|---|
| `vehicle-catalog.ts`: `catalogKey`, `displayName` | **Reutilizado** (copiado a `src/domain/vehicle/vehicle-catalog.ts`) | Normalización independiente de la fuente, con tests |
| `vehicle-catalog.ts`: tipos `CatalogRef` y `VehicleCatalogProvider` (marcas, modelos y versiones) | **Rediseñado** | Faltaba el nivel tipo y el paso año; los IDs eran del proveedor (ArgAutos), no propios |
| `vehicle-selection.ts`: reducer | **Rediseñado** con las mismas reglas | Se agregó el tipo, "No sé el año" y "No conozco el motor", y la verificación de pertenencia en cada nivel |
| `vehicle-context.ts`: niveles de verificación calculados en el servidor, "contradicciones degradan en vez de adivinar", valores entre comillas en el prompt | **Concepto reutilizado** en `vehicle-validation.ts` y en el prompt v2.3.0 | Se mantiene el principio de no confiar en el cliente |
| `vehicle-context.ts`: `VehicleContext` con bloques `verifiedSpecs` y `unknown` | Descartado por ahora | No hay fuente técnica. Se reemplaza por `engineSource` y `fuelSource` en `Vehicle` |
| `argautos-catalog-provider.ts` y `runtime.ts` (`ARGAUTOS_API_KEY`) | **Descartado** | Fuente bloqueada: sin términos de uso ni permiso escrito (auditoría 7D) |
| `cached-catalog-provider.ts` | Descartado en 7D.1 | Los datos son locales y estáticos, así que no hace falta caché. Queda como referencia para una fuente remota |
| `app/api/vehicle-catalog/route.ts` | **Reescrito** | Niveles nuevos (tipos, años), IDs propios, procedencia con `isFixture` |
| Tests 6.5 (44) | No se copiaron | Probaban ArgAutos (HTTP, 429, paginación). Los 7D.1 cubren el contrato nuevo |

## 2. Contratos implementados

### Catálogo (`src/domain/vehicle/vehicle-catalog.ts`)

- **`VehicleCatalogProvider`**, con estas operaciones:
  - `listTypes()`;
  - `listBrands(typeId)`;
  - `listModels(typeId, brandId)`;
  - `listYears(modelId)`: devuelve `null` si la fuente no tiene años;
  - `listVersions(modelId, year | null)`.
- **Respuestas:** cada una es `CatalogResult` con `meta` = `{ source, version, kind, isFixture, attribution? }`.
- **IDs propios y estables:** `t:`, `b:`, `m:`, `v:` más un slug, validados con zod. Nunca son el ID de un proveedor.
- **Categorías:** auto, moto, pickup, suv, utilitario, camión y otro. Se mapean al `vehicleType` legado para que los clientes existentes sigan funcionando.
- **Motor:** `CatalogVersion.engine` solo existe si la fuente lo informa (`evidence: 'structured' | 'label'`). Nunca se infiere.

### Vehículo (`src/domain/vehicle/vehicle.ts`, campos aditivos y opcionales)

- `engine` y `version`.
- `engineSource` y `fuelSource` (`catalog` | `declared`).
- **`validation`:** `catalog_validated` | `catalog_partial` | `user_declared`. Se calcula **solo en el servidor**.
- `catalog`: `{ source, version, isFixture, typeId?, brandId?, modelId?, versionId? }`.

### API `POST /api/analyze`

**Cambios aditivos:**
- **`vehicle.engine`** (hasta 40 caracteres): antes **se descartaba en silencio**.
- **`vehicle.catalog`**, un objeto estricto:
  - `typeId`, `brandId`, `modelId`, `versionId`;
  - `yearUnknown`, `engineUnknown`;
  - `catalogVersion`.

  Si viene mal formado, la API responde 400 con un mensaje en español.

**Validación en el servidor** (`resolveVehicle`):
- **IDs que no se pertenecen** (marca de otro tipo, modelo de otra marca o de otro tipo): el vehículo queda `user_declared`, con el aviso `catalog_mismatch` y **todos** los IDs descartados.
- **Año fuera de rango, año sin verificar o versión ajena o que no lista el año:** queda `catalog_partial`.
- **Catálogo apagado, caído o con timeout:** queda `user_declared`, con el aviso `catalog_unavailable`. **Nunca bloquea el diagnóstico.**
- **Cuando los IDs son válidos**, los nombres salen del catálogo y los del cliente se ignoran.
- **Motor y combustible** salen de la versión solo si la versión los informa. Si contradicen el combustible declarado, gana el catálogo y se registra `fuel_conflict`.
- **El cliente no puede declarar el nivel de validación.** El esquema raíz no es estricto (por compatibilidad), así que `validation` u otras claves extra se descartan. En `catalog`, que sí es estricto, una clave extra da 400.

### Prompt de diagnóstico v2.3.0

El system prompt **no cambió**. El contenido de usuario suma:
- tipo de vehículo, versión, motor y combustible, en español y sin enums;
- el origen de esos datos:
  - "declarados por la persona, sin verificar";
  - "elegidos de un catálogo… no es una ficha técnica";
  - "validados parcialmente";
  - "catálogo de prueba", cuando corresponde.

`vehicleLineOf` incluye el motor, para que diagnosis-quality no marque como inventado un hecho que lo menciona. **No se validó con el modelo real** (requiere una corrida autorizada).

### Catálogo: ruta y configuración

- **`GET /api/vehicle-catalog?level=types|brands|models|years|versions`:**
  - un nivel por request;
  - parámetros validados con zod de forma estricta;
  - procedencia en cada respuesta;
  - `manualFallback` ante vacío o error;
  - `Cache-Control: public, s-maxage=3600`.
- **Flag:**
  - `VEHICLE_CATALOG_ENABLED=true` (literal), más `VEHICLE_CATALOG_SOURCE=fixture`, que es la **única** fuente;
  - apagado por defecto, en cuyo caso la ruta da 404 y los formularios son idénticos a antes;
  - **el fixture nunca se sirve con `VERCEL_ENV=production`**, sin override.
- **`StaticCatalogProvider`:**
  - verifica la integridad del dataset: IDs únicos, padres existentes, tipo listado para la marca, años de versión dentro de los del modelo;
  - un dataset roto responde `INVALID_DATA` en todas las llamadas;
  - `withCatalogTimeout` (3 s) convierte un cuelgue en `TIMEOUT` y una excepción en `UNAVAILABLE`.
- **Fixture sintético** (`fixture-catalog.ts`):
  - marcas, modelos y versiones **ficticios** ("Ficticia Autos", "Sedán A"…);
  - cubre categorías vacías, una marca con dos tipos, discontinuados, un modelo sin años y versiones con y sin motor (nafta, diésel, GNC, híbrido);
  - la UI muestra "Catálogo de prueba… no representan vehículos reales ni el mercado argentino".

### Componente `VehicleSelector` (`src/components/vehicle/vehicle-selector.tsx`)

- **Flujo:** Tipo (grupo de radios) → Marca → Modelo → Año → Versión / motor.
- **Controles nativos**, todos con su label:
  - búsqueda en listas de más de 8 opciones (no en años);
  - alto mínimo de 44 px;
  - ancho completo en móvil.
- **Opciones de desconocimiento:** "No sé el año" y "No conozco el motor ni la versión".
- **Modelo sin años** en el catálogo: se ofrece un año marcado "como dato tuyo, sin verificar".
- **Modelos discontinuados:** aparecen marcados "(ya no se fabrica)", no ocultos.
- **Reset de los campos dependientes:** se anuncia en una región `aria-live`.
- **Estados:** cargando, vacío, error (con Reintentar), timeout (5 s en el cliente) y sin conexión. Todos ofrecen "Escribir los datos a mano".
- **"No encuentro mi vehículo":** pasa a campos libres con el aviso "Datos escritos a mano. No se verifican con un catálogo." Conserva lo elegido como texto y descarta los IDs.

### Integración en las demos (flag apagado por defecto)

- **`/demo/falla`:**
  - se separó en `page.tsx` (servidor, lee el flag) y `falla-client.tsx` (el cliente de siempre);
  - con el flag, el selector reemplaza tipo, marca, modelo y año;
  - el combustible solo se pregunta si la versión no lo informa.
- **`/demo/presupuesto`:**
  - con el flag, el selector reemplaza los campos libres;
  - "Usar ejemplo" carga el Fiat Palio **en modo manual, no verificado**, porque es un vehículo real y nunca puede venir del fixture.
- **Con el flag apagado:** todo queda igual, salvo que **el motor tipeado ahora llega a `/api/analyze`**. Antes se perdía.
- **Sin cambios:**
  - las rutas legacy `/falla` y `/presupuesto`;
  - el contrato de precios 7C, el proveedor SerpApi y la búsqueda pública;
  - el Safety Gate, el Severity Assessor y los rate limits.

## 3. Tests (RED → GREEN)

| Suite | Antes del fix | Después |
|---|---|---|
| `vehicle-context.api.test.ts` (VA-01..04, 11 tests: motor y combustible, compatibilidad, cliente que no puede declarar la validación, combinaciones inválidas, fixture en producción, año y motor desconocidos) | **10 RED**: el motor se perdía en el API | 11 GREEN |
| `diagnosis-prompt.test.ts` DP-7D1 (6 tests: motor, combustible y tipo en español, procedencia, inyección por el campo motor, sin vehículo, `vehicleLineOf`) | **4 RED** | GREEN |
| `vehicle-catalog.test.ts` (VC-01..06, 33 tests: listados dependientes por tipo, discontinuados, años nulos, versiones por año, integridad, timeout y fallo, combinaciones válidas e inválidas, flag y guarda de producción) | — | GREEN |
| `vehicle-catalog/route.test.ts` (11 tests) | — | GREEN |
| `vehicle-selection.test.ts` (SEL-01..03, 14 tests: resets, selecciones inválidas, modo manual, mapeo a la API y a precios) | — | GREEN |
| `vehicle-selector.test.tsx` (VS-01..06, 17 tests: moto/auto, resets, año y motor desconocidos, vacío, error, timeout, offline, modo manual, aviso de fixture, radios y búsqueda accesibles) | — | GREEN |

**Regresión completa:**

| Verificación | Resultado |
|---|---|
| Vitest | **1735/1735** (74 archivos; antes 1643) |
| Playwright producción (copia aislada, CI) | **112/112**: los 103 anteriores sin cambios + 9 nuevos (`vehicle-selector.spec.ts`: flag apagado, flujo completo con IDs en el request, resets, modo manual, falla y offline, presupuesto, 390 y 320 con teclado y 44 px, capturas 1280) |
| Playwright desarrollo | 3/3 |
| TypeScript | OK |
| ESLint | OK (solo el warning habitual de fuentes en `layout.tsx`) |
| Build | OK |

**Seguridad y costo:**
- El bundle cliente (`.next/static`) no contiene "Ficticia Autos", `VEHICLE_CATALOG` ni `SERPAPI_API_KEY`.
- 0 llamadas reales a LLM o SerpApi: E2E con `LLM_PROVIDER=stub` y `PARTS_PRICING_PROVIDER=none`.

**Capturas:** `reviews-local/screenshots/7d1-vehicle-selector/`
- `falla-selector-1280.png`, `-390.png` y `-320.png`;
- `presupuesto-selector-1280.png`.

Revisadas: sin desborde y con el aviso de catálogo de prueba visible.

## 4. Investigación DNRPA

### Documento identificado

| Dato | Valor |
|---|---|
| Página oficial | https://www.dnrpa.gov.ar/valuacion/cons_valuacion.php |
| PDF vigente | `https://www.dnrpa.gov.ar/valuacion/informacion/01-11-2026.pdf` ("Vigencia 01/11/2026") |
| SHA-256 | `6b841352d4f7f35feb43bf185e9612827d5fe140b27c551bcb5776d8b20dc1ba` |
| Tamaño y páginas | 3,3 MB y 217 páginas |
| Descarga | 1 GET al PDF y 1 a la página, solo para análisis. **No se incorporó al repo ni al producto** |

### Estructura (verificada en el PDF)

- **Columnas:**
  - `I/N` (importado o nacional);
  - `MTM/FMM` (código);
  - `T`: `A` automotor o `M` motovehículo;
  - códigos de fabricante, marca, tipo y modelo;
  - descripción de marca, de modelo y de tipo;
  - valuación de 0 km y de **2025 a 2002**.
- **18.180 filas:** 14.575 automotores y 3.605 motovehículos.
- **"Desc. Tipo"** es la carrocería registral: SEDAN 4 PUERTAS, PICK-UP, RURAL 5 PUERTAS, TODO TERRENO, FURGON, MOTOCICLETA, CUATRICICLO, CHASIS C/CABINA, CAMION…
  - **No equivale a la categoría del producto.** Por ejemplo, el Peugeot 2008 figura como "SEDAN 5 PUERTAS" y la Hilux SW4 como "PICK-UP / TODO TERRENO". Hace falta un mapeo propio y revisado a mano.
- **Hay filas duplicadas** de un mismo modelo con códigos `I` y `N` distintos. Hay que deduplicarlas.
- **La versión es texto del modelo**, por ejemplo "PALIO (326) ATTRACTIVE 5P 1.4 8V" o "PALIO ADVENTURE 1.7TD". Motor y combustible **no son campos**: solo aparecen dentro de ese texto.
- **Extracción:** con `pdftotext -raw` sale bien la descripción. Para asignar cada valor a su año se usó `-table`, por posición de columna: alineó 14.362 de 18.180 filas (79 %). El resto son descripciones que ocupan dos líneas. **Un ETL de producción necesita un parser más robusto** y una verificación manual.

### Cobertura sobre una muestra de 58 vehículos argentinos

**Encontrados: 53 de 58 con el nombre buscado; 54 de 54 si se excluyen los clásicos de antes de 2002.**

| Grupo | Muestra | Resultado |
|---|---|---|
| Autos (20) | Gol, Gol Trend, Palio, Siena, Cronos, 208, Etios, Corolla, Onix, Corsa, Classic, Sandero, Clio, Ka, Focus, C3, Versa, Civic, Fiesta, Logan | **20/20**. Con cilindrada en el texto: entre 17 % (Civic) y 100 % (Gol Trend, Etios, Cronos) |
| SUV (6) | Renegade, Taos, 2008, EcoSport, SW4, Tracker | **6/6**. Taos sin cilindrada en el texto (0/10) |
| Pick-ups (8) | Hilux, Ranger, Amarok, S10, Strada, Toro, Alaskan, Frontier | **8/8**. Marca diésel frecuente (p. ej. Amarok 274/299) |
| Utilitarios (5) | Kangoo, Fiorino, Partner, Berlingo, Sprinter | **5/5**. GNC aparece en pocas filas (Kangoo 6, Partner 10) |
| Motos (12) | Wave, CG/Titan, Blitz, Energy, Smash, YBR, ZB, Keller, Rouser, Skua, FZ, XR | **11/12 con el nombre comercial.** La Motomel **Blitz** figura con el código registral **"B110"**. **Ninguna moto trae cilindrada como "x.x"**: la cilindrada va en el nombre ("125", "150"), a veces ni eso |
| Camiones (3) | Iveco Daily, Mercedes Accelo, Ford Cargo | **3/3** |
| Clásicos (4) | Falcon, Renault 12, Fiat 128, Peugeot 504 | **0/4**. La tabla vigente arranca en 2002. Las tablas históricas no se evaluaron |

**Años:**
- Palio 2002–2018.
- Gol Trend 2008–2022.
- Cronos 2018–2025 y 0 km.
- Se corresponden con los años que el **registro valúa**, no con los de fabricación.

### Licencia y permiso de uso

- **No hay licencia explícita para la tabla.** La página de valuación no muestra términos de uso.
- **La única mención a una licencia es un aviso "Creative Commons Atribución 4.0" que está dentro de un comentario HTML** (`<!-- … -->`, no visible) y se refiere a "los contenidos de Argentina.gob.ar", no al PDF de dnrpa.gov.ar.
- **El PDF no está en datos.gob.ar.** La leyenda del portal ("reutilizar libremente citando la fuente") no lo alcanza.
- **Conclusión:** que la tabla sea pública **no significa** que tenga licencia abierta. **Su reutilización no está autorizada de forma explícita.** Antes de incorporarla, hay que pedir confirmación por escrito a la DNRPA (nota formal o pedido por la Ley 27.275 de acceso a la información pública) y definir la atribución.

### Veredicto DNRPA

**Técnicamente es la mejor candidata:** cubre autos, SUV, pick-ups, utilitarios, motos y camiones desde 2002, con códigos registrales.

**Limitaciones:**
- motor y combustible solo como texto;
- carrocería registral en lugar de categoría;
- nombres registrales en algunas motos;
- sin clásicos anteriores a 2002;
- PDF difícil de procesar.

**Estado del permiso: NO resuelto.** **No se incorpora al producto.**

## 5. Riesgos pendientes

1. **Permiso de la DNRPA** sin resolver. Bloquea cualquier dataset real.
2. **Mapeo de carrocería registral a categoría:** es manual y tiene ambigüedades (SUV cargados como sedán o pick-up).
3. **Motor y combustible en motos y camiones:** casi nunca figuran. Lo más común va a ser "No conozco el motor".
4. **Nombres registrales distintos del comercial** (B110 por Blitz): hará falta una tabla de alias.
5. **Vehículos anteriores a 2002:** van a quedar en modo manual o habrá que usar las tablas históricas.
6. **Prompt v2.3.0:** no se evaluó con el modelo real.
7. **`/api/vehicle-catalog` sin rate limit por cliente.** Hoy son datos locales y baratos; queda para 7D.2.
8. **Rutas legacy** `/falla` y `/presupuesto`: siguen con campos libres y sin motor. Hay que decidir si se migran o se retiran.
9. **Contrato de precios 7C sin cambios:** todavía no recibe el combustible estructurado. El paso 7D.6 está pendiente.
10. **E2E del selector:** solo corre en CI (servidor 3002) o con `PLAYWRIGHT_CATALOG_BASE_URL`; en local, sin esa variable, se saltea.

## 6. GO/NO-GO para 7D.2

**GO para 7D.2** (API de catálogo endurecida y preparación del ETL), con estos alcances:
- rate limit por cliente en `/api/vehicle-catalog`;
- un formato de dataset versionado en disco con `manifest.json` y hash;
- un script de ETL **sobre una copia local** del PDF;
- mapeo de categorías y alias;
- tests de integridad;
- sin publicar datos.

**NO-GO** para incorporar el dataset DNRPA al repo o al producto, y para encender el flag fuera de entornos locales o de preview protegidos, mientras no haya un permiso de uso escrito.
