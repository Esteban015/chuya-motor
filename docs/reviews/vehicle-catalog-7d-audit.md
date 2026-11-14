# Incremento 7D — Catálogo de vehículos y selección escalonada: auditoría y propuesta

Fecha: 2026-11-14 · Rama: `feature/automatic-parts-pricing` (sin commit) · Estado: **solo auditoría, sin implementación**.

## Alcance de esta entrega

- **Sin cambios de código.** No se tocó el stash 6.5: se leyó en modo solo lectura (`git show stash@{0}:…`).
- **Sin llamadas reales** a LLM, SerpApi ni a la API de ArgAutos.
- **Consultas web:** solo búsquedas web y lecturas de páginas públicas de documentación (vPIC, DNRPA, Clasificar, Mercado Libre, datos.gob.ar).
- **No se descargó ningún dataset.**

---

## 1. Auditoría del código actual

### 1.1 Quién usa los datos del vehículo

| Consumidor | Campos | Observaciones |
|---|---|---|
| `/demo/falla` (`src/app/demo/falla/page.tsx`) | `vehicleType`, `make`, `model`, `year`, `fuelType` (texto libre y selects) | Envía `ApiVehicleInput` a `/api/analyze` |
| `/falla` (`src/app/falla/page.tsx`, ruta legacy activa) | Ídem | Formulario duplicado: se debe migrar o retirar junto con el de la demo |
| `/demo/presupuesto` (`presupuesto-client.tsx`) | `make`, `model`, `year`, `engine`, `vehicleType` | `engine` **no** se envía a `/api/analyze` (comentario "Unchanged contract"). Solo se usa en las búsquedas 7B y en precios 7C. No envía `fuelType` |
| `/presupuesto` (ruta legacy) | `make`, `model`, `year`, `vehicleType` | Duplicado |
| `POST /api/analyze` (`route.ts`, `ApiVehicleSchema`) | make ≤50, model ≤50, year 1900–2100, vehicleType, fuelType | `z.object` sin `.strict()`: las claves desconocidas (`engine`, `version`, ids) **se descartan en silencio** |
| Dominio `VehicleSchema` (`src/domain/vehicle/vehicle.ts`) | + odometer y licensePlate (no expuestos por la API) | No tiene motor, versión, procedencia ni nivel de validación |
| LangGraph: `diagnosis-prompt.ts` | **Solo** make, model y year (`vehicleLine` y `vehicleLineOf`) | `vehicleType` y `fuelType` llegan al estado pero **no los usa ningún nodo** |
| LangGraph: `validator.ts` | make, model, year | Agrega "Marca, modelo y año no especificados" a missingInformation |
| LangGraph: `evaluator.ts` | make, model, year | — |
| `PartSearchBuilder` 7B (`part-search.ts`) | `VehicleInfo { make, model, year: string, engine }` | Sanea y recorta a 40 caracteres. Arma la consulta de Google |
| API de precios 7C (`PartsPricesRequestSchema`, `.strict()`) | make, model, year (string regex), engine (≤40) | Un campo nuevo sin cambio de esquema da **400** (strict). Bien para la seguridad, pero cualquier cambio de contrato debe ser aditivo y explícito |
| Matching 7C (`matching.ts`) | `engine` como texto | Extrae la cilindrada (`\d[.,]\d`) y detecta diésel por marcas del texto. **No contempla GNC.** No tiene un combustible estructurado |
| Feedback y Analytics | Ninguno | `feedback-url.ts` garantiza que no salen datos del vehículo. Hay tests que lo verifican |

### 1.2 Qué llega al backend y qué se pierde

| Dato | Diagnóstico (`/api/analyze`) | Precios (`/api/budget/parts-prices`) |
|---|---|---|
| Marca, modelo, año | Llega y se usa en el prompt | Llega y se usa en la consulta y el matching |
| Tipo de vehículo | Llega, **no se usa** | No se envía |
| Combustible | Llega desde /falla, **no se usa**. /presupuesto no lo envía | No existe en el contrato |
| Motor | **Se pierde** (no está en el contrato) | Llega como texto libre |
| Versión | No existe | No existe |
| Identificador de catálogo | No existe | No existe |
| Validado o declarado | No se distingue | No se distingue |

### 1.3 Problemas estructurales

1. **El enum `vehicleType` mezcla carrocería con categoría.** Tiene `sedan | hatchback | suv | pickup | van | motorcycle | other`. Le faltan camión, cuatriciclo y otras categorías del registro. El catálogo necesita una **categoría** (auto, moto, pick-up, SUV, utilitario, camión, otro) y debe mapearla al enum legado para no romper clientes.
2. **El año tiene dos tipos.** Es `number` en analyze y `string` en precios.
3. **Los cuatro formularios están duplicados**, cada uno con su propia validación.
4. **No hay procedencia.** Hoy un "Palio 1.4" escrito a mano y uno validado contra un catálogo son indistinguibles para el servidor.

### 1.4 Trabajo previo reutilizable: stash 6.5 (no aplicado)

Contiene un POC de 1569 líneas basado en ArgAutos, con 44 tests:

- `VehicleCatalogProvider`, con `listBrands`, `listModels` y `listVersions`, y `CatalogRef { provider, catalog, id }`;
- `CachedCatalogProvider` (TTL, copia vieja y dedupe);
- `vehicle-selection.ts`: estado puro con reset de dependientes, "No sé la versión" y modo manual;
- `VehicleContext`, con niveles `user_declared`, `catalog_listed` y `catalog_listed_with_year` calculados en el servidor;
- la ruta `/api/vehicle-catalog`, detrás de un flag.

**Le falta:**
- el nivel **tipo de vehículo**;
- el listado de años como paso propio;
- los motores estructurados;
- el selector visual;
- la integración con los repuestos.

**La fuente quedó bloqueada:** ArgAutos no publica términos de uso y requiere un permiso escrito. La recomendación es reutilizar el diseño y no la fuente. Restaurar el stash lo decidís vos; yo no lo voy a tocar.

---

## 2. Matriz de fuentes de catálogo

| Fuente | Qué es | Cobertura AR | Categorías | Marca / Modelo / Año / Versión / Motor / Combustible | IDs estables | Acceso | Costo y límites | Reutilización | Actualización | Discontinuados | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **NHTSA vPIC** | Base de EE. UU. alimentada por las declaraciones de fabricantes (49 CFR 565) | **No representativa.** Modelos para el mercado de EE. UU.; no hay evidencia de Palio, Gol Trend o motos nacionales | car, truck, moto, etc. | Marca y modelo; año ≥1995 en las consultas por año. Motor y combustible solo vía VIN | MakeId y ModelId | API pública gratuita y DB descargable | Gratis; límite automático no publicado | Dominio público (gobierno de EE. UU.) | Continua | Sí, por año-modelo | **NO como fuente principal.** A lo sumo, una verificación cruzada de marcas globales |
| **Clasificar (clasific.ar)** | "Plataforma independiente de información vehicular de Argentina" centrada en la **consulta por patente** | Argentina, pero orientada a dominios registrados | No especificado | No se documenta un endpoint de catálogo | No documentado | Anuncia una "API REST" para concesionarias, flotas y fintech, y un MCP | Sin precios publicados | Sin términos publicados | — | — | **NO-GO.** No se verificó un catálogo. Además, su modelo es por patente, que es un dato personal que Chuya Motor no pide |
| **Valumotor** | **No se pudo verificar que exista**: valumotor.com da 404 y no aparece en búsquedas | — | — | — | — | — | — | — | — | — | **Descartada hasta que indiques la URL exacta** |
| **DNRPA: Tabla de Valuación de Automotores y Motovehículos** | Tabla oficial para calcular los aranceles registrales. La aprueba una disposición; la vigente es la DN 160/2026, del 01-11-2026 | **Alta**: es el registro nacional. Incluye autos, utilitarios, camiones y motos en un solo archivo (según una fuente secundaria; falta verificarlo contra el PDF) | Por tipo de carrocería ("SEDAN 4 PTAS", pick-up, moto…) | Marca, modelo con texto de versión (p. ej. "COROLLA 2.0 SEG CVT") y tipo; años-modelo con valuación (0 km y ~24 años hacia atrás). **Motor y combustible solo como texto del nombre** | **Sí: códigos registrales de marca, modelo y tipo** | **Solo PDF** (actual e históricos) y un buscador web. Sin API | Gratis | No hay términos en la página. Es información pública estatal, pero **la reutilización no está confirmada por escrito**: no está en datos.gob.ar con licencia explícita | Varias veces por año (por disposición) | Las tablas históricas conservan los modelos dados de baja. **Hueco**: vehículos de más de ~24 años | **Mejor candidata para el tipo, la marca, el modelo y el año.** Requiere confirmar la reutilización y un ETL robusto de PDF |
| **ArgAutos** (POC 6.5) | API sobre guías de precios (CCA, ACARA) y un catálogo propio | Media-alta en autos con precio. Motos: hay endpoint, sin verificar | Autos; motos por verificar | Marca, modelo, versión (nombre comercial) y años con precio. **Sin motor ni combustible estructurados** | IDs numéricos por subcatálogo | API REST | Anónimo 3/min; Starter 15/min y 1000/día; Pro 40/min y 5000/día; precios no verificados | **Sin términos ni licencia.** Es un autor individual y los datos son de terceros (CCA, ACARA) | Continua | Años con precio, no de fabricación | **Bloqueada** hasta un permiso escrito. Alternativa secundaria |
| **Mercado Libre: catálogo de compatibilidades** (`MLA-CARS_AND_VANS`) | Catálogo de vehículos que ML usa para las compatibilidades de autopartes | Alta para autos y utilitarios del mercado AR. **Motos no verificado** | Autos y utilitarios; motos sin confirmar | BRAND, MODEL, VEHICLE_YEAR, SHORT_VERSION, **ENGINE** (es la más rica para repuestos) | IDs de valores de atributo | API con token OAuth de app | Gratis con app registrada | **Los términos de la API apuntan a operar en ML.** Usarla como catálogo propio requiere revisión legal. Desde el 15/07/2026, la lectura de compatibilidades del catálogo es resumida | Continua | No documentado | **Candidata secundaria para motores**, sujeta a revisión legal. No usar sin autorización |
| **InfoAuto** | Guía de precios comercial (desde 1996) | Alta (autos y motos en su guía) | Autos y motos | Marca, modelo, versión y años; ficha técnica no verificada | Códigos InfoAuto (usados por aseguradoras) | **Sin API pública documentada**; licencia comercial por contrato | Pago (no publicado) | Por contrato | Mensual | Sí | **Opción comercial** si se quiere una fuente licenciada con SLA. Requiere contacto comercial |
| **datos.gob.ar: estadísticas DNRPA** | Conteos de trámites (0 km y transferencias) por mes y provincia | — | Autos, motos y maquinaria por separado | Las descripciones no muestran columnas de marca ni modelo (sin verificar) | — | CSV | Gratis | "Reutilizar citando la fuente" | Mensual | — | **No sirve como catálogo.** Podría servir para priorizar qué modelos cubrir primero, si tiene marca y modelo |
| Wikipedia / listas comunitarias | Listas de modelos comercializados | Parcial y desactualizada | — | Sin estructura | No | — | — | CC BY-SA (obliga a compartir igual) | Irregular | — | **NO** |
| SerpApi / Google Shopping | — | — | — | — | — | — | — | — | — | — | **Excluida por requisito**: no se usa para construir el catálogo |

### Cobertura verificable para Argentina (qué está realmente verificado)

| Afirmación | Estado |
|---|---|
| ArgAutos lista 11 versiones del Fiat Palio 2017 con IDs estables | **Verificado en vivo en 6.5** (8 GET, 2026-11-12) |
| ArgAutos no entrega motor ni combustible estructurados | **Verificado en 6.5** |
| La DNRPA publica la tabla vigente en PDF (DN 160/2026, archivo `01-11-2026.pdf`) y tablas históricas | **Verificado** en la página oficial |
| La tabla DNRPA consulta por códigos de marca, modelo y tipo o por nombre de marca | **Verificado** en la página oficial |
| La tabla DNRPA incluye autos, utilitarios, camiones y motos, con 0 km y años 2002–2025 | **Fuente secundaria** (multabot.com.ar). **Falta verificarlo en el PDF** |
| La versión DNRPA incluye la cilindrada en el nombre ("COROLLA 2.0 SEG CVT") | **Fuente secundaria**, un solo ejemplo |
| vPIC no cubre modelos exclusivos del mercado argentino | **Inferido** del origen de los datos (declaraciones de EE. UU.). No se hizo una prueba en vivo |
| Mercado Libre expone ENGINE y SHORT_VERSION en `MLA-CARS_AND_VANS` | **Documentado** por ML, no probado (requiere token) |
| Clasificar ofrece un catálogo de marca, modelo y versión | **No verificado** (solo patente) |
| Valumotor existe | **No verificado** |

**Conclusión:** hoy **ninguna fuente está verificada a la vez en cobertura, campos y permiso de uso**. Por eso no se implementa el catálogo con datos reales en esta entrega.

---

## 3. Arquitectura elegida

**Principio:** la fuente cambia y el contrato no. El catálogo se sirve **desde datos locales versionados** generados offline, nunca consultando una API de terceros en cada visita.

```
[Fuente autorizada] ──ETL offline (script, revisión humana)──▶ data/vehicle-catalog/<versión>/
                                                                 ├─ manifest.json (fuente, fecha, hash, licencia)
                                                                 ├─ types.json
                                                                 ├─ brands/<type>.json
                                                                 └─ models/<brandId>.json  (modelos → años → versiones)
Navegador ──GET /api/vehicle-catalog?level=…──▶ ruta (flag, rate limit, zod) ──▶ LocalCatalogProvider (lazy import por shard, LRU)
POST /api/analyze | /api/budget/parts-prices ──▶ validateVehicleSelection() ──▶ vehículo normalizado + nivel de validación
```

### 3.1 Contrato `VehicleCatalogProvider`

Extiende el del stash 6.5:

```ts
interface VehicleCatalogProvider {
  readonly meta: { source: string; version: string; generatedAt: string; kind: 'registry' | 'price_guide' | 'technical' }
  listTypes(): Promise<CatalogType[]>                                    // auto, moto, pickup, suv, utilitario, camion, otro
  listBrands(typeId: TypeId): Promise<CatalogBrand[]>
  listModels(typeId: TypeId, brandId: BrandId): Promise<CatalogModel[]>  // incluye discontinued: boolean
  listYears(modelId: ModelId): Promise<number[] | 'unknown'>
  listVersions(modelId: ModelId, year: number | null): Promise<CatalogVersion[]>
}
interface CatalogVersion {
  id: VersionId
  label: string                       // textual, tal como figura en la fuente
  engine?: { displacementL?: number; fuel?: 'nafta' | 'diesel' | 'gnc' | 'hibrido' | 'electrico'; evidence: 'structured' | 'label' }
  years?: number[]
  sourceRefs: SourceRef[]             // p. ej. { source: 'dnrpa', marca: '…', modelo: '…', tipo: '…' }
}
```

### 3.2 Identificadores estables

- **IDs propios, opacos y versionados por namespace.** Ejemplos: `t:auto`, `b:fiat`, `m:fiat-palio`, `v:<hash corto de sourceRefs>`. Nunca se usa el ID del proveedor como clave primaria.
- **Mapeo explícito `sourceRefs`.** Permite cambiar o combinar fuentes (DNRPA más Mercado Libre para motores) sin romper selecciones guardadas.
- **Si una versión desaparece en una nueva versión del catálogo**, su ID queda en `retired.json` con un reemplazo opcional. El servidor la acepta como `catalog_listed_retired`, sin rechazar al usuario.

### 3.3 Datos locales versionados

- `data/vehicle-catalog/<YYYY-MM-DD>/` va al repo, o como artefacto de build si es grande.
- `manifest.json` lleva la fuente, la licencia o permiso, la fecha, el SHA-256 de cada shard y los conteos.
- Hay un test de integridad en CI:
  - sin huérfanos;
  - IDs únicos;
  - años dentro de rango;
  - etiquetas no vacías;
  - hash coherente.
- **El frontend nunca descarga el catálogo completo.** Pide un nivel por vez:
  - tipos (~10 ítems);
  - marcas del tipo (~100);
  - modelos de la marca (~10–200);
  - años y versiones del modelo.
- Las respuestas llevan `Cache-Control: public, s-maxage=86400` y un ETag igual a la versión del catálogo.

### 3.4 Validación del lado del servidor

`validateVehicleSelection(input)` se aplica en `/api/analyze` y en `/api/budget/parts-prices`:

1. **Recibe IDs y nombres**, y recalcula los nombres desde el catálogo. No confía en los nombres del cliente si vienen IDs.
2. **Verifica la cadena de pertenencia:**
   - tipo ∋ marca;
   - marca ∋ modelo;
   - año ∈ años del modelo, o "desconocido";
   - versión ∈ versiones del modelo y año.
3. **Combinación inválida** (IDs que no se pertenecen): se rechaza la referencia. La respuesta es 400 con un mensaje genérico, o una degradación a `user_declared` con los nombres saneados; se decide en la implementación (recomendado: degradar, para no bloquear el diagnóstico).
4. **Calcula `validation`**:
   - `catalog_validated` si coincide la cadena completa hasta el nivel enviado;
   - `catalog_partial` si, por ejemplo, el modelo coincide pero el año está fuera de rango;
   - `user_declared` si es manual.

   **Nunca lo acepta del cliente.**
5. **El motor y el combustible solo se completan** si la versión los tiene con `evidence`. Si no, quedan desconocidos. Nunca se infieren del modelo.

### 3.5 Compatibilidad de contratos (aditiva)

- `ApiVehicleInput` agrega `catalog?: { typeId?, brandId?, modelId?, versionId?, yearUnknown?, engineUnknown? }` y `engine?: string`.
- `vehicleType` y `fuelType` legados se siguen aceptando. El servidor los deriva del catálogo cuando hay IDs.
- `PartsPricesRequestSchema` (strict) agrega `vehicle.catalog` opcional y `vehicle.fuel` opcional.
- Los clientes viejos siguen funcionando sin cambios.

---

## 4. Propuesta UX: `VehicleSelector`

**Orden:** Tipo → Marca → Modelo → Año → Versión/Motor. Cada paso se habilita al completar el anterior.

| Paso | Control | Detalles |
|---|---|---|
| Tipo | Grupo de botones-radio con íconos de texto: Auto · Moto · Pick-up · SUV · Utilitario · Otro | Pocas opciones, así que no hace falta búsqueda. Accesible con flechas (`role="radiogroup"`) |
| Marca | Combobox con búsqueda (patrón ARIA 1.2 combobox con listbox) | Filtra sin tildes ("citroen" → Citroën). Muestra primero las marcas más comunes si la fuente lo permite |
| Modelo | Combobox con búsqueda | Los discontinuados se muestran con la etiqueta "(ya no se fabrica)", **no se ocultan** |
| Año | Select nativo, del más nuevo al más viejo, + **"No sé el año"** | Si la fuente no tiene años para ese modelo, se usa un campo numérico 1900–2100 marcado como "no verificado" |
| Versión / motor | Lista de versiones (texto de la fuente) + **"No conozco el motor / la versión"** | Si la versión tiene una cilindrada o combustible con evidencia, se muestra como "según la denominación de la versión" |

**Reglas de estado**, reutilizando `vehicle-selection.ts` del 6.5 y extendiéndolo con el nivel tipo:

- **Cambiar un nivel superior limpia todos los dependientes.** Se anuncia con `aria-live="polite"`, por ejemplo: "Se borró el modelo porque cambiaste la marca".
- **Nunca se conserva una selección que no pertenece al padre actual.** Se verifica también al rehidratar el formulario.
- **"No encuentro mi vehículo"** está siempre visible desde el paso Marca:
  - pasa a campos libres (los de hoy) precargados con lo ya elegido;
  - descarta los IDs;
  - el servidor lo marca `user_declared`.
- **Lo que se muestra mientras carga cada paso:**
  - **loading:** skeleton dentro del control, con `aria-busy`;
  - **vacío:** "No hay modelos cargados para esta marca" y el modo manual;
  - **error o timeout (5 s):** "No pudimos cargar el catálogo. Podés escribir los datos a mano." con un botón Reintentar;
  - **sin conexión** (`navigator.onLine === false` o fallo de red): el mismo modo manual, sin perder lo tipeado.
- **Se conserva el resto del formulario** (síntoma, presupuesto, repuestos) en todo momento.
- **Mobile 320/390:** controles a ancho completo, alto mínimo de 44 px, listbox con alto máximo de 50vh y scroll interno, sin overflow horizontal.
- **No se pide más de lo necesario.** En /falla bastan tipo, marca, modelo y año, y la versión es opcional. En /presupuesto (repuestos) se ofrece la versión/motor porque mejora el matching. Nunca se pide patente ni VIN.

---

## 5. Estrategia de mantenimiento

1. **ETL offline** (`scripts/vehicle-catalog/build.ts`):
   - toma el archivo de la fuente descargado a mano por una persona autorizada (no scraping);
   - genera los JSON normalizados y el manifest.
2. **Diff legible entre versiones:** marcas, modelos y versiones nuevas, retiradas o renombradas. Una persona lo revisa antes de mergear.
3. **Cadencia:** por cada nueva disposición DNRPA (unas 3 o 4 por año) o mensual, según la fuente. Si el catálogo tiene más de 6 meses, el test de CI emite una advertencia, no un fallo.
4. **Discontinuados:** nunca se borran. Se marcan `discontinued` y los IDs retirados van a `retired.json`.
5. **Correcciones manuales:** `overrides.json`, versionado, con el motivo de cada corrección (p. ej. el combustible de una versión cuyo nombre no lo dice). Nunca se mezcla con los datos de la fuente sin rastro.
6. **Atribución visible** ("Datos: DNRPA, tabla de valuación DN 160/2026") si la fuente lo exige o lo recomienda.

---

## 6. Plan de implementación incremental

Cada paso va detrás de un flag apagado por defecto, con RED → GREEN y sin commit hasta que lo autorices.

| Paso | Contenido | Necesita fuente real |
|---|---|---|
| **7D.0: Decisión** (vos) | Elegir la fuente; pedir la confirmación de reutilización a la DNRPA (o el permiso de ArgAutos o un contrato con InfoAuto); autorizar la descarga manual de un PDF de la tabla DNRPA para medir la cobertura; decidir si restaurar el stash 6.5 en su rama | — |
| **7D.1: Dominio y contrato** | `VehicleCatalogProvider` con tipos y años, IDs, `validateVehicleSelection`, niveles de validación, mapeo de categoría al `vehicleType` legado. Fixtures **sintéticas** solo en tests | No |
| **7D.2: API de catálogo** | `GET /api/vehicle-catalog` detrás de un flag, con zod, rate limit por cliente, ETag y caché; `LocalCatalogProvider` sobre shards | No (dataset de prueba) |
| **7D.3: VehicleSelector** | Componente, estados, modo manual, accesibilidad, 320/390. Se monta primero en `/demo/presupuesto` detrás de un flag y luego en `/demo/falla`. Las rutas legacy `/falla` y `/presupuesto` se deciden aparte | No |
| **7D.4: Contratos** | Campos aditivos en `/api/analyze` y precios; validación del servidor; tests de combinaciones inválidas | No |
| **7D.5: ETL y dataset real** | Script, manifest, tests de integridad, primera versión del catálogo; medición de cobertura contra la lista de control | **Sí** |
| **7D.6: Repuestos** | El motor y el combustible estructurados llegan a `PartSearchBuilder` y al matching. Se agrega `fuel` al `fuelSignal` (diésel, nafta, GNC: un título "GNC" para un auto a nafta va **a revisión**, no a descarte, porque el GNC suele ser una conversión). La falta de versión no genera supuestos y el código de pieza sigue prevaleciendo. **SerpApi no cambia** | Recomendado |
| **7D.7: Diagnóstico** | `vehicleLine` suma la versión y el combustible marcados "según catálogo, no ficha técnica". Empieza a usar `vehicleType` y `fuelType`, hoy ignorados. Requiere un bump de la versión del prompt y una evaluación con stub; la medición real, solo con autorización | Recomendado |

Los pasos 7D.1 a 7D.4 se pueden hacer **sin fuente real** y dejan todo listo para enchufar el dataset.

---

## 7. Costos y riesgos

### Costos estimados

| Fuente | Costo directo | Esfuerzo |
|---|---|---|
| DNRPA | 0 | ETL de PDF (el más laborioso: tablas de cientos de páginas, columnas que cambian entre disposiciones) |
| ArgAutos | Plan Starter o Pro (precio no verificado) | Bajo (adaptador ya hecho en 6.5) |
| InfoAuto | Contrato comercial (desconocido) | Bajo o medio |
| Mercado Libre | 0 | Medio (OAuth de app) más revisión legal |

**Infraestructura:**
- **Sin costo nuevo:** datos estáticos en el deploy y Upstash ya existente.
- **Tamaño estimado:** unos miles de modelos, del orden de pocos MB en total y de decenas de KB por shard. No va en el bundle del cliente.

### Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Reutilización de la tabla DNRPA no confirmada | Bloquea producción | Pedido formal (nota o Ley 27.275 de acceso a la información); atribución; hasta entonces, solo uso local |
| La tabla DNRPA está pensada para aranceles: los nombres son registrales ("SEDAN 4 PTAS") y no siempre comerciales | UX menos amigable | Normalizar solo la presentación, conservar el texto original y permitir búsqueda por alias |
| Motor y combustible solo como texto del nombre de la versión | Inferencias erróneas | `evidence: 'label'`, mostrado como "según la denominación"; nunca descartar repuestos solo por eso sin la regla 7C actual |
| Vehículos de más de ~24 años fuera de la tabla vigente | Usuarios sin opción | Tablas históricas y "No encuentro mi vehículo" |
| Motos y categorías menos cubiertas | Selector vacío | Estado vacío con modo manual; medir la cobertura antes de habilitar cada tipo |
| El PDF cambia de formato | ETL roto | Tests de ETL con muestras; el diff obligatorio detecta caídas bruscas |
| Selecciones guardadas que dejan de existir | Errores al rehidratar | `retired.json` y degradar a `user_declared` |
| Inyección o texto basura en el modo manual | Prompt o consulta contaminados | Se mantienen el saneamiento actual (`sanitizeField`), los límites de largo y el prompt con valores entre comillas (diseño 6.5) |
| Regresiones en diagnóstico, 7B o 7C | Funcionalidad rota | Contratos aditivos, flags y la suite completa (1643 Vitest y 103 E2E) |

---

## 8. Criterios GO/NO-GO

**GO para implementar 7D.1 a 7D.4** (sin datos reales) — se cumplen hoy:
- [x] La arquitectura no depende de la fuente.
- [x] Fixtures sintéticas y sin red.
- [x] Detrás de un flag apagado por defecto.
- [x] Contratos aditivos.

**GO para cargar un dataset real (7D.5)** — **todos** deben cumplirse:
1. Permiso de reutilización **por escrito** (o una licencia explícita) de la fuente elegida.
2. Muestra de cobertura sobre una lista de control acordada (p. ej. los 30 autos, 15 motos y 10 pick-ups o utilitarios más patentados):
   - ≥ 90 % encontrados en marca y modelo;
   - ≥ 80 % con años;
   - porcentaje de versiones con cilindrada en el nombre medido y documentado.
3. ETL reproducible, con hash en el manifest y diff revisado.
4. Ningún motor ni combustible sin evidencia.

**GO para habilitar el selector en un piloto protegido:**
- todo lo anterior;
- E2E de accesibilidad y responsive 320/390 en verde;
- modo manual probado ante error, timeout y sin conexión;
- regresión completa en verde;
- sin llamadas reales a LLM ni SerpApi en los tests.

**NO-GO:**
- Usar una fuente sin términos o permiso en producción (ArgAutos hoy, Mercado Libre sin revisión legal).
- Usar vPIC como catálogo argentino.
- Construir el catálogo con SerpApi.
- Inventar combinaciones o motorizaciones.
- Descargar el catálogo completo al cliente.
- Habilitarlo en el dominio público antes del piloto protegido.

---

## Fuentes consultadas

- NHTSA vPIC API: https://vpic.nhtsa.dot.gov/api/
- DNRPA, Tabla de Valuación de Automotores y Motovehículos: https://www.dnrpa.gov.ar/valuacion/cons_valuacion.php
- Estructura de la tabla DNRPA (secundaria): https://multabot.com.ar/blog/cuanto-vale-auto-usado-tabla-valuacion
- Clasificar: https://clasific.ar
- Mercado Libre, dominios y atributos de autopartes: https://developers.mercadolibre.com.ar/referencias-de-dominios-productos-y-atributos-para-autopartes · compatibilidades: https://developers.mercadolibre.com.ar/compatibilidades-entre-items-y-productos
- datos.gob.ar, datasets DNRPA: https://datos.gob.ar/dataset?tags=dnrpa
- InfoAuto (app de consumidor): https://apps.apple.com/np/app/infoauto-argentina/id1550112119
- ArgAutos: evaluación del Incremento 6.5 (stash, solo lectura)
