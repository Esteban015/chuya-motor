# Incremento 7D.2 — Catálogo versionado, niveles de identificación e ingesta offline

Fecha: 2026-11-14 · Rama: `feature/vehicle-catalog-7d` (sobre 7D.1, sin commit) · Stash 6.5 intacto · Sin datos reales de DNRPA en el repo.

## 1. Arquitectura implementada

```
archivo local autorizado (.csv) ──► ingesta offline (CLI, sin red) ──► report.json / report.md (siempre)
                                        │                               dataset.json (solo licencia synthetic/authorized
                                        │                                              + integridad OK)
                                        ▼
                          revisión humana + cambio separado para incluir el dataset en la app
                                        ▼
StaticCatalogProvider (integridad + licencia + hash al cargar) ─► withCatalogTimeout ─► getVehicleCatalog (flag)
      │                                                                                   │
      ├─► GET /api/vehicle-catalog (rate limit por cliente, un nivel por request, sin procedencia)
      └─► resolveVehicle (POST /api/analyze): nivel de IDENTIFICACIÓN calculado solo en el servidor
navegador: VehicleSelector + caché de sesión (createSessionCachedLoader) + fallback manual
```

| Pieza | Archivo |
|---|---|
| Contrato de dominio: fuente, licencia, campos faltantes, verificación, procedencia, IDs retirados | `src/domain/vehicle/vehicle-catalog.ts` |
| Formato v2: esquema, integridad, hash SHA-256, diff entre versiones | `src/server/vehicle-catalog/catalog-dataset.ts` |
| Proveedor local: no sirve datasets rotos, alterados o sin licencia distribuible | `src/server/vehicle-catalog/static-catalog-provider.ts` |
| Niveles de identificación | `src/domain/vehicle/vehicle.ts`, `vehicle-validation.ts` |
| Ingesta offline | `src/server/vehicle-catalog/ingest/{registry-input,normalize,ingest}.ts`, CLI `scripts/vehicle-catalog/ingest.ts` (`npm run catalog:ingest`) |
| Límite por cliente de la API | `src/server/vehicle-catalog/catalog-rate-limit.ts` |
| Caché de sesión del navegador y estado 429 | `src/components/vehicle/vehicle-selector.tsx` |
| Fixture sintético v2 | `src/server/vehicle-catalog/fixture-catalog.ts` |
| CSV sintético con estructura de registro | `src/server/vehicle-catalog/ingest/__fixtures__/synthetic-registry.csv` |

## 2. Esquema del catálogo (v2)

```jsonc
{
  "schemaVersion": 2,
  "manifest": {
    "catalogVersion": "synthetic-registry-2026-11-14.1",
    "generatedAt": "…", "generator": "chuya-catalog-ingest/1",
    "source": { "id", "name", "version" /* edición */, "publishedAt" /* fecha */, "kind", "isFixture",
                "license": { "status": "synthetic|authorized|pending|denied", "reference"? }, "attribution"? },
    "sha256": "…"            // hash del contenido (detecta ediciones manuales o corrupción)
  },
  "types":    [{ "id": "t:auto", "category": "auto", "label": "Auto" }],
  "brands":   [{ "id": "b:…", "name", "aliases": [], "typeIds": [] }],
  "models":   [{ "id": "m:…", "brandId", "typeId", "name", "aliases": [/* nombre registral */], "discontinued",
                 "years": [] | null, "provenance": { "sourceRecordIds": [], "rawText" } }],
  "versions": [{ "id": "v:…", "modelId", "label" /* textual */, "body" /* carrocería registral */ | null,
                 "years": [] | null, "engine": { "displacementL"?, "fuel"?, "evidence": "structured|label" } | null,
                 "missing": ["years"|"body"|"displacement"|"fuel"], "verification": "source_listed|source_conflict",
                 "provenance": { "sourceRecordIds": [], "rawText" } }],
  "retired":  { "<id anterior>": "<id que lo reemplaza>" | null }
}
```

**Reglas:**
- **IDs propios, estables y deterministas.** Se arman con el slug de marca y modelo más un hash de la clave de la versión. Una versión que no cambia conserva su ID entre ediciones; esto está probado.
- **Tipo de vehículo y carrocería van separados.** `typeId` es la categoría del producto; `body` es el texto del registro.
- **`missing` se ajusta exactamente a los datos.** Si un campo falta y no se declara, o al revés, es un error de integridad. Nunca se completa nada.
- **Combustible:** solo aparece si la fuente lo nombra. "Nafta" no se infiere de la ausencia de otra marca.
- **Licencia:** solo `synthetic` y `authorized` (esta última con referencia) son servibles. `pending` y `denied` responden `INVALID_DATA`.
- **La procedencia nunca llega al navegador.** La ruta la quita de cada respuesta.

## 3. Niveles de identificación (revisados)

Se calculan **exclusivamente en el servidor**. El cliente no puede enviarlos: el esquema raíz descarta esas claves y `catalog` es estricto.

| Nivel | Significado |
|---|---|
| `identity_full` | Tipo, marca, modelo, año y versión se corresponden, y la fuente lista ese año para esa versión sin conflicto |
| `identity_basic` | Tipo, marca y modelo verificados; año o versión sin confirmar ("no sé", sin dato de la fuente, versión ausente o retirada) |
| `identity_partial` | Solo tipo, o tipo y marca; el resto es declarado |
| `identity_conflict` | El catálogo contradice los datos: año fuera del modelo o de la versión, combustible declarado distinto al de la versión, o versión con `source_conflict` |
| `user_declared` | Escrito a mano, catálogo caído o IDs que no se pertenecen |

**Identificación no es compatibilidad.** Ningún nivel certifica que un repuesto sirva. El prompt (v2.3.0, system prompt sin cambios) lo dice en cada nivel: "Identificar el vehículo no certifica la compatibilidad de repuestos; no es una ficha técnica". La API del catálogo no usa la palabra "compatible"; hay un test que lo controla.

**Cambios entre versiones del catálogo:**
- Un ID retirado con reemplazo se migra (`catalog_id_migrated`).
- Una versión retirada solo se quita de la selección; el nivel pasa a `basic`.
- Una marca o un modelo retirados sin reemplazo dejan el vehículo como `user_declared` (`catalog_id_retired`).
- Si la selección se hizo con una edición vieja del catálogo, se revalida contra la actual (`catalog_version_changed`).

## 4. Ingesta y normalización

### Entrada
- **Formato:** CSV local con las columnas `record_id, origin, code, class (A/M), brand, model_desc, body, years`.
- **Sin descargas:** se rechazan URLs, archivos que no sean `.csv` y archivos de más de 50 MB.
- **Conversión previa:** una fuente real (por ejemplo, el PDF) primero la tiene que convertir una persona, en local, y solo con la fuente autorizada.

### Pasos
1. **Rechazo:** se descartan las filas sin marca, sin descripción o con clase desconocida.
2. **Marcas:**
   - las grafías con la misma clave se fusionan y se reportan (`FICTICIA-AUTOS` → Ficticia Autos);
   - los alias revisados se aplican por override;
   - las marcas parecidas (una es prefijo de la otra) se **proponen**, no se fusionan.
3. **Categoría:**
   - sale de la carrocería registral: SEDAN→auto, PICK-UP→pickup, TODO TERRENO→suv, FURGON→utilitario, CHASIS C/CABINA→camión, MOTOCICLETA→moto, CUATRICICLO→otro;
   - RURAL, MINIBUS o combinaciones como "PICK-UP / TODO TERRENO" son **ambiguas** y van a cuarentena, salvo override revisado (`marca|familia → categoría`);
   - una carrocería ausente o desconocida también va a cuarentena.
4. **Años:**
   - acepta rangos, listas y "0KM";
   - los años inválidos (por ejemplo 1899 o futuros) se descartan y se avisan;
   - los ambiguos ("2015/16", "17") mandan la fila a cuarentena.
5. **Motor y combustible:** se leen solo del texto de la fuente (evidencia `label`). Marcas incompatibles en el mismo texto (por ejemplo GNC y TD) dejan el combustible desconocido y la versión `source_conflict`.
6. **Familia del modelo:**
   - es la primera palabra, o una familia de varias palabras configurada ("GOL TREND");
   - los códigos de generación como "(326)" quedan en la etiqueta;
   - se **proponen** familias de varias palabras ("LINEA TREND", "LINEA POWER");
   - los nombres que parecen código registral (SX110, B110) se reportan para asignarles un nombre comercial revisado; el código queda como alias.
7. **Duplicados** (código importado y nacional, variantes de grafía): se fusionan, guardan todos los `sourceRecordIds` y se reporta si sus años difieren.
8. **IDs retirados:** se calculan contra la edición anterior (`--previous`), con reemplazos revisados.
9. **Integridad y licencia:** se verifican al final. Si no se cumplen, sale solo el reporte.

**Reporte:**
- totales;
- cobertura por categoría;
- % con años, cilindrada y combustible;
- GNC y diésel;
- conflictos y discontinuados;
- cuarentena con motivo y candidatos;
- rechazos y avisos;
- variantes y alias propuestos;
- nombres registrales;
- familias candidatas;
- duplicados;
- diff entre ediciones.

## 5. Ejemplo con fixtures sintéticos

El CSV sintético tiene 32 filas de marcas ficticias. `npm run catalog:ingest -- --input …/synthetic-registry.csv --config scripts/vehicle-catalog/synthetic-source.example.json --out <dir>` produjo:

```
Filas 32 · aceptadas 26 · duplicadas fusionadas 4 · cuarentena 4 · rechazadas 2
Marcas 5 · modelos 13 · versiones 22
Auto 6 modelos / 13 versiones · Moto 2/2 · Pick-up 1/2 · SUV 1/1 · Utilitario 1/2 · Camión 1/1 · Otro 1/1
Con años 95 % · con cilindrada 73 % · con combustible 23 % (diésel 3, GNC 1) · conflictos 1 · discontinuados 6
Cuarentena: r009 RURAL (auto|suv) · r014 "2015/16" · r017 sin carrocería · r018 carrocería desconocida
Rechazadas: r016 sin marca · r019 clase "X"
Variantes: Ficticia Autos ← FICTICIA AUTOMOTORES / FICTICIA AUTOS / FICTICIA-AUTOS
Alias propuesto (no fusionado): Demo Utilitarios Trucks ~ Demo Utilitarios
Familias candidatas: LINEA TREND; LINEA POWER
```

**Con la misma configuración pero licencia `pending`:**
- sale "Solo reporte: la fuente no es distribuible";
- se escriben solo `report.json` y `report.md`, sin `dataset.json`.

## 6. Calidad e integridad

`checkCatalogIntegrity` detecta:
- **esquema:** errores de esquema;
- **licencia:** licencia no distribuible, `authorized` sin referencia, fixture con licencia distinta de `synthetic`;
- **hash** alterado;
- **IDs y nombres duplicados:** IDs duplicados por nivel, **marcas repetidas** con otro ID o con alias que chocan, modelos con nombre o alias repetido dentro de la marca, **versiones duplicadas** (misma etiqueta y carrocería);
- **referencias inexistentes:** modelo sin marca, versión sin modelo, tipo inexistente;
- **relaciones inconsistentes:** modelo en un tipo no listado para su marca, **años de versión fuera de los del modelo**, años de versión con modelo sin años;
- **campos y motor:** `missing` inconsistente, motor vacío en vez de `null`;
- **IDs retirados:** retirados que siguen vivos, reemplazos inexistentes o de otro nivel.

Ante cualquier problema, el proveedor responde `INVALID_DATA` y la UI ofrece el modo manual.

## 7. Seguridad y rendimiento

- **Límite por cliente** en `/api/vehicle-catalog`:
  - 120 por minuto por defecto (`VEHICLE_CATALOG_RATE_PER_MINUTE`);
  - usa la IP hasheada y el store compartido si existe, con respaldo en memoria;
  - responde 429 con `Retry-After` y `manualFallback`;
  - se evalúa antes de parsear.
- **El navegador evita consultas repetidas:** caché de sesión por consulta (hasta 200 entradas, solo en memoria y sin almacenamiento del navegador), con requests compartidos en vuelo. Los fallos no se cachean. Volver a una marca anterior no repite la consulta (probado).
- **El 429 tiene mensaje propio,** sin "Reintentar", para no generar un bucle, y con salida manual.
- **Sin descarga del catálogo completo:** un nivel por request. La procedencia se quita de cada respuesta. El bundle cliente no contiene datos del fixture, procedencia, nombres de variables ni código de ingesta (verificado en `.next/static`).
- **Caché en el CDN:** `s-maxage=3600`. Los datos locales se leen y verifican una vez por proceso. No hace falta caché del lado del servidor mientras sean datos estáticos.
- **Flag:** sigue apagado por defecto, y el fixture **nunca** se sirve con `VERCEL_ENV=production`. No hay fuente real configurable todavía (`VEHICLE_CATALOG_SOURCE` solo acepta `fixture`).

## 8. Tests

**Lo que se escribió junto con el código en 7D.2:**
- Los cambios de nivel (de `catalog_*` a `identity_*`) se hicieron actualizando primero el dominio y después las expectativas de los tests existentes de 7D.1.
- Los tests nuevos se escribieron junto con el código; los de ingesta y de integridad pasaron en la primera corrida.
- El ciclo RED → GREEN estricto quedó documentado en 7D.1.

| Suite nueva o ampliada | Tests |
|---|---|
| `catalog-dataset.test.ts` (DS-01..04: integridad, licencias, hash, diff y retirados) | 21 |
| `ingest/ingest.test.ts` (IN-01..04: entrada local, normalización, ingesta sintética, licencia `pending`, nueva edición con IDs retirados y migración) | 18 |
| `vehicle-catalog.test.ts` VC-07 (cinco niveles, migración, edición vieja, declarado manual) | 8 |
| `vehicle-catalog/route.test.ts` RT-7D2 (429, procedencia quitada, sin "compatible") | 3 |
| `vehicle-selector.test.tsx` VS-07 (caché de sesión, sin re-request, 429) | 3 |
| `diagnosis-prompt.test.ts` DP-7D2 (texto por nivel y "no certifica la compatibilidad") | 4 |

| Regresión | Resultado |
|---|---|
| Vitest | **1792/1792** (76 archivos; 7D.1: 1735) |
| Playwright producción (copia aislada, CI) | **112/112** |
| Playwright desarrollo | **3/3** |
| TypeScript | OK |
| ESLint | OK (solo el warning habitual de fuentes en `layout.tsx`) |
| Build | OK |

**Llamadas externas:** ninguna a LLM ni SerpApi (stub y proveedor `none`).

## 9. Riesgos

1. **Permiso de la DNRPA sin resolver.** Bloquea cualquier dataset real. La herramienta ya impide distribuir una fuente `pending`.
2. **Conversión PDF → CSV:** no está implementada en el repo y depende de una persona. En 7D.1, el 21 % de las filas tenían descripciones en dos líneas.
3. **Las heurísticas de categoría y familia necesitan revisión humana.** RURAL, MINIBUS y combinaciones van a cuarentena; las familias de varias palabras se proponen pero no se aplican solas. En una fuente real, la cuarentena puede ser grande.
4. **Nombres registrales:** la herramienta solo propone; el nombre comercial lo tiene que cargar alguien.
5. **Motos y camiones:** casi nunca tienen cilindrada en formato "x.x". La cilindrada en cc ("150") no se interpreta, a propósito, para no confundirla con un nombre.
6. **"Discontinuado"** es una heurística (sin 0 km y último año menor al anterior al de publicación). Puede equivocarse con modelos vigentes que la fuente no lista.
7. **Límite por cliente:** si no hay store compartido, es por instancia. Una IP compartida (NAT) puede llegar al límite; hay fallback manual.
8. **Prompt v2.3.0** sin evaluar con el modelo real.

## 10. GO / NO-GO para conectar una fuente real autorizada

**GO técnico.** La infraestructura está lista para recibir una fuente con permiso:
- formato versionado con procedencia y licencia;
- ingesta offline con cuarentena y reportes;
- integridad y hash al cargar;
- IDs estables con retiro y migración;
- límite por cliente;
- niveles de identificación calculados en el servidor;
- flag apagado.

**NO-GO para conectar la DNRPA hoy.** Falta la condición previa: **permiso de reutilización escrito** (o licencia explícita) con una referencia que se pueda poner en `license.reference`.

**Con el permiso, el orden propuesto (7D.3) es:**
1. Convertir localmente el PDF autorizado a CSV.
2. Pasar la ingesta en modo `pending` para obtener solo el reporte de calidad.
3. Revisar la cuarentena y los overrides.
4. Pasar la ingesta con `authorized` y su referencia.
5. Revisar el diff.
6. Incluir el dataset en un cambio separado.
7. Habilitar `VEHICLE_CATALOG_SOURCE` para esa fuente, solo en un preview protegido.
