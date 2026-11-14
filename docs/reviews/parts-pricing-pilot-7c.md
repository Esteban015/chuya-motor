# Incremento 7C — Runbook del piloto interno de precios automáticos

Fecha: 14/11/2026 · Rama: `feature/automatic-parts-pricing` · Estado: **listo para piloto interno; no habilitado en ningún entorno**.

> Este documento no contiene claves, tokens ni URLs con credenciales. Solo nombres de variables.

## 1. Qué se activa y qué no

- Se activa: el botón **Buscar publicaciones (beta)** en Presupuestos 2.0 y la ruta `POST /api/budget/parts-prices`.
- No cambia nada más: ni el Safety Gate, ni `/api/analyze`, ni la búsqueda manual ni las referencias propias del 7B.
- Barreras en el código:
  - Sin `PARTS_PRICING_ENABLED=true` en el servidor, la ruta responde 404 y la UI es idéntica a la del 7B.
  - **Dominio público:** en `VERCEL_ENV=production` el flag se ignora, salvo que también esté
    `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true`. Esa variable **no debe configurarse** para el piloto.
  - En `NODE_ENV=production` sin Upstash, la búsqueda falla cerrada: no se llama al proveedor.

## 2. Variables de entorno (solo nombres)

| Variable | Piloto local (`npm run dev`) | Piloto en preview protegido |
|---|---|---|
| `PARTS_PRICING_ENABLED` | `true` (solo en la sesión) | `true` (solo en el entorno *Preview*) |
| `PARTS_PRICING_PROVIDER` | `serpapi` | `serpapi` |
| `SERPAPI_API_KEY` | Ya está en `.env.local` | Secreto del entorno *Preview* (nunca `NEXT_PUBLIC_`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Recomendado (ya está en `.env.local`) | **Obligatorio** |
| `CLIENT_ID_SALT` | Recomendado | Recomendado (hoy falta) |
| `PARTS_PRICING_CLIENT_REQUESTS_PER_HOUR` | 5 por defecto | 5 por defecto |
| `PARTS_PRICING_CLIENT_DAILY_SEARCHES` | 10 por defecto | 10 por defecto |
| `PARTS_PRICING_DAILY_SEARCH_BUDGET` | Sugerido: `10` | Sugerido: `20` |
| `PARTS_PRICING_MONTHLY_SEARCH_BUDGET` | Sugerido: `50` | 200 por defecto (plan Free = 250) |
| `PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION` | **No configurar** | **No configurar** |
| `LLM_QUOTA_KEY_PREFIX` | Opcional: un prefijo propio separa los contadores del piloto de los de producción si se usa la misma base Upstash | Ídem |

Las cuotas cuentan **búsquedas facturadas**, es decir las que no salen de la caché. Una consulta con 3 repuestos son como mucho 3 búsquedas.

## 3. Recomendación: piloto local primero, después preview protegido

**Local (recomendado para empezar):**
- solo accesible desde la máquina (`localhost`);
- no se publica nada;
- se puede cortar en cualquier momento.

Pasos:
1. Preflight, sin red: `npx tsx benchmark/smoke/parts-pricing-preflight.ts`.
2. Opcional, contactando Upstash: `npx tsx benchmark/smoke/parts-pricing-preflight.ts --ping-upstash`.
3. Levantar con el flag **solo en la sesión** (sin tocar `.env.local`):
   `PARTS_PRICING_ENABLED=true PARTS_PRICING_DAILY_SEARCH_BUDGET=10 PARTS_PRICING_MONTHLY_SEARCH_BUDGET=50 npm run dev`
4. Abrir `http://localhost:3000/demo/presupuesto` y seguir la checklist (§5). Cada clic en "Buscar publicaciones" puede consumir hasta 3 búsquedas de SerpApi.

**Preview protegido de Vercel (después, si hace falta probar con más personas):**
1. Activar **Deployment Protection → Vercel Authentication** (o Password Protection) para *Preview Deployments*. Sin esto el preview queda público por URL: **no activar el flag**.
2. Cargar las variables del §2 solo en el entorno *Preview*, nunca en *Production*.
3. Desplegar la rama como preview. Este paso requiere tu autorización: no lo hice.
4. Correr el preflight con las mismas variables y seguir la checklist.
5. Al terminar: quitar `PARTS_PRICING_ENABLED` del entorno *Preview*, o rotar `SERPAPI_API_KEY`.

## 4. Verificaciones automáticas realizadas (sin red, sin SerpApi)

| Área | Cómo se verificó |
|---|---|
| Feature flag | Solo `true` literal; cuerpo, query o headers del cliente no lo activan; 404 si está apagado (`route-handler.test.ts` PP-01) |
| Dominio público | `VERCEL_ENV=production`: flag ignorado y ruta en 404 aunque haya key y proveedor (`pilot-readiness.test.ts` PR-01) |
| Proveedor y autenticación | 401/403/429/timeout/errores con HTTP 200 → `unavailable` con un motivo; la key solo viaja en la URL saliente hacia `serpapi.com` (PC-02/03/08, PP-03) |
| Rate limit | Por cliente (IP hasheada) → 429 sin llamar al proveedor (PP-05) |
| Cuotas atómicas distribuidas | 10 pedidos concurrentes desde 2 instancias con presupuesto 5 → exactamente 5 búsquedas (doble de Upstash con el mismo script Lua, PR-02) |
| Caché compartida | Instancia A busca, instancia B reutiliza sin búsqueda ni consumo de cuota; las claves están hasheadas y no contienen la consulta (PR-02) |
| Fallo seguro | Upstash caído o token inválido en producción → `store_unavailable` sin llamar al proveedor; la caché caída no bloquea (PR-03) |
| Secretos | Sin `console.*` en el servidor de precios; la respuesta no incluye diagnóstico, auditoría, key ni URL de SerpApi (PR-04); el bundle del navegador no tiene `serpapi.com`, `api_key` ni `PARTS_PRICING` |
| UX | E2E del recorrido Fiat Palio 2017 1.4 8v Evo con 3 repuestos más mano de obra, con ofertas sintéticas (PP-E2E-04/05) |

## 5. Checklist de verificación manual (piloto)

Vehículo: **Fiat Palio 2017, 1.4 8v Evo**. Pegar en "Comparar presupuesto":

```
Manguera de respiración de gases: 18000
Filtro de aire: 9000
Pastillas de freno delanteras: 40000
Mano de obra: 30000
```

- [ ] 0. El preflight dice "configuration checks passed", con proveedor `serpapi` y la key "present".
- [ ] 1. El panel "Publicaciones encontradas automáticamente (Beta)" lista **solo** los 3 repuestos, sin la mano de obra.
- [ ] 2. Antes del clic no hay pedidos a `/api/budget/parts-prices` (DevTools → Network).
- [ ] 3. Un clic dispara **un solo** POST; el botón pasa a "Búsqueda realizada" y queda deshabilitado.
- [ ] 4. Cada publicación muestra comercio, precio en ARS, fecha "Consultado: …", el enlace "Ver publicación" y la etiqueta **"Compatibilidad no verificada"**.
- [ ] 5. Cada publicación lista los datos faltantes (código, presentación, estado, año/motor, versión o posición según el caso).
- [ ] 6. No aparecen promedios, diferencias, "caro", "barato", "sobreprecio" ni "precio justo".
- [ ] 7. La sección "Mano de obra" dice que no se compara con referencias externas y no tiene opinión sobre el importe.
- [ ] 8. Los enlaces abren Google Shopping en otra pestaña (`google.com.ar`).
- [ ] 9. Recargar y repetir la misma consulta: debe salir de la caché, sin consumir búsquedas (se ve en el contador diario de Upstash, clave `…:pp:d:<día>`).
- [ ] 10. Mobile 320 y 390 px (DevTools): sin scroll horizontal, enlaces y botón dentro de la pantalla.
- [ ] 11. Respaldo: con `PARTS_PRICING_PROVIDER=none` el panel dice "no está disponible", la búsqueda manual sigue y no hay consumo.
- [ ] 12. Analytics: en Network, ningún pedido a `/_vercel/insights` contiene repuestos, precios ni vehículo.
- [ ] 13. Respuesta de la ruta (Network → Response): no contiene `api_key`, `serpapi.com/search`, `diagnostics` ni `audit`.
- [ ] 14. Las capturas del piloto no muestran DevTools con variables de entorno ni la key.

Registrar por oferta, fuera de la app: si el taller la confirma como equivalente (sí/no/no sabe) y por qué.

## 6. Auditoría de descartes (local)

Con autorización explícita, el script de prueba guarda en `reviews-local/parts-pricing/`, que está fuera de Git:
- cada resultado descartado, con su título y motivos concretos;
- los descartados por validación (precio, link, comercio);
- las pistas de **posible descarte erróneo**: solo difieren en la redacción del tipo de pieza, o el único motivo es motor, año, posición o vehículo;
- los títulos duplicados.

Para resumir un reporte sin red: `npx tsx benchmark/smoke/parts-pricing-audit-report.ts reviews-local/parts-pricing/<archivo>.json`.

Los reportes del 14/11 a las 17:47 y anteriores no tienen títulos descartados: se informan como "not captured" y no se reconstruye nada.

## 7. Límites de consumo

Con los valores por defecto el máximo es **200 búsquedas por mes** (plan Free de SerpApi = 250), 20 por día y 10 por visitante por día. Para el piloto local se sugieren 10 por día y 50 por mes. Ninguna búsqueda real se ejecuta sin un clic explícito en la UI, ni el script de prueba sin `PARTS_PRICING_REAL_AUTHORIZED=true`.
