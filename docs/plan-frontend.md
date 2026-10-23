# Plan: frontend

Subordinado a `capstone/FUENTE-DE-LA-VERDAD.md`. Si este plan y ese archivo difieren, gana la fuente. No se toca ese archivo, ni `capstone/prompts/`, ni `pre-entrega-7-api/`, ni Python. CORS ya lee `FRONTEND_ORIGIN` en `capstone/api/app/main.py` y no se modifica.

El trabajo es la SPA en `capstone/frontend/` y este plan. El navegador solo habla con la API HTTP.

## Mejores prácticas

Decisión: Vite, React y TypeScript estricto, con un solo módulo que hace `fetch` (`src/api/cliente.ts`) y tipos en `src/api/tipos.ts` copiados del contrato de `api/app/esquemas.py`. Cada pantalla distingue vacío, carga y error con componentes de la librería. El polling del chat se corta al desmontar.

Opción descartada: TanStack Query u otro cliente encima de `fetch`, y tipos “parecidos” al JSON sin el discriminador `estado`. Un segundo cliente duplica el header y el manejo del 401. El detalle de un documento es borrador o confirmado según `estado`; modelarlo como un solo objeto con `texto` siempre presente miente el contrato.

## Arquitectura

Decisión: SPA con React Router. Rutas públicas `/ingreso` y `/registro`. Rutas privadas `/` (tablero), `/documentos/:id` (revisión) y `/chat`, detrás de un layout que exige token. El estado de servidor vive en la pantalla que lo pide. El único estado global es la sesión.

```
frontend/src/
  main.tsx                 # ChakraProvider + router + sesión
  App.tsx                  # rutas
  sesion.tsx               # token y 401
  api/tipos.ts             # contrato
  api/cliente.ts           # único HTTP
  pantallas/Ingreso.tsx
  pantallas/Registro.tsx
  pantallas/Tablero.tsx
  pantallas/Revision.tsx
  pantallas/Chat.tsx
  componentes/MarcoPrivado.tsx
  componentes/GraficosResumen.tsx
  componentes/CargaComprobante.tsx
```

La lista de confirmados y los dos gráficos salen de `GET /resumen`. Los borradores, de `GET /documentos` (solo ítems con `estado === "borrador"`), para poder volver a la revisión. El tablero no suma esos ítems.

Opción descartada: calcular el total del gráfico recorriendo `comprobantes`, o usar solo `GET /documentos` y agrupar en el navegador. La fuente prohíbe totales en el navegador: `por_mes` y `por_categoria` se dibujan como llegan. Next.js tampoco: la fuente pide una SPA con Vite.

## Implementación

Decisión: Chakra UI 3 (`@chakra-ui/react` 3.37, peer de React `>=18`) con `ChakraProvider` y `defaultSystem`. Encaja con Vite 8 y React 19; la guía oficial de Chakra es un proyecto Vite. Tipografía, espacio y color salen de ese tema. No hay `theme` propio ni tokens nuevos.

Piezas de Chakra que cubren la pantalla: `Field`, `Input`, `NativeSelect`, `Button`, `FileUpload` (`maxFiles={1}`, `accept` jpeg/png/webp/pdf, y otro con `capture="environment"`), `Table`, `Card`, `Alert`, `EmptyState`, `Spinner`, `Skeleton`, `Toaster`, `Stack` / `SimpleGrid` / `Flex`. Recharts 3 dibuja, dentro de `Card`, una barra por `por_mes` y un gráfico por `por_categoria`. El tooltip muestra el string `total` de la API. Recharts necesita un número para el eje; ese `Number` es la escala del dibujo, no un total nuevo. No se muestran porcentajes ni una suma.

`GET /resumen` manda `desde` y `hasta` (`YYYY-MM`). El default es enero del año en curso hasta el mes en curso. Cambiar el rango vuelve a pedir el resumen. No rellena meses ausentes.

La revisión arma el body `Factura`: proveedor, categoría `servicios|expensas|alquiler`, período `YYYY-MM`, monto string con dos decimales (si la persona escribe `18500.5` o `18500,50` se normaliza a `18500.50` antes del POST), moneda default `ARS`, vencimiento `YYYY-MM-DD` o `null`, `numero_comprobante` o `null`. Confirmar es `POST /documentos/{id}/confirmar`. La vista previa del archivo es el objeto local de esa pestaña; el texto extraído viene de la API. Un confirmado se muestra solo lectura. El contrato no trae el binario de vuelta.

El chat hace `POST /tasks` con `{ query, thread_id }` y no espera al modelo (202). Después `GET /tasks/{job_id}` hasta `DONE` o `FAILED`. El `thread_id` de la respuesta se reutiliza. En `AWAITING_APPROVAL` se frena el poll y se ofrece aprobar o rechazar con `POST /tasks/{job_id}/approve` y `{ aprobado: true|false }`; un 202 reanuda el poll del mismo job.

Opción descartada: Mantine. Misma idea (componentes listos), pero Chakra en esta versión sí entra con Vite y React, y es la candidata de la fuente. También se descarta Chart.js y un design system a mano. No se inventa un tope de tamaño de archivo: la fuente dice que existe y no da el número; lo aplica la API.

## Seguridad

Decisión: el access token vive en `sessionStorage` bajo la clave `gastos.access_token`. No va en la URL, ni en el repositorio, ni en `localStorage`, ni en un log. Las rutas privadas mandan `Authorization: Bearer <access_token>`. Un 401 borra la sesión y vuelve a `/ingreso`. Al salir se borra también `gastos.thread_id`, para que otra persona en la misma pestaña no herede el hilo. La contraseña no se guarda. El body no lleva `user_id`.

La URL de la API es `VITE_API_URL` (sin barra final). En `.env.example` el valor de ejemplo es `http://localhost:8000`. No hay claves de modelo, Pinecone ni JWT en el frontend: Vite solo expone variables `VITE_`, y no se declara ninguna secreta. El dev server queda fijo en el puerto 5173 (`strictPort`) para que coincida con un `FRONTEND_ORIGIN=http://localhost:5173` en la API. Ese origen lo configura quien levanta la API; este agente no edita Python ni `.env` de `api/`.

El login con 401 muestra «Email o contraseña incorrectos», sin decir cuál falló. El registro con 409 dice que el email ya existe.

Opción descartada: token en memoria sola (un refresh tira la sesión a mitad de la revisión) y token en `localStorage` (sobrevive al cierre del navegador, de más para un JWT corto). Cookies tampoco: el contrato es el header Bearer y el CORS de la API tiene `allow_credentials` en falso.

## Documentación

Decisión: este plan es la decisión de la SPA. `frontend/.env.example` documenta `VITE_API_URL`. `frontend/README.md` dice cómo instalar y levantar, y que la API tiene que estar en ese origen con `FRONTEND_ORIGIN` igual al origen de Vite. El README de la raíz, `docker-compose.yml` y `run.sh` los escribe el cierre; no se crean acá.

Comando de la API, el de `capstone/api/README.md`, por si al verificar no está levantada:

```bash
cd capstone/api
docker compose up -d
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`main.py` monta `rutas_auth` y `rutas_documentos` solo si esos módulos existen. El cliente igual llama el contrato congelado (`/auth`, `/documentos`, `/resumen`, `/tasks`). Si en la verificación esas rutas todavía no responden, se anota acá y un mock de contrato sirve solo para ejercitar la pantalla. El `.env` de la SPA queda en `VITE_API_URL` hacia la API real. El mock no queda como único camino del cliente.

Opción descartada: documentar la SPA solo en el README raíz. No es de este agente, y la fuente dice que ese README no es otra fuente de la verdad.

## Escalabilidad

Decisión: una función por ruta del contrato dentro del mismo cliente, pantallas separadas y poll corto (1 s) con `AbortSignal`. Agregar una ruta nueva es un tipo y un método, no un cliente paralelo. El chat no abre WebSocket: el contrato es `GET` del job, que no bloquea.

Opción descartada: suscribir al worker o a Redis desde el navegador, y precargar gráficos de otros usuarios. La fuente deja al frontend fuera de Redis, SQLite, Pinecone y el modelo, y cada persona solo ve lo que el token autoriza.

## Fuera de este agente

OAuth, recuperación de clave, roles, panel de administración, más de un archivo por comprobante y totales calculados en el navegador. No se agregan.

## Verificación

El comando de la API es el de `capstone/api/README.md` (`docker compose up -d` y `uvicorn app.main:app --host 0.0.0.0 --port 8000`). Redis 8 ya estaba en `localhost:6379`. No hay `api/.env`: para probar se levantó uvicorn con `FRONTEND_ORIGIN=http://localhost:5173`, un `JWT_SECRET` solo de esa corrida (no está en el repo) y `SQLITE_PATH` en `/tmp`. El dev server queda en el puerto 5173 y `VITE_API_URL=http://localhost:8000`.

En el navegador, contra esa API:

- Registro e ingreso. Un login mal muestra «Email o contraseña incorrectos.»
- El tablero dibuja `GET /resumen` tal cual: `2026-01` `4200.00`, `2026-03` `19300.75`, expensas `18500.50`, servicios `5000.25`. La lista muestra cada comprobante, no una suma hecha en la pantalla.
- La carga manda `POST /documentos` con el campo `archivo`. Hoy la extracción responde 502 «No se pudo leer el comprobante.» porque falta `OPENAI_MODEL`. El input de cámara tiene `capture="environment"`.
- El chat hace `POST /tasks` (202) y consulta `GET /tasks/{id}` hasta `FAILED`. El worker corta porque falta el modelo. La pantalla dice que la consulta no se pudo completar.
- Un JWT vencido en `GET /auth/me` responde 401, borra el token y vuelve a `/ingreso`.
- A 390 px de ancho el header, los períodos y los gráficos quedan en columna.

`POST /documentos/{id}/confirmar` y `AWAITING_APPROVAL` no se pueden cerrar contra esta API sin el modelo. Esas dos pantallas se recorrieron con un mock de contrato en el puerto 8099, solo durante la prueba: vista previa, edición, confirmación, gráfico con el `1500.00` que devolvió ese `/resumen`, respuesta del chat y rechazo de la acción. El mock se apagó. El cliente no lo tiene adentro: `frontend/.env` sigue en `http://localhost:8000`.
