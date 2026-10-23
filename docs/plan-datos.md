# Plan: datos y autenticación

Subordinado a `capstone/FUENTE-DE-LA-VERDAD.md`. Ese archivo y el prompt `02-datos-auth.md` dicen lo mismo sobre el producto, el contrato HTTP y el alcance de este agente. Nada de la fuente impidió avanzar y ese archivo no se tocó.

Este agente escribe `app/db.py`, `app/auth.py`, `app/repositorio.py`, las rutas `/auth` y `GET /resumen`, y los tests de aislamiento. No implementa visión, Pinecone, el grafo ni pantallas. No cambia `app/esquemas.py` ni `app/main.py`: `main` ya monta `rutas_auth.router` si el módulo existe. El esquema de SQLite se crea en el primer uso, dentro de `db.py`, no en el lifespan. El lifespan sigue exigiendo Redis; estos tests no lo levantan.

La fuente pide que confirmar persista el comprobante e indexe el texto. Este agente no toca el índice. `confirmar_documento` solo mueve el borrador al libro de montos. El texto queda en el dict de vuelta para que ingesta lo indexe después, con metadata `user_id`, categoría, período y proveedor. No se “arregla” la fuente: la tabla de agentes parte la persistencia y la indexación.

## Mejores prácticas

Decisión: las rutas usan los modelos de `app/esquemas.py` como body, query y `response_model`, y el SQL vive solo en el repositorio. Toda función de base es `async` y usa `aiosqlite`. No hay `requests` ni `sqlite3` dentro de `async def`. Los montos del libro se guardan como centavos enteros y salen como string con dos decimales, armados con división entera, sin `float`.

Opción descartada: repetir los modelos en las rutas, o sumar los montos en Python recorriendo filas. Lo primero se desalinea del contrato congelado. Lo segundo deja de ser el `SUM` que pide la fuente y se equivoca con `0.10 + 0.20`.

## Arquitectura

Decisión: tres módulos y un router. `db.py` abre SQLite y crea las tablas. `auth.py` hashea, emite y lee el JWT, y expone la dependencia `usuario_actual`. `repositorio.py` es la única capa con SQL. `rutas_auth.py` exporta `router` con `POST /auth/registro`, `POST /auth/login`, `GET /auth/me` y `GET /resumen`. Ingesta y el grafo importan las firmas de la sección de abajo; no abren la base ni leen el token por su cuenta. El `user_id` de una tool lo inyecta el sistema al llamar `consultar_gastos`. No es argumento del modelo.

Opción descartada: SQL en el router, o una conexión global creada en el lifespan de `main.py`. El lifespan es de otro agente y, si falla Redis, no llegaría a crear las tablas. Una conexión atada a un event loop también rompe los tests, que arman una app mínima sin ese lifespan.

Hay dos almacenes y no se mezclan. `borradores` guarda el texto y los campos extraídos. `comprobantes` es el libro: solo entra al confirmar. El resumen y `consultar_gastos` leen únicamente `comprobantes`.

## Implementación

Decisión: `aiosqlite`, una conexión corta por operación, `isolation_level=None` y transacción explícita al confirmar. `SQLITE_PATH` vacío usa `capstone/api/data/gastos.db`, resuelto desde el paquete y no desde el directorio de trabajo. El primer `conectar()` ejecuta el `CREATE TABLE IF NOT EXISTS`. No hay migración ni segundo esquema.

Opción descartada: `sqlite3` envuelto en `asyncio.to_thread`, o dejar la base sin crear hasta un script aparte. `to_thread` sigue siendo el módulo bloqueante que la consigna prohíbe dentro de `async def`. Un script aparte no está en el arranque de la API.

Tablas:

| Tabla | Columnas | Para qué |
| --- | --- | --- |
| `usuarios` | `user_id` TEXT PK, `email` TEXT UNIQUE COLLATE NOCASE, `password_hash` TEXT | Login. El email se guarda en minúsculas, sin espacios. |
| `borradores` | `id` TEXT PK, `user_id` TEXT FK, `texto` TEXT, `campos_json` TEXT, `advertencias_json` TEXT, `creado_en` TEXT | Extracción sin efecto en los totales. |
| `comprobantes` | `id` TEXT PK, `user_id` TEXT FK, `proveedor`, `categoria`, `periodo` (`YYYY-MM`), `monto_centavos` INTEGER, `moneda`, `vencimiento`, `numero_comprobante`, `texto`, `confirmado_en` | Libro. El `SUM` usa `monto_centavos`. |

Índices: `(user_id, periodo)` y `(user_id, categoria)` en `comprobantes`, y `(user_id)` en `borradores`. Toda sentencia lleva `user_id` en el `WHERE`, con parámetros `?`.

`guardar_borrador` inserta solo en `borradores`, aunque `campos` traiga `monto`. `confirmar_documento` exige en `campos` proveedor, categoría, período y monto; si faltan, lanza `ValueError` para no escribir una fila que no se puede sumar. La ruta de ingesta tiene que responder 422 antes de llamar, como fija el contrato. En una transacción se inserta el comprobante y se borra el borrador. No llama a Pinecone ni a ningún índice. Si ese usuario ya lo tenía confirmado, devuelve el mismo comprobante y no duplica la fila. Si el id no existe o es de otra persona, devuelve `None`.

`resumen` filtra `periodo >= desde` y `periodo <= hasta` (comparación de `YYYY-MM`) y agrega en SQL:

```sql
SELECT periodo, SUM(monto_centavos) ... GROUP BY periodo
SELECT categoria, SUM(monto_centavos) ... GROUP BY categoria
```

El string `"18500.50"` sale de `centavos // 100` y `centavos % 100`. `COALESCE(SUM(...), 0)` cubre el rango vacío. `consultar_gastos` usa el mismo `SUM` y el `COUNT` de SQL; el promedio es esa suma dividida por la cantidad, con `Decimal` y redondeo half-up a dos decimales. `AVG()` de SQLite devuelve float y no se usa.

`GET /resumen` declara `rango: Annotated[RangoResumen, Query()]` y `response_model=Resumen`. Registro responde `201` con `Token`. Login responde `200` con `Token`. Los dos emiten el JWT. `token_type` es `bearer`.

## Seguridad

Decisión: contraseña con Argon2id (`argon2-cffi`, `PasswordHasher` por defecto: `time_cost=3`, `memory_cost=65536`, `parallelism=4`). El repositorio guarda el hash ya calculado y nunca ve la contraseña. El JWT es HS256, vive 900 segundos (`VIDA_TOKEN_SEGUNDOS` en `auth.py`) y el claim que identifica al usuario se llama `sub` y vale el `user_id`. También van `iat` y `exp`. No van el email, la contraseña ni el hash. El secreto sale de `JWT_SECRET` en cada emisión y en cada lectura; si falta, es un error de configuración y no hay secreto de respaldo en el código. Conviene que tenga al menos 32 bytes: con una clave más corta PyJWT avisa, y este código no inventa otra. Solo se acepta el algoritmo `HS256`.

Opción descartada: bcrypt, un JWT de horas o días, y poner el `user_id` en un claim con otro nombre. Argon2id es memoria-dura y es la opción actual frente a bcrypt. Un token largo agranda la ventana si se filtra. El contrato no tiene refresh: al vencer, la API responde 401 y el frontend vuelve al login. No se edita `.env.example`: `JWT_SECRET` y `SQLITE_PATH` ya están, y la vida del token no es un secreto.

`usuario_actual` es la dependencia de FastAPI. Lee `Authorization: Bearer`, toma `sub` y carga el usuario. Si no hay header, el token no verifica, está vencido o el usuario ya no existe, responde 401 con `detail` «No autenticado». `HTTPBearer(auto_error=False)`: el default de la clase es 403 y un recurso privado sin sesión no es un prohibido.

Login inválido, email inexistente o contraseña distinta: 401 con el mismo `detail`, «Credenciales inválidas». No dice cuál campo falló. Si el email no existe igual se verifica un hash Argon2 fijo, para no contestar antes. Email duplicado, también si solo cambia las mayúsculas: 409 «Ese email ya está registrado». El 409 del registro sí revela que el email existe; el contrato lo pide. El login no.

Un id ajeno no se distingue de uno inexistente: el repositorio devuelve `None` y la ruta de documentos (ingesta) lo traduce a 404. Este agente no responde 403 por pertenencia. `GET /resumen` no lleva id: cada token ve solo sus comprobantes, y el de otra persona simplemente no está en el JSON. No se loguea la contraseña, el token, `JWT_SECRET` ni el texto del comprobante.

## Documentación

Decisión: este plan es el contrato que importan ingesta y el grafo. Las firmas de abajo se escriben igual en `app/repositorio.py`. Los retornos quedan descriptos acá para que nadie invente otro dict. OpenAPI muestra `Credenciales`, `Token`, `UsuarioActual`, `RangoResumen` y `Resumen` porque las rutas los usan. No se escribe el README de la raíz.

Opción descartada: documentar las firmas solo en docstrings, o agregar `JWT_TTL` a `.env.example`. El ejemplo de entorno no está en los archivos de este agente. La vida queda en este plan y en la constante.

## Escalabilidad

Decisión: las rutas, ingesta y el grafo dependen de las firmas, no del driver. Pasar a Postgres se hace en `db.py`: otra conexión async (`asyncpg`), los `?` traducidos a `$1`, `$2`, … y el mismo `CREATE` adaptado a ese dialecto. `rutas_auth.py` no se reescribe. Las firmas de esta sección tampoco cambian. SQLite queda en WAL con `busy_timeout` de 5 segundos; alcanza para la API y el worker en un solo proceso. El día que haya más de un proceso escribiendo seguido, el cambio es el driver, no el contrato HTTP.

Opción descartada: un ORM en las rutas, o devolver filas de SQLite hacia ingesta. Ataría el contrato al motor y filtraría mal el día que el `Row` traiga una columna de más.

## Firmas del repositorio

Ingesta y el grafo importan estas funciones desde `app.repositorio`. Son keyword-only salvo `crear_usuario` y `buscar_usuario_por_email`. El `user_id` lo pone el sistema. Ninguna lo recibe del modelo.

```python
async def crear_usuario(email: str, password_hash: str) -> str
async def buscar_usuario_por_email(email: str) -> dict | None
async def guardar_borrador(*, user_id: str, texto: str, campos: dict, advertencias: list[str]) -> str
async def obtener_documento(*, user_id: str, documento_id: str) -> dict | None
async def listar_documentos(*, user_id: str) -> list[dict]
async def confirmar_documento(*, user_id: str, documento_id: str, campos: dict) -> dict | None
async def resumen(*, user_id: str, desde: str, hasta: str) -> dict
async def consultar_gastos(*, user_id: str, categoria: str | None = None, periodo_desde: str | None = None, periodo_hasta: str | None = None, proveedor: str | None = None) -> dict
```

`crear_usuario` normaliza el email (`strip` y minúsculas), guarda `password_hash` tal cual y devuelve el `user_id` nuevo. Si el email ya existe, lanza `EmailDuplicado`. La ruta lo traduce a 409. No hashea y no escribe comprobantes.

`buscar_usuario_por_email` devuelve `None` o un dict con exactamente `user_id`, `email` y `password_hash`. El email del dict es el guardado. La usa el login. No sale en ninguna respuesta HTTP.

`guardar_borrador` devuelve el id del borrador. Persiste `texto`, `campos` y `advertencias`. No inserta en `comprobantes`: un monto dentro de `campos` no entra al libro ni al `SUM`.

`obtener_documento` devuelve `None` si el id no existe o es de otra persona. No dice cuál de los dos casos fue. Borrador: `id`, `estado="borrador"`, `campos`, `texto`, `advertencias`. Confirmado: `id`, `estado="confirmado"`, `campos`. La ruta de ingesta traduce `None` a 404. `campos` omite claves en null. Sirve para `DocumentoDetalle`.

`listar_documentos` devuelve solo documentos de ese `user_id`, borradores y confirmados, del más nuevo al más viejo. Cada item es `id`, `estado`, `campos`, sin `texto`. Sirve para `ListaDocumentos`. La lista de otro usuario no aparece: no es un 403, es una lista sin esas filas.

`confirmar_documento` devuelve `None` si no hay borrador ni comprobante de esa persona con ese id. Si hay borrador, lo mueve al libro en una transacción y borra el borrador. Si ya estaba confirmado por esa persona, devuelve el comprobante y no inserta otra fila. No indexa. El dict trae `id`, `estado="confirmado"`, `campos` y `texto` (el del borrador, guardado en el libro para poder indexar después). `DocumentoConfirmado` tiene `extra="ignore"`: la respuesta HTTP no emite `texto`. Ingesta indexa con ese `texto` y el `user_id` del token, fuera de esta función. `campos` de vuelta usa el monto con dos decimales.

`resumen` solo suma comprobantes confirmados de ese `user_id` con período entre `desde` y `hasta`, inclusive. Devuelve la forma de `Resumen`:

```json
{
  "por_mes": [{ "periodo": "2026-03", "total": "18500.50" }],
  "por_categoria": [{ "categoria": "expensas", "total": "18500.50" }],
  "comprobantes": [{ "id": "...", "estado": "confirmado", "campos": {} }]
}
```

`total` es string con dos decimales. Sin filas, las tres listas van vacías. Un borrador no aparece. `desde` posterior a `hasta` tampoco devuelve filas.

`consultar_gastos` es la tool del analista. Agregados SQL de ese `user_id`, solo confirmados. `categoria`, `periodo_desde`, `periodo_hasta` y `proveedor` son filtros opcionales; `None` o string vacío no filtran. El proveedor compara en minúsculas, siempre con parámetro. No recibe el `user_id` desde el modelo: quien arma la tool lo cierra sobre el estado del grafo y no lo declara en el esquema que ve el modelo. Forma:

```json
{
  "total": "18500.50",
  "promedio": "9250.25",
  "cantidad": 2,
  "por_mes": [{ "periodo": "2026-03", "total": "18500.50", "promedio": "18500.50", "cantidad": 1 }],
  "por_categoria": [{ "categoria": "expensas", "total": "18500.50", "promedio": "18500.50", "cantidad": 1 }],
  "por_proveedor": [{ "proveedor": "Consorcio", "total": "18500.50", "promedio": "18500.50", "cantidad": 1 }]
}
```

`total` y `promedio` son strings con dos decimales. `cantidad` es int. Sin filas: `total` y `promedio` `"0.00"`, `cantidad` 0 y listas vacías. Una categoría o un proveedor que no es de ese usuario da el mismo vacío, no las filas de otra persona.

Firma interna, no la importan ingesta ni el grafo: `async def buscar_usuario_por_id(user_id: str) -> dict | None`. La usa `usuario_actual`. El dict tiene `user_id`, `email` y `password_hash`. La dependencia devuelve a la ruta solo `user_id` y `email`.

`usuario_actual` vive en `app.auth`. Ingesta puede usarla con `Depends(usuario_actual)` en `/documentos`.
