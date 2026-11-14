# Validación con usuarios — Piloto público (Incremento 7A)

> Este documento define **cómo** se recolecta y se presenta la evidencia de uso de Chuya Motor.
> No contiene resultados. Ninguna cifra de este documento es un dato real: los resultados se
> agregan sólo cuando existan, con la fecha de corte y la fuente.

## 1. Objetivo del piloto

Verificar, con personas reales y antes del hackatón, que:

1. la demo pública se visita y se usa (fuente: Vercel Web Analytics);
2. quienes la prueban pueden completar un análisis de falla o de presupuesto (fuente: formulario, autodeclarado);
3. el resultado les resulta útil y comprensible (fuente: formulario, autodeclarado);
4. existen mejoras concretas a priorizar (fuente: pregunta abierta del formulario).

No es un estudio estadístico ni una medición de precisión diagnóstica.

## 2. Período de recolección

| Campo | Valor |
|---|---|
| Inicio | _completar al habilitar Web Analytics y publicar el formulario (AAAA-MM-DD)_ |
| Fin / fecha de corte | _completar (AAAA-MM-DD, hora y zona horaria)_ |
| URL pública evaluada | _completar (dominio de producción de Vercel)_ |

Todo número que se presente debe citar este período. Las visitas previas a la habilitación de
Web Analytics no existen en el panel y no deben estimarse.

## 3. Fuentes y definiciones

### 3.1 Visita (Vercel Web Analytics)

- **Página vista (page view):** una carga de una ruta de la aplicación registrada por el script
  oficial `@vercel/analytics` (`src/components/site-analytics.tsx`). Rutas medidas: `/` (landing),
  `/demo` (hub), `/demo/falla`, `/demo/presupuesto` (y las rutas heredadas `/falla`, `/presupuesto`).
- **Visitante:** el número de visitantes que informa el panel de Vercel. Vercel lo calcula sin
  cookies, a partir de un hash diario de la solicitud; **no** es una persona única verificada: la
  misma persona en dos dispositivos o en dos días puede contarse más de una vez, y varias personas
  detrás de la misma red pueden contarse como una.
- **Qué NO se registra:** texto del síntoma, presupuesto, patente, marca, modelo, año, correo,
  respuestas del LLM ni identificadores de caso. El asistente y los resultados son estado del
  navegador (no cambian la URL) y, como defensa adicional, `beforeSend` elimina query string y hash
  de toda URL reportada. No usamos cookies, fingerprints ni identificadores propios.
- **Qué NO se puede medir con Vercel Hobby:** eventos personalizados (por ejemplo "análisis
  completado" o "clic en feedback") requieren un plan pago, por lo que **no** están implementados.
  Una visita a `/demo/falla` no significa que se haya completado un análisis.

### 3.2 Participante que declaró haber probado la demo (formulario)

Una **respuesta enviada** al formulario de Google Forms en la que la pregunta 1 ("¿Qué
funcionalidad probaste?") tiene una opción marcada. Es una declaración, no una verificación.

### 3.3 Análisis completado (autodeclarado)

Una respuesta del formulario con "Sí" en la pregunta 2 ("¿Pudiste completar el análisis?").
"Parcialmente" se informa por separado; nunca se suma a "Sí".
No existe un contador del lado del servidor que vincule respuestas del formulario con análisis
reales (decisión deliberada: no guardamos identificadores de caso ni datos de las consultas).

### 3.4 Respuestas duplicadas

Una respuesta del formulario **no** equivale automáticamente a un usuario único. Para reducir y
explicitar duplicados:

1. Presentar siempre el número como **"respuestas"**, no como "usuarios".
2. En Google Forms **no** activar "Recopilar correos" ni "Limitar a 1 respuesta" (ambos exigen
   iniciar sesión y asocian la respuesta a una cuenta). Por lo tanto, el formulario no puede impedir
   envíos repetidos: hay que tratarlos en el análisis.
3. Al cerrar el período, revisar la hoja de respuestas y marcar como posible duplicado las filas con
   marca de tiempo a menos de 2 minutos de otra y respuestas idénticas en todas las preguntas
   (incluido el texto libre). Informar el total bruto, los posibles duplicados y el total depurado.
4. No cruzar respuestas con datos de Analytics ni con ningún otro dato para identificar personas.

## 4. Tipos de evidencia (no mezclarlos)

| Tipo | Qué es | Fuente | Cómo se presenta |
|---|---|---|---|
| Entrevistas | Conversaciones guiadas con conductores o talleres (descubrimiento del problema). | Notas del equipo | Cantidad de entrevistas, perfil general (sin nombres), hallazgos cualitativos. |
| Encuesta exploratoria | Cuestionario sobre el problema, sin necesidad de haber usado el MVP. | Formulario separado, si existe | Se reporta aparte; no cuenta como uso del MVP. |
| Pruebas del MVP | Personas que usaron la demo pública y luego respondieron este formulario. | Este formulario + Vercel Analytics | Respuestas (bruto/depurado), análisis completados autodeclarados, utilidad percibida. |

Las visitas de Analytics y las respuestas del formulario son métricas distintas: no se dividen
entre sí para obtener una "tasa de conversión" salvo que se explique que el numerador es
autodeclarado y el denominador incluye visitas repetidas, del equipo y de bots.

## 5. Diseño del formulario de Google Forms

**Título:** Chuya Motor — Tu experiencia con la demo

**Descripción (texto a copiar):**

> Gracias por probar Chuya Motor. Esta encuesta es voluntaria y anónima, y lleva menos de 2 minutos.
> **No compartas datos personales**: ni tu nombre, correo, teléfono, patente, número de chasis,
> fotos ni el texto de tu consulta o presupuesto. Las respuestas se usan sólo de forma agregada
> para mejorar la herramienta.

**Preguntas:**

| # | Pregunta | Tipo | Opciones | Obligatoria |
|---|---|---|---|---|
| 1 | ¿Qué funcionalidad probaste? | Opción múltiple | Análisis de fallas · Interpretación de presupuestos · Ambas | Sí |
| 2 | ¿Pudiste completar el análisis? | Opción múltiple | Sí · No · Parcialmente | Sí |
| 3 | ¿Te resultó útil el resultado? | Opción múltiple | Mucho · Algo · Poco · Nada | Sí |
| 4 | ¿Te ayudó a comprender mejor el problema? | Opción múltiple | Sí · Parcialmente · No | Sí |
| 5 | ¿Qué mejorarías? | Párrafo | Texto libre. Ayuda: "No incluyas datos personales, patentes ni el texto de tu consulta." | No |
| 6 | ¿Utilizarías Chuya Motor nuevamente? | Opción múltiple | Sí · Tal vez · No | Sí |

No agregar preguntas de nombre, correo, teléfono, ubicación, patente ni carga de archivos/fotos.

**Configuración (Configuración → Respuestas / Presentación), sujeta a lo que ofrezca Google Forms:**

- Recopilar direcciones de correo electrónico: **No recopilar**.
- Limitar a 1 respuesta: **desactivado** (exige iniciar sesión con Google).
- Permitir editar después de enviar: desactivado.
- Ver gráficos de resumen y respuestas de texto (para quien responde): **desactivado**
  (evita que un participante vea el texto libre de otros).
- No activar la carga de archivos (exige cuenta de Google y guarda archivos en Drive).
- Mensaje de confirmación: "Gracias. Tu opinión nos ayuda a mejorar Chuya Motor."

Google puede mostrar el formulario a usuarios con sesión iniciada y aplicar sus propias políticas;
"anónimo" significa aquí que **el formulario no pide ni recopila** el correo, no que Google no
procese datos técnicos de la conexión.

## 6. Conexión con la aplicación

1. Crear el formulario (sección 5) → **Enviar** → ícono de enlace → copiar el enlace
   (`https://docs.google.com/forms/d/e/<id>/viewform` o el corto `https://forms.gle/<id>`).
   No usar "Obtener enlace pre-rellenado": la app rechaza enlaces con parámetros `entry.*`.
2. En Vercel → Proyecto → **Settings → Environment Variables** → agregar
   `NEXT_PUBLIC_FEEDBACK_FORM_URL` con ese enlace, para el entorno **Production** (y Preview si se
   quiere probar ahí).
3. **Redeploy** (la variable es `NEXT_PUBLIC_*`: se incrusta al compilar; sin redeploy no aparece).
4. Verificar: completar un análisis en `/demo/falla` y en `/demo/presupuesto` → al final del
   resultado aparece "¿Te resultó útil Chuya Motor?" → "Contanos tu experiencia" abre el formulario
   en una pestaña nueva, con la URL exactamente igual a la configurada.

Si la variable falta o no es un enlace válido de Google Forms, el bloque no se muestra y el resto
de la aplicación funciona igual. El bloque tampoco se muestra cuando el Safety Gate bloquea una
consulta: en ese caso sólo se ve la alerta de seguridad.

## 7. Habilitar Vercel Web Analytics

1. Vercel → Proyecto → pestaña **Analytics** → **Enable** (Web Analytics, disponible en Hobby con
   los límites vigentes del plan; verificarlos en la documentación de Vercel antes del piloto).
2. Redeploy para que se sirva `/_vercel/insights/script.js` (la app ya incluye el componente oficial).
3. Verificar: abrir el sitio de producción, DevTools → Network → debe cargarse
   `/_vercel/insights/script.js` y enviarse una solicitud `/_vercel/insights/view` sin query string
   con datos. Los datos aparecen en el panel tras unos minutos.
4. Los bloqueadores de anuncios pueden impedir el script: las visitas del panel son un **mínimo**.
5. Excluir el tráfico propio al interpretar: anotar en qué días el equipo hizo pruebas o demos.

## 8. Resumen agregado de resultados

Al cerrar el período:

1. **Analytics:** en el panel, filtrar el período y anotar páginas vistas y visitantes por ruta
   (`/`, `/demo`, `/demo/falla`, `/demo/presupuesto`). Exportar o capturar la vista agregada.
2. **Formulario:** en Google Forms → Respuestas → "Ver en Hojas de cálculo". En una **copia**:
   - eliminar o vaciar la columna de texto libre si contiene datos personales (revisión manual);
   - aplicar la depuración de duplicados (3.4);
   - contar por opción en cada pregunta (tabla dinámica o `COUNTIF`).
3. Completar la tabla siguiente **sólo con datos reales**:

| Métrica | Valor | Fuente | Período |
|---|---|---|---|
| Páginas vistas (todas las rutas) | _pendiente_ | Vercel Analytics | |
| Visitantes (según Vercel) | _pendiente_ | Vercel Analytics | |
| Páginas vistas de `/demo/falla` / `/demo/presupuesto` | _pendiente_ | Vercel Analytics | |
| Respuestas al formulario (bruto / depurado) | _pendiente_ | Google Forms | |
| Análisis completados autodeclarados ("Sí" / "Parcialmente") | _pendiente_ | Google Forms (P2) | |
| Utilidad percibida (Mucho / Algo / Poco / Nada) | _pendiente_ | Google Forms (P3) | |
| Uso futuro (Sí / Tal vez / No) | _pendiente_ | Google Forms (P6) | |

4. Las citas del texto libre se publican sólo si no permiten identificar a nadie, sin editar su sentido.

## 9. URL pública de sólo lectura para el jurado

- **Formulario (resumen):** crear una hoja **nueva** con sólo los conteos agregados de la sección 8
  (sin marcas de tiempo, sin texto libre sin revisar, sin filas individuales) y compartirla como
  "Cualquier persona con el enlace → Lector". No compartir la hoja de respuestas original ni el
  formulario en modo edición, y no activar "Ver resumen" para quienes responden.
- **Analytics:** Vercel Hobby no ofrece un panel público de sólo lectura. Usar capturas del panel
  agregado (con la fecha visible) incluidas en la hoja o en el material del hackatón. No agregar
  al jurado como miembro del equipo de Vercel.
- Antes de compartir: revisar que el enlace abra en una ventana privada sin sesión y que no se vean
  correos, nombres de la cuenta propietaria más allá de lo necesario ni datos de filas individuales.

## 10. Limitaciones

- **Vercel Web Analytics:** sólo páginas vistas y métricas agregadas; sin eventos personalizados en
  Hobby; los visitantes son una aproximación (sin cookies, hash diario); los bloqueadores pueden
  ocultar visitas; incluye tráfico del equipo y posiblemente bots; el período de retención y los
  límites de eventos dependen del plan.
- **Google Forms:** respuestas autodeclaradas y voluntarias (sesgo de autoselección: responden más
  quienes tuvieron una experiencia marcada); sin control de duplicados sin exigir inicio de sesión;
  el texto libre puede contener datos personales pese a la advertencia y debe revisarse a mano.
- **Sin vínculo entre fuentes:** no se puede saber qué visita corresponde a qué respuesta, ni si
  una respuesta corresponde a un análisis real. Esto es intencional (privacidad).
- **Ninguna de las dos fuentes mide la calidad técnica** de las hipótesis: eso requiere revisión
  mecánica profesional, fuera del alcance de este incremento.
