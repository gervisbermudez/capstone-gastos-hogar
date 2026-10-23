# Plan: contrato y esqueleto

Subordinado a `capstone/FUENTE-DE-LA-VERDAD.md`. Ese archivo y el prompt `01-contrato.md` dicen lo mismo. Nada de la fuente impidió avanzar: no hay nota de bloqueo y ese archivo no se tocó.

Este agente copia `pre-entrega-7-api/` a `capstone/api/`, materializa el contrato HTTP en Pydantic y deja la configuración lista. No implementa auth, SQLite, visión, el cambio de dominio del grafo ni pantallas. No escribe `capstone/README.md`, `capstone/docker-compose.yml` ni `capstone/run.sh`.

## Mejores prácticas

Decisión: un solo módulo, `app/esquemas.py`, con modelos Pydantic v2, y las rutas siguen en los agentes que la fuente les asigna. Las entradas usan `extra="forbid"`. Las salidas usan `extra="ignore"`.

Opción descartada: declarar los modelos otra vez dentro de cada ruta, o publicar rutas vacías para que `/docs` los liste ya. La primera se desalinea en cuanto dos agentes editan el mismo JSON. La segunda finge lógica de negocio y choca con quien después implementa `/auth`, `/documentos` y `/tasks`. FastAPI muestra un modelo en OpenAPI cuando una ruta lo usa como body o `response_model`. Hasta entonces el contrato vive en `esquemas.py`. Quien agregue la ruta importa estas clases y no redefine los campos.

`user_id` no está en ningún modelo de entrada. En una entrada, `extra="forbid"` hace que mandarlo en el body sea 422. En una salida, `extra="ignore"` hace que las claves de más no salgan en el JSON y tampoco rompan la respuesta el día que la ruta use el modelo. `forbid` en la salida haría lo contrario: un `publico()` que todavía trae claves internas devolvería error de validación en lugar de filtrarlas.

## Arquitectura

Decisión: `capstone/api/` es la copia de la pre-entrega 7, con el dominio TechCorp todavía adentro, y el contrato nuevo queda al lado, en `esquemas.py`, sin reescribir el grafo.

Opción descartada: adaptar ya supervisor, retriever, tools y `publico()` al dominio de gastos. La fuente reserva eso al agente de agentes y prohíbe a este agente la lógica de negocio. La topología que llega en la copia (incluye `evaluar_criticidad` antes de síntesis) se conserva tal cual. El diagrama de la fuente (supervisor, investigador, analista, síntesis) lo cierra ese agente, no este.

El frontend sigue hablando solo con HTTP. Esta copia no abre Pinecone, SQLite ni el modelo hacia el navegador. CORS sale únicamente de `FRONTEND_ORIGIN`.

## Implementación

Decisión: se copian los archivos de la pre-entrega salvo `.env`, `.venv`, `__pycache__`, `.git` y secretos; después se cambian solo `app/llm.py`, el CORS de `app/main.py`, `app/esquemas.py` y `.env.example`.

Opción descartada: reescribir `POST /tasks` para que ya responda 202 con `thread_id`, o recortar `worker.publico()`. Eso cambia el JSON que hoy sirve la copia y es trabajo del agente de agentes. Los modelos `ConsultaTarea`, `TareaCreada` y `TareaEstado` quedan definidos para que ese agente los enganche. Los handlers copiados no se reemplazan.

`armar_llm()` mantiene la regla de proveedor y la temperatura: si `LLM_PROVIDER` es `gemini` (minúsculas, sin espacios de más), usa Gemini; cualquier otro valor, incluido el default `openai`, usa OpenAI. `temperature` sigue en `0`. El nombre del modelo no tiene default en código: Gemini lee `GEMINI_MODEL` y OpenAI lee `OPENAI_MODEL`. Si la variable falta o está vacía, `armar_llm()` lanza `RuntimeError` nombrando la variable, no un modelo.

`campos` en las respuestas es un objeto con las claves de `Factura`, todas opcionales, que al serializar omite las que valen `null`. Así `{}` sigue siendo `{}`. El body de `POST /documentos/{id}/confirmar` es `Factura`, con `proveedor`, `categoria`, `periodo` y `monto` obligatorios, `moneda` con default `ARS`, y `vencimiento` y `numero_comprobante` anulables. Montos: `^\d+\.\d{2}$`. Períodos: `YYYY-MM`. Fechas: `YYYY-MM-DD` de calendario. No se aceptan negativos ni separadores de miles: la fuente muestra `"18500.50"`.

## Seguridad

Decisión: CORS permite un solo origen, el valor de `FRONTEND_ORIGIN` sin barra final, y rechaza `*` y el valor vacío (lista vacía: el navegador no entra). Métodos `GET`, `POST` y `OPTIONS`. Headers `Authorization` y `Content-Type`. `allow_credentials` queda en falso porque el contrato usa `Authorization: Bearer`, no cookies.

Opción descartada: `allow_origins=["*"]`, un fallback a `http://localhost:5173`, o partir `FRONTEND_ORIGIN` por comas. La fuente nombra una sola variable de origen. El token no se lee en este agente y no se loguea. No se copia `pre-entrega-7-api/.env`.

## Documentación

Decisión: `capstone/api/.env.example` lista cada variable de la sección Configuración, con secretos, modelos e índice vacíos, y solo ejemplos locales no secretos donde el formato importa (`LLM_PROVIDER`, `REDIS_URL`, `OBSERVABILIDAD`, `PHOENIX_COLLECTOR_ENDPOINT`, `WORKER_CONCURRENCY`).

Opción descartada: dejar los valores de la pre-entrega (`INDEX_NAME=techcorp-rag-hibrido`, `gpt-4.1-mini`, `gemini-3.5-flash`). Son nombres reales del proyecto anterior. El ejemplo no los repite. `LANGSMITH_API_KEY` y `LANGSMITH_PROJECT` quedan comentados porque `app/observability.py` ya los lee cuando `OBSERVABILIDAD` es `langsmith` o `both`; no están en el mínimo de la fuente y no llevan valores.

El README de la raíz, el compose de la raíz y `run.sh` no se escriben: los escribe el cierre. El `README.md` y el `docker-compose.yml` que aparecen bajo `capstone/api/` son los de la copia, no los de la raíz.

## Escalabilidad

Decisión: el contrato queda cerrado y stateless en los modelos; no se agrega otra cola, otro proveedor ni otro origen.

Opción descartada: anticipar varios orígenes, un `EMBEDDING_MODEL` nuevo, o partir el worker. `WORKER_CONCURRENCY` ya existe en la copia y solo se documenta. Un origen nuevo se cambia en el entorno, sin tocar código. Los modelos de respuesta filtran claves de más el día que una ruta los use: el cliente del frontend no depende de campos internos del job.

## Qué no se inventó

Firmas que este agente no define. Los siguientes las escriben en su plan y las respetan:

- `buscar_comprobantes` y `consultar_gastos`: la fuente fija el nombre y que `user_id` no es argumento del modelo. No fija parámetros. No existen en esta copia.
- `indexar_comprobante`: la nombran los prompts de ingesta y agentes. La fuente no da la firma. No está creada acá.
- Funciones del repositorio (borrador, confirmar, `SUM`): las define el agente de datos. No hay `db.py`, `auth.py` ni `repositorio.py` nuevos.
- Nombre del claim JWT, algoritmo de hash (argon2 o bcrypt) y vida del token: la fuente no elige. No quedan escritos en código.
- Columnas de SQLite más allá de «usuarios, borradores, comprobantes confirmados».
- Tamaño máximo del archivo y el umbral de «poco o ningún texto» en un PDF: la fuente dice que existen y no da números.
- Body de respuesta de `POST /tasks/{job_id}/approve`: la fuente fija el request `{ "aprobado": true }` y el `202`. No fija el JSON de salida. El handler copiado sigue respondiendo `{ "job_id", "status" }`.
- `worker.publico()` sigue devolviendo claves de más (`query`, `error`, `interrupt`, `accion`, `critica`, `motivo_critico`, `contribuciones`, `created_at`, `updated_at`) y usa el `job_id` como `thread_id`. El GET congelado es `TareaEstado`: `job_id`, `status`, `thread_id`, `result`.
- `POST /tasks` copiado sigue aceptando solo `query` y responde 200 `{ "job_id", "status" }`. El contrato es `ConsultaTarea` y `TareaCreada` (`202`, con `thread_id`).
- `app/rag.py` conserva `INDEX_NAME_DEFAULT = "techcorp-rag-hibrido"` y `EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"`. No se agregó una variable de embedding: no está en Configuración.
- La calculadora sigue siendo `calculadora(expresion: str) -> str`, sin `eval()`.
- Metadata del índice, cuando el agente de agentes la escriba: `user_id`, categoría, período, proveedor. Sin claves extra inventadas acá.
- Campo multipart: `archivo`. Tipos: `jpeg`, `png`, `webp`, `pdf`. Constantes `CAMPO_ARCHIVO` y `TIPOS_ARCHIVO` en `esquemas.py`. El MIME real lo comprueba ingesta.
- JSON de error: la fuente no lo congela. Sigue el `{"detail": ...}` de `HTTPException`. El 401 de login no debe decir si falló el email o la contraseña: lo cumple el agente de datos.
- `GET /health` con Redis caído sigue en 503, como la copia. Con Redis sano el body es `{ "status": "ok" }` (`Salud`).

## Modelos que hay que usar tal cual

| Ruta | Entrada | Salida |
| --- | --- | --- |
| `POST /auth/registro`, `POST /auth/login` | `Credenciales` (`email`, `password`) | `Token` (`access_token`, `token_type="bearer"`, `user_id`) |
| `GET /auth/me` | — | `UsuarioActual` (`user_id`, `email`) |
| `POST /documentos` | multipart, campo `archivo` | `DocumentoBorrador` |
| `GET /documentos/{id}` | — | `DocumentoDetalle` (borrador o confirmado) |
| `POST /documentos/{id}/confirmar` | `Factura` | `DocumentoConfirmado` |
| `GET /documentos` | — | `ListaDocumentos` |
| `GET /resumen` | query `RangoResumen` (`desde`, `hasta`, `YYYY-MM`) | `Resumen` |
| `POST /tasks` | `ConsultaTarea` (`query`, `thread_id` o null) | `TareaCreada` |
| `GET /tasks/{job_id}` | — | `TareaEstado` |
| `POST /tasks/{job_id}/approve` | `Aprobacion` (`aprobado`) | sin modelo: la fuente no lo fija |
| `GET /health` | — | `Salud` |

`status` de una tarea: `PENDING`, `RUNNING`, `AWAITING_APPROVAL`, `FAILED`, `DONE`. `categoria`: `servicios`, `expensas`, `alquiler`. `estado` de un documento: `borrador` o `confirmado`.

Nombres internos que tampoco se renombran: `campos` es `CamposDocumento` (omite claves en null, así `{}` sigue siendo `{}`). `ListaDocumentos.items` es `DocumentoListado` (`id`, `estado`, `campos`, sin `texto`). `DocumentoDetalle` es la unión discriminada por `estado`. `Resumen.por_mes` es `TotalMes`, `por_categoria` es `TotalCategoria`, y `comprobantes` es `DocumentoConfirmado`. El multipart no es un modelo: el campo se llama `archivo` (`CAMPO_ARCHIVO`) y los tipos son `jpeg`, `png`, `webp`, `pdf` (`TIPOS_ARCHIVO`).
