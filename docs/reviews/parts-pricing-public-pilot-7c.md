# 7C — Habilitación controlada de la búsqueda automática de repuestos (piloto público)

Fecha: 15/11/2026 · Rama: `feature/parts-pricing-public-pilot` (desde `origin/master` f7e7310) · Sin commit, PR ni deploy. Production **no** activada.

> Este documento no contiene claves, tokens ni URLs con credenciales: solo nombres de variables.

## 1. Estado actual de configuración

| Elemento | Estado |
|---|---|
| Código 7C en master | Presente: ruta `POST /api/budget/parts-prices`, proveedor SerpApi (Google Shopping, `gl=ar`), matching conservador, caché por proceso + Upstash, rate limit por cliente, presupuesto de búsquedas, `AutoPricingPanel` |
| Flag | `PARTS_PRICING_ENABLED` solo acepta `true` literal; en `VERCEL_ENV=production` se ignora salvo `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true` |
| Proveedor | Solo con `PARTS_PRICING_PROVIDER=serpapi` + `SERPAPI_API_KEY` en el servidor |
| Store | Upstash obligatorio cuando `NODE_ENV=production` (Preview y Production en Vercel): sin él, ninguna búsqueda paga |
| Local (preflight sin red) | Key presente, Upstash configurado, `CLIENT_ID_SALT` presente, flag apagado |
| Vercel | No verificable desde acá (sin CLI ni proyecto vinculado). Ver §6 |
| 7D → 7C | La selección del catálogo llega como marca, modelo, año y motor (`cilindrada` + combustible solo si la versión lo documenta y es distintivo) |

## 2. Defectos encontrados

| # | Severidad | Defecto |
|---|---|---|
| D1 | **Alta** | El "máximo mensual" era un contador por **mes calendario UTC**, pero la cuota de SerpApi sigue el **ciclo de facturación** de la cuenta. Con 200/mes se podían gastar 200 a fin de un mes y 200 a principio del siguiente: **hasta 400 dentro de un mismo ciclo** (plan Free = 250). |
| D2 | Alta | Los contadores de presupuesto usaban el prefijo `LLM_QUOTA_KEY_PREFIX`, y el runbook 7C recomendaba **separarlo por entorno**. Con la misma API key de SerpApi, Preview y Production tendrían presupuestos independientes que, sumados, superan la cuota real. |
| D3 | Media | El script de prueba real (`parts-pricing-probe.ts`) buscaba **sin pasar por el presupuesto**: su consumo no se contaba. |
| D4 | Media | La reserva de presupuesto eran **tres operaciones atómicas separadas** con compensación. No podía superar los límites, pero: un error de Upstash a mitad dejaba contadores cobrados de más; dos pedidos concurrentes cerca del límite podían rechazarse mutuamente. |
| D5 | Media | Sin **tope horario**: el plan Free garantiza 50 búsquedas/hora. |
| D6 | Media | **Apagado no inmediato**: en Vercel, cambiar `PARTS_PRICING_ENABLED` requiere un nuevo deployment. |
| D7 | Media (privacidad) | Los campos del vehículo escritos a mano (`No encuentro mi vehículo`) **no filtraban patentes en mayúsculas ni teléfonos**: "1.2 16v AB123CD" llegaba a la consulta de SerpApi. La descripción ya los filtraba. |
| D8 | Baja | La protección del Preview no tenía forma de verificarse automáticamente. |
| D9 | Baja | (Revisión del PR) El kill switch se leía una sola vez antes del presupuesto y un error de lectura contaba como "apagado": un timeout puntual de Upstash seguido de una reserva exitosa dejaba pasar una búsqueda con el kill switch activado. |

Sin regresiones encontradas en flag, Content-Type/tamaño/esquema estricto, rate limit, fallback por error de SerpApi, exclusión de mano de obra, bundle del navegador, logs ni Analytics.

## 3. Correcciones

- **Presupuesto atómico** (`src/server/parts-pricing/search-budget.ts` + `QuotaStore.reserveAll`): **una sola operación** (un script Lua en Upstash) comprueba y cobra todos los límites, o no cobra nada:
  - por cliente (IP hasheada) por día UTC;
  - por cuenta por hora UTC (nuevo, `PARTS_PRICING_HOURLY_SEARCH_BUDGET`, 40 por defecto);
  - por cuenta por día UTC;
  - por cuenta en **cualquier ventana móvil de 31 días** (`PARTS_PRICING_MONTHLY_SEARCH_BUDGET`, 200): todo ciclo de facturación (≤ 31 días) cae dentro de una ventana, así que nunca ve más de 200.
- **Contadores por cuenta de SerpApi**: clave `chuya-pp:b:serpapi:<16 hex de SHA-256 de la key>:…`, independiente de `LLM_QUOTA_KEY_PREFIX`. Todo entorno que use la misma key y la misma base Upstash comparte un único presupuesto. La key nunca aparece en la clave.
- **Probe con presupuesto**: cobra del mismo presupuesto y no busca sin Upstash.
- **Kill switch sin redeploy**: bandera `chuya-pp:b:kill` en Upstash, leída en cada pedido → la ruta responde `disabled` y no busca. Además se vuelve a comprobar **dentro de la misma operación atómica** que reserva cada búsqueda paga (D9): con la bandera puesta, ninguna búsqueda sale aunque la lectura previa falle. Script `benchmark/smoke/parts-pricing-kill-switch.ts status | on --confirm | off --confirm`.
- **Privacidad del vehículo** (`part-search.ts`, también mejora la búsqueda manual 7B): patentes (ambos formatos) y teléfonos se eliminan de marca y motor; en modelo solo patentes Mercosur, para no romper modelos como CBR600 o XRE300. Los códigos de pieza no se filtran (pueden parecer patentes).
- **Preflight**: muestra tope horario y ventana, avisa si el horario supera 50/h, informa el estado del kill switch (`--ping-upstash`) y verifica la protección del deployment sin credenciales (`--check-protection <url>`: dos pedidos anónimos que no pueden disparar una búsqueda).
- Runbook 7C corregido (prefijo y nueva variable).

No se modificó: Safety Gate, `/api/analyze`, LLM guard, UI de precios, catálogo 7D, `.env.local`, stash 6.5.

## 4. Pruebas

| Suite | Resultado |
|---|---|
| Vitest | 1878/1878 (81 archivos; +26 nuevos) |
| Playwright producción (copia aislada, build como CI) | 118/118 (+1: VSE-13 7D → 7C) |
| Playwright desarrollo | 3/3 |
| TypeScript / ESLint / build | OK (solo la advertencia habitual de fuentes) |
| Bundle del navegador | 0 coincidencias de `serpapi.com`, `SERPAPI`, `api_key`, `UPSTASH`, `KV_REST`, `PARTS_PRICING`, `chuya-pp` |

Cobertura pedida (sin SerpApi real, doble de Upstash en memoria con los mismos scripts):

- Flag apagado → 404; Preview habilitado → busca; Production bloqueada por defecto aunque haya flag + key (PP-01, PR-01, preflight simulado).
- Concurrencia: 40 pedidos × 5 repuestos desde 4 instancias con ventana 7 → **exactamente 7** búsquedas (SB-05); 10 pedidos / 2 instancias / diario 5 → 5 (PR-02).
- Ventana móvil: presupuesto lleno el 31/01 sigue bloqueando el 01/02; 93 días simulados: ninguna ventana de 31 días supera el presupuesto (SB-02).
- Horario, diario y por cliente (SB-03). Presupuesto compartido entre prefijos distintos con la misma key (SB-04).
- Cuota agotada a mitad de un pedido de 4 repuestos: se buscan exactamente los que entran; la mano de obra no se busca ni se cobra (SB-05).
- Caída de Upstash: sin búsqueda y sin cobro parcial (SB-05, PR-03). Error de SerpApi → `unavailable` + búsqueda manual (PC/PP, E2E). Caché compartida entre instancias (PR-02).
- Kill switch on/off (SB-06). Probe con presupuesto (SB-06).
- 7D → 7C (VI-01/02, VSE-13): Hilux 2.8 TDI → `Toyota Hilux 2.8 diesel 2020`; Palio FIRE (combustible no documentado) → `Fiat Palio 1.4 2017`, sin "nafta"; versión sin motor, "No sé el año", "No conozco el motor", solo tipo, solo marca, carga manual.
- 1 a 5 repuestos, mobile 320/390, UI pública (precio ARS, publicación, comercio, fecha, enlace, "Compatibilidad no verificada", datos faltantes desplegables, búsqueda manual): suites 7C existentes, verdes.

## 5. SerpApi: plan gratuito y condiciones

**Confirmado (documentación oficial, 15/11/2026):**
- Plan Free: **250 búsquedas/mes**, throughput **50/hora** ([pricing](https://serpapi.com/pricing)).
- "Only successful searches are counted": las fallidas no se cobran ([pricing](https://serpapi.com/pricing)).
- Búsquedas idénticas dentro de 1 hora salen de la caché de SerpApi y **no se cobran** (Google Shopping API, `no_cache`); la integración no usa `no_cache` ([Google Shopping API](https://serpapi.com/google-shopping-api)).
- La cuota se renueva con el **ciclo de facturación**, no con el mes calendario ([pricing](https://serpapi.com/pricing)) → motivo de D1.
- Términos ([legal](https://serpapi.com/legal)): prohíben revender o explotar el servicio sin permiso escrito; el **U.S. Legal Shield no cubre** Free, Starter ni Developer, y en los planes que lo incluyen cubre la obtención de datos, no su uso posterior.

**Pendiente / no confirmado:**
- La página oficial no dice explícitamente si el plan Free admite uso público o comercial (una fuente secundaria indica que la leyenda "No Commercial Use" se quitó en 2022; no es la fuente oficial).
- Ni la documentación ni los términos exigen atribución al mostrar resultados. Las condiciones de Google sobre mostrar resultados de Google Shopping obtenidos por terceros siguen siendo una revisión legal pendiente (ya señalada en el spike 7C).
- Contratar Production **no es obligatorio** técnicamente; la diferencia relevante es el Legal Shield. Es una decisión de negocio/legal tuya.

Las cifras se tomaron de la documentación pública y pueden cambiar: verificar en la cuenta antes de activar.

### Auditoría del kill switch

| Aspecto | Resultado |
|---|---|
| Autenticación | No hay endpoint HTTP: solo quien tiene las credenciales Upstash (variables del servidor o la sesión del operador) puede leerla o cambiarla. El script exige `--confirm`, se bloquea en CI y no imprime secretos. |
| Estado por defecto | Apagado (la clave no existe). Sin TTL: queda puesta hasta `off --confirm`. |
| Aislamiento | Clave fija `chuya-pp:b:kill`, independiente de `LLM_QUOTA_KEY_PREFIX` y distinta del kill switch del LLM (`<prefijo>:llm:kill`): no apaga el análisis ni viceversa. Es **por base Upstash**: con la misma base en Preview y Production, apaga ambos (es lo buscado: el presupuesto es uno solo). |
| Errores | Upstash caído → la lectura previa no responde "disabled", pero la reserva atómica falla cerrada (`store_unavailable`, sin búsqueda). Bandera puesta y lectura previa fallida → la reserva la ve y rechaza. Test SB-06. |

## 6. Variables de Vercel (solo nombres)

| Variable | Preview | Production (solo al activar públicamente) |
|---|---|---|
| `PARTS_PRICING_ENABLED` | `true` | `true` |
| `PARTS_PRICING_PROVIDER` | `serpapi` | `serpapi` |
| `SERPAPI_API_KEY` | secreto (Sensitive), nunca `NEXT_PUBLIC_` | secreto |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_URL` + `KV_REST_API_TOKEN`) | obligatorio, misma base que Production | obligatorio |
| `CLIENT_ID_SALT` | recomendado | recomendado |
| `PARTS_PRICING_HOURLY_SEARCH_BUDGET` / `_DAILY_` / `_MONTHLY_` / `PARTS_PRICING_CLIENT_*` | opcionales (defaults 40 / 20 / 200; 5 pedidos/h y 10 búsquedas/día por cliente) | ídem |
| `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION` | **no configurar** | **no configurar** hasta la decisión de activación (§8) |

Nombres de Upstash que reconoce el código (`protection-config.ts`): `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, o los de la integración de Vercel Marketplace `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Reglas:
- Cargar **un solo par**. URL y token se eligen por separado (el `UPSTASH_*` tiene prioridad), así que mezclar pares de bases distintas produce errores de autenticación → sin búsquedas.
- `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` y `REDIS_URL` **no** se usan (el token de solo lectura haría fallar toda reserva).
- `LLM_QUOTA_STORE=upstash` recomendado en Preview y Production: si falta la URL o el token, la configuración queda inválida y el preflight lo marca, en vez de caer en silencio a memoria. En ambos casos no hay búsquedas pagas: con `NODE_ENV=production` la ruta exige un store distribuido.
- `LLM_QUOTA_KEY_PREFIX` puede seguir distinto por entorno (`chuya-preview` / `chuya-prod`): separa rate limit por pedido y caché, **no** el presupuesto ni el kill switch.

**Presupuesto compartido — cuándo sí y cuándo no:**

| Preview vs Production | Contadores |
|---|---|
| Misma key SerpApi + misma base Upstash | **Uno solo** (clave por huella de la key, sin prefijo de entorno) ✔ |
| Misma key + bases distintas | Dos presupuestos independientes que suman hasta 400 contra 250 reales ✘ no hacerlo |
| Keys distintas (cuentas distintas) + cualquier base | Uno por cuenta: correcto, cada cuenta tiene su propia cuota |
| Key rotada en la misma cuenta | Contadores nuevos desde cero: bajar los presupuestos hasta que termine el ciclo |

## 7. Procedimiento de Preview protegido

1. Vercel → Settings → Deployment Protection: **Vercel Authentication** (o Password Protection) para Preview. Sin esto, no activar el flag.
2. Cargar las variables del §6 solo en el entorno *Preview* (idealmente limitadas a la rama `feature/parts-pricing-public-pilot`).
3. Desplegar la rama como Preview (requiere tu revisión; no lo hice).
4. Verificar protección sin credenciales:
   `npx tsx benchmark/smoke/parts-pricing-preflight.ts --check-protection https://<preview>.vercel.app` → debe decir "Deployment protected" (página y API con 401/403 o redirección a SSO).
5. Preflight con las mismas variables (sesión, sin tocar `.env.local`):
   `PARTS_PRICING_ENABLED=true PARTS_PRICING_PROVIDER=serpapi NODE_ENV=production VERCEL_ENV=preview npx tsx benchmark/smoke/parts-pricing-preflight.ts --ping-upstash` → "configuration checks passed" y "Kill switch is off".
6. Pruebas reales acotadas (autenticado en el Preview), **≤ 10 búsquedas**:
   | Paso | Consumo máx. |
   |---|---|
   | Palio 2017 1.4 (catálogo) + 3 repuestos + mano de obra → "Buscar publicaciones" | 3 |
   | Repetir igual (debe salir de caché) | 0 |
   | Hilux 2.8 TDI 2020 + 5 repuestos | 5 |
   | Vehículo incompleto (solo marca/modelo) + 1 repuesto | 1 |
   | Kill switch `on` → buscar (debe decir "no disponible") → `off` | 0 |
   Registrar por paso: búsquedas consumidas (contador `chuya-pp:b:…:d:<día>` o panel de SerpApi), ofertas, descartes y tiempos. Checklist de UI: runbook 7C §5.
7. Al terminar: kill switch `on` (apaga todo entorno que use esa base) o quitar `PARTS_PRICING_ENABLED` del Preview.

## 8. Activación pública (cuando decidas)

1. Cerrar los pendientes del §5 (uso público/comercial, condiciones de Google Shopping) y aceptar el riesgo sin Legal Shield o contratar un plan que lo incluya.
2. Resultados del Preview revisados (calidad de matching y consumo real).
3. En *Production*: variables del §6 + `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true`, redeploy. Si quedó el kill switch `on` del Preview: `status` y luego `off --confirm`.
4. Preflight con `VERCEL_ENV=production` → "Effective feature state: ENABLED" solo con la variable explícita.
5. Primeras 48 h: revisar el contador diario/ventana y el panel de SerpApi una vez por día.

## 9. Rollback inmediato

1. **Segundos, sin redeploy:** `npx tsx benchmark/smoke/parts-pricing-kill-switch.ts on --confirm` con las credenciales Upstash del entorno → la ruta responde "disabled"; la búsqueda manual sigue.
2. **Minutos:** quitar `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION` (o `PARTS_PRICING_ENABLED`) y redeploy → la ruta vuelve a 404 y el panel desaparece.
3. **Código:** Instant Rollback de Vercel al deployment anterior.
4. **Sospecha de filtración de la key:** rotarla en SerpApi (los contadores nuevos empiezan con la nueva huella: bajar temporalmente los presupuestos).

## 10. Consumo estimado y límites

- Un clic en "Buscar publicaciones" = como máximo 1 búsqueda por repuesto (máx. 5); la mano de obra no consume; la caché (6 h nuestra + 1 h de SerpApi) no consume.
- Límites por defecto: 5 clics/h y 10 búsquedas/día por visitante; 40/h, 20/día y **200 por cualquier ventana de 31 días** por cuenta → margen de 50 sobre el plan Free para pruebas manuales.
- Con consultas de ~3 repuestos y sin caché: ~6 consultas/día, ~66 por ventana. El tope diario de 20 agota la ventana en ≥ 10 días de uso máximo: con tráfico público real, el presupuesto se agotará; al agotarse, cada repuesto muestra "límite alcanzado" y la búsqueda manual.
- Peor caso de exceso: búsquedas concurrentes idénticas desde instancias distintas pueden cobrarse dos veces (contadas en nuestro presupuesto, así que no superan el límite).

## 11. GO / NO-GO

- **PR: GO** (tras tu revisión).
- **Preview protegido: GO condicionado** a que `--check-protection` confirme la protección y a usar la misma base Upstash que Production.
- **Production pública: NO-GO por ahora.** Técnicamente está lista y protegida. Faltan:
  1. resultados reales del Preview;
  2. definir uso público/comercial con el plan Free y las condiciones de Google Shopping (sin Legal Shield);
  3. tu decisión explícita para cargar `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true`.
