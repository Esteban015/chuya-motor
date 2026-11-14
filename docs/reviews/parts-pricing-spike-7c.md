# Spike 7C — Búsqueda automática de precios de repuestos en Argentina

Rama `feature/automatic-parts-pricing` (desde `origin/master` df91b65). Fecha: 2026-11-14.
Sin llamadas reales a proveedores (no hay credenciales en el entorno y no hubo autorización de
consumo). Todas las pruebas usan respuestas **sintéticas** con la forma documentada de cada API.

## 1. Matriz comparativa

| Criterio | Mercado Libre API (MLA) | SerpApi — Google Shopping | DataForSEO — Google Shopping | Google Custom Search JSON |
|---|---|---|---|---|
| Tipo de acceso | API oficial del marketplace (primera parte) | Intermediario que obtiene resultados de Google | Intermediario que obtiene resultados de Google | API oficial de Google |
| Búsqueda por texto en Argentina | `GET /sites/MLA/search?q=` documentado con token Bearer. **Estado incierto**: reportes de 403 en búsqueda por palabra clave desde 2025 (ver §2) | `engine=google_shopping`, `gl=ar`, `google_domain=google.com.ar`. Argentina figura entre los países con Shopping de Google | Ubicaciones por `location_code`; Argentina no confirmada en la doc consultada | Cerrada a clientes nuevos; se discontinúa el 1/1/2027 |
| Precio / moneda | `price` numérico + `currency_id` explícito (ARS/USD) | `price` como texto ("$ 25.000,00") + `extracted_price` float; **sin campo de moneda** | Precio por producto (moneda según ubicación; no verificado para AR) | No es de compras |
| URL / comercio | `permalink` del aviso, vendedor (`seller`) | `product_link` (página de Google Shopping), `source` (comercio) | URL y vendedor | — |
| Estado (nuevo/usado) | `condition` | No documentado en el ejemplo (`second_hand_condition` no aparece) | No verificado | — |
| Marca / código / compatibilidad | Atributos (`BRAND`, `PART_NUMBER`…) y API de **compatibilidades de autopartes** (vehículo, marca, modelo, año) | Solo título | Solo título y especificaciones parciales | — |
| Autenticación | App registrada + OAuth (token del servidor) | `api_key` | Login + password (Basic) | — |
| Costo | Sin costo por llamada (cuotas no publicadas) | Free 250/mes; Starter USD 25 (1.000); Developer USD 75 (5.000); Production USD 150 (15.000) | USD 0,001 por SERP (cola estándar, hasta 45 min) / USD 0,002 (prioridad, hasta 1 min) | USD 5 / 1.000 (solo clientes existentes) |
| Latencia | Síncrona (no medida) | Síncrona (no medida) | **Asíncrona**: tarea + recuperación, hasta 1 min en prioridad | — |
| Restricciones contractuales | Términos de desarrolladores: uso para facilitar/mejorar servicios a usuarios; copias mínimas; seguridad de los datos; el acceso puede revocarse. Texto completo no accesible para lectura automática (403) → revisión manual | Google no licencia consultas automatizadas; SerpApi ofrece "U.S. Legal Shield" solo desde el plan Production (USD 150/mes) | Mismo origen (resultados de Google) | — |
| Viabilidad MVP público | **La mejor si el acceso se confirma** | Técnicamente viable; riesgo legal y de calidad de datos (moneda, condición) | Baja para flujo interactivo (latencia asíncrona) | No (cerrada) |

## 2. Evidencia

- Mercado Libre — documentación de ítems y búsquedas lista `/sites/$SITE_ID/search` con token Bearer: [Items & Searches](https://developers.mercadolivre.com.br/en_us/items-and-searches), [Ítems y Búsquedas (AR)](https://developers.mercadolibre.com.ar/es_ar/items-y-busquedas).
- Mercado Libre — reportes de 403 en la búsqueda pública (no oficiales): [Reclame Aqui (MLB)](https://www.reclameaqui.com.br/mercado-livre/erro-403-forbidden-no-endpoint-de-busca-publica-de-anuncios-da-api-do-mercado-livre_kl_Q1h2_x_sPnREJ/), [Reclame Aqui 2](https://www.reclameaqui.com.br/mercado-livre/acesso-bloqueado-ao-endpoint-sitesmlbsearch-da-api-mercado-livre-impede-lancamento-de-solucao_3CA2vqN4_-2dk8tS/), [MCP connector guide](https://anythingmcp.com/guides/connect-mercado-libre-to-muse), [mercadolibre-mcp README](https://glama.ai/mcp/servers/@lumile/mercadolibre-mcp/blob/af6ee3e6cf55c33745041d8b42cdb82f201bcabf/README.md). Página oficial de errores 403: [Error 403](https://developers.mercadolibre.com.ar/error-403). **No se encontró un anuncio oficial**; las páginas de developers de Mercado Libre bloquearon la lectura automática (HTTP 403), por lo que la confirmación requiere una app registrada.
- Mercado Libre — compatibilidades de autopartes (marca, modelo, año; disponible en MLA): [Compatibilidades entre ítems y productos](https://developers.mercadolibre.com.ar/compatibilidades-entre-items-y-productos), [Dominios y atributos para autopartes](https://developers.mercadolibre.com.ar/referencias-de-dominios-productos-y-atributos-para-autopartes).
- Mercado Libre — términos de desarrolladores: [Términos y Condiciones](https://developers.mercadolibre.com.ar/es-ar-terminos-y-condiciones) (resumen por búsqueda; lectura completa pendiente).
- SerpApi — parámetros y campos: [Google Shopping API](https://serpapi.com/google-shopping-api); planes y Legal Shield: [Pricing](https://serpapi.com/pricing).
- Google Shopping en Argentina (ARS): [Merchant Center — idiomas y monedas](https://support.google.com/merchants/answer/160637).
- DataForSEO — precio y colas: [Google Shopping API pricing](https://dataforseo.com/pricing/merchant/google-shopping-api), [Ubicaciones](https://docs.dataforseo.com/v3/merchant/google/locations/).
- Google Custom Search JSON API — cierre: [Firecrawl](https://www.firecrawl.dev/blog/google-search-json-api-alternative), [Brave](https://brave.com/learn/google-api-shutdown/).

## 3. Arquitectura implementada (spike, sin ruta ni UI)

```
src/server/parts-pricing/            (solo servidor; falla si se importa en el navegador)
  types.ts             PriceQuery, PriceOffer (ARS en centavos, URL, comercio, estado, fecha), ProviderResult
  query.ts             consulta solo con datos identificatorios (reusa los sanitizadores 7B)
  provider-utils.ts    timeout, mapeo de errores HTTP, centavos, URLs https con host permitido
  mercadolibre-provider.ts   GET fijo api.mercadolibre.com/sites/MLA/search (token Bearer del servidor)
  serpapi-provider.ts        GET fijo serpapi.com/search.json (engine=google_shopping, gl=ar)
  matching.ts          evaluación determinística: candidate / needs_review / discard
  pricing-service.ts   orquestador: solo repuestos, filtro de seguridad 7B, límites, caché, fallback
  provider-registry.ts opt-in explícito: PARTS_PRICING_PROVIDER + credencial; por defecto ninguno
benchmark/smoke/parts-pricing-probe.ts   validación real opt-in (bloqueada por defecto)
```

Garantías: hosts y rutas fijos (sin URLs arbitrarias); claves solo en variables del servidor; sin
LLM en el camino de precios (no puede inventar precios, fuentes ni enlaces); la mano de obra nunca
se busca; cada descripción pasa el filtro de seguridad 7B antes de salir del servidor; si el
proveedor falla, el resultado es un estado y el flujo manual 7B sigue igual.

## 4. Resultados de las pruebas técnicas (sintéticas)

`src/server/parts-pricing/parts-pricing.test.ts`: 33 tests. Cubren consulta sin datos personales,
host/ruta/parámetros fijos, token y clave fuera de la respuesta, mapeo de ofertas, descarte de USD,
URLs maliciosas y hosts ajenos, errores 401/403/429/500, timeout, JSON malformado, sin resultados,
matching (tipo de pieza, posición, motor, años, estado, código, presentación), los cinco casos
controlados, límites, caché, aislamiento cliente/servidor y opt-in.

**No hay mediciones reales** de cobertura, latencia ni calidad de resultados. Propuesta de
validación de bajo consumo (requiere tu autorización y credenciales):

1. Mercado Libre (sin costo): registrar una app en developers.mercadolibre.com.ar, obtener un token
   y correr `PARTS_PRICING_REAL_AUTHORIZED=true PARTS_PRICING_PROVIDER=mercadolibre npx tsx benchmark/smoke/parts-pricing-probe.ts`
   → 5 llamadas. Primera pregunta a responder: ¿`/sites/MLA/search` devuelve 200 o 403?
2. SerpApi (plan Free, sin tarjeta): mismo script con `PARTS_PRICING_PROVIDER=serpapi` → 5 de las
   250 búsquedas mensuales gratuitas.

## 5. Costos estimados

Supuestos: 1 "consulta" = 1 lista o presupuesto con **3 repuestos en promedio** → 3 llamadas al
proveedor; sin caché (peor caso) y con 30 % de aciertos de caché (supuesto, no medido). Precios en
USD de las páginas oficiales citadas (noviembre 2026), sin impuestos.

| Proveedor | 100 consultas/mes (300 llamadas; ~210 con caché) | 1.000 consultas/mes (3.000; ~2.100 con caché) |
|---|---|---|
| Mercado Libre | USD 0 (cuotas no publicadas) | USD 0 (cuotas no publicadas) |
| SerpApi | Starter USD 25/mes (con caché entra en Free 250) | Developer USD 75/mes (5.000) · con Legal Shield: Production USD 150/mes |
| DataForSEO (prioridad) | ≈ USD 0,60 (0,42 con caché) | ≈ USD 6 (4,20 con caché) · depósito mínimo no verificado |

SerpApi cobra por plan mensual (no hay pago por uso); las búsquedas en caché de SerpApi no se cuentan.

## 6. Riesgos de compatibilidad

- Los títulos de los avisos mezclan modelos y motores ("Palio Siena 1.4 1.6 1.8"); un título no
  prueba compatibilidad. Por eso el matching nunca marca "compatible": como máximo "candidato".
- Variantes reales de una misma pieza (con/sin sensor, ventiladas, eje) no siempre figuran en el
  título → la diferencia aritmética solo se calcula sin preguntar cuando coincide el **código de
  pieza** con el del presupuesto; en otro caso la persona confirma (flujo 7B).
- Google Shopping no informa estado (nuevo/usado) ni moneda explícita → "estado desconocido" y solo
  precios en formato de pesos.
- Precios publicados cambian rápido (inflación): cada oferta lleva fecha y hora de consulta; caché de
  6 h como máximo.

## 7. Recomendación

**NO-GO para activar precios automáticos en el MVP público hoy.** Motivos: no hay evidencia real de
acceso (Mercado Libre podría devolver 403), no hay credenciales, y la alternativa técnica inmediata
(SerpApi) depende de resultados de Google sin licencia directa y no informa moneda ni estado.

**GO para el siguiente paso de validación**, en este orden:
1. Validar Mercado Libre con una app registrada (gratis, 5 llamadas). Si responde 200 con resultados
   útiles para los casos A–E → GO para un piloto acotado solo con Mercado Libre.
2. Si Mercado Libre no da acceso: evaluar SerpApi solo tras revisión legal y con presupuesto
   aprobado (plan con Legal Shield si se usa en producción).
3. DataForSEO solo para procesos por lotes (no interactivo). Google Custom Search: descartado.

## 8. Plan mínimo de implementación (si la validación da GO)

1. Ruta `POST /api/parts-pricing` (servidor): mismo rate limit por IP que `/api/analyze`, cuota
   diaria propia de llamadas al proveedor, `PRICING_LIMITS` (5 repuestos, 1 llamada por repuesto,
   timeout 4 s), sin datos personales en logs.
2. Reutilizar `createPricingService` con el proveedor elegido; caché distribuida (Upstash, ya
   integrado) en lugar de memoria.
3. UI 7B: botón "Buscar precios automáticamente" por lista; mostrar ofertas con
   "Publicado en {comercio} · consultado {fecha}", estado de coincidencia y motivo; las ofertas
   "candidato" entran como referencia **no verificada** (la persona confirma) y las coincidencias por
   código se comparan rotuladas como tales. Mano de obra excluida.
4. Kill switch por variable de entorno; sin proveedor el flujo 7B queda igual.
5. Revisión legal de términos (Mercado Libre / proveedor elegido) antes de exhibir datos.

## 9. Actualización 14/11/2026: pruebas reales con SerpApi e integración mínima con feature flag

### 9.1 Pruebas reales (con autorización, 6 búsquedas en total)
- Primera corrida de 5 casos: A, B, C y E dieron "sin resultados" y D dio `bad_response`. Las causas fueron:
  el timeout cortando la lectura del cuerpo, errores de SerpApi con HTTP 200 que se ocultaban como
  "sin resultados", precios en formato es-419 y un diagnóstico insuficiente. Todo quedó corregido con tests RED→GREEN.
- Corrida del caso B: HTTP 200, 40 resultados, 5 conservados. Ninguna oferta fue comparable (clase A).
  La auditoría offline corrigió los rangos abiertos de años, los títulos de otros vehículos, las
  publicaciones multivehículo, el precio "ahora" y la evaluación de los 40 resultados.

### 9.2 Arquitectura final (apagada por defecto)
- `POST /api/budget/parts-prices`: ruta delgada sobre `src/server/parts-pricing/route-handler.ts`.
  1. Flag del servidor `PARTS_PRICING_ENABLED=true`, comparado literalmente. Si está apagado, responde 404.
  2. Content-Type JSON, un cuerpo de hasta 8 KB y un esquema Zod `.strict()` que rechaza flags, proveedor, URL o
     claves enviados por el cliente.
  3. Rate limit por cliente (IP hasheada), con store compartido y respaldo local.
  4. Proveedor seleccionado solo desde el entorno del servidor; sin credencial, responde `disabled`.
  5. Identificación de repuestos en el servidor: mano de obra y otros conceptos nunca se buscan. Pasa el filtro
     de seguridad del 7B sin cambios.
  6. Caché por proceso y caché compartida (Upstash, 6 h, clave con hash), con deduplicación de búsquedas
     concurrentes.
  7. Presupuesto por búsqueda facturada: el máximo diario por cliente, el diario global y el mensual
     global, con devolución si falla uno posterior. En producción sin store distribuido no se llama al proveedor.
  8. La respuesta al cliente solo incluye ofertas validadas, la decisión y los datos faltantes. Nunca
     incluye la key, el diagnóstico, URLs de consulta, diferencias, promedios ni veredictos.
- UI: `AutoPricingPanel` dentro de Presupuestos 2.0, solo si el servidor activó el flag (`page.tsx` lo
  lee en cada request).
  - La búsqueda corre únicamente con un clic, sin repetir la misma búsqueda.
  - Muestra hasta 5 publicaciones por repuesto con la etiqueta "Compatibilidad no verificada" y los datos
    faltantes.
  - Los links se aceptan solo en hosts de Google.
  - La búsqueda manual del 7B sigue como respaldo.
  - No envía nada a Analytics.

### 9.3 Variables
| Variable | Por defecto | Uso |
|---|---|---|
| `PARTS_PRICING_ENABLED` | apagado | Solo `true` activa la ruta y la UI |
| `PARTS_PRICING_PROVIDER` | — | `serpapi` (o `mercadolibre`) |
| `SERPAPI_API_KEY` | — | Solo en el servidor |
| `PARTS_PRICING_CLIENT_REQUESTS_PER_HOUR` | 5 | Pedidos por cliente por hora |
| `PARTS_PRICING_CLIENT_DAILY_SEARCHES` | 10 | Búsquedas facturadas por cliente por día UTC |
| `PARTS_PRICING_DAILY_SEARCH_BUDGET` | 20 | Búsquedas facturadas por día UTC (global) |
| `PARTS_PRICING_MONTHLY_SEARCH_BUDGET` | 200 | Búsquedas facturadas por mes UTC (global; plan Free = 250) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Store y caché compartidos (obligatorios en producción) |

Máximo teórico con los valores por defecto: 200 búsquedas/mes, es decir US$0 en el plan Free de SerpApi.
