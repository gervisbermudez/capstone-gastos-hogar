# API de gastos del hogar

FastAPI guarda comprobantes, el libro confirmado y las consultas del chat.
`POST /tasks` no espera al modelo: anota el pedido, devuelve un `job_id` y
un worker del mismo proceso corre el grafo. El estado se lee con
`GET /tasks/{job_id}`.

## Cómo levantarla

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env
docker compose up -d
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Redis 8 (RedisJSON y RediSearch) guarda la cola y los checkpoints.
`GET /health` responde `{"status":"ok"}` cuando Redis contesta.
La documentación interactiva queda en <http://localhost:8000/docs>.

## Rutas

El `user_id` sale del JWT. Un recurso de otra persona responde 404.

| Método | Ruta | Qué hace |
| --- | --- | --- |
| POST | `/auth/registro`, `/auth/login` | Sesión |
| GET | `/resumen?desde&hasta` | Totales del libro, sin anulados |
| POST | `/documentos` | Borrador. Guarda los bytes originales |
| POST | `/documentos/{id}/confirmar` | Entra al libro y después indexa |
| GET | `/documentos/{id}/archivo` | Bytes y `Content-Type` |
| DELETE | `/documentos/{id}` | Descarta un borrador propio |
| POST | `/documentos/{id}/anular` | Lo saca del resumen y de las consultas |
| POST | `/documentos/{id}/corregir` | Actualiza el confirmado y suma el cambio |
| GET | `/export?desde&hasta` | CSV de confirmados no anulados |
| POST | `/tasks` | Encola una consulta |
| POST | `/tasks/{id}/approve` | Reanuda una pausa |
| GET | `/hilos`, `/hilos/{thread_id}` | Historial de esa persona |

Si el índice falla al confirmar, la respuesta es 200 y `indexado` queda
`error`. El comprobante ya está en el libro. Si no hay módulo de indexación,
`indexado` es `omitido`.

Un job `FAILED` deja en `result` una frase corta. No va el mensaje de la
excepción ni una clave `error`.

## Pausas

Pagar arma un borrador (`Borrador: {id}`) para revisar antes de entrar al
libro. Otra acción con efecto se anota y el texto dice `Acción registrada`.
Rechazar no escribe nada y la respuesta empieza con `Rechazado`.

## Topes

Por día UTC, con Redis: `MAX_CARGAS_DIA` (30) en `POST /documentos` y
`MAX_CONSULTAS_DIA` (50) en `POST /tasks`. Al pasar el tope, 429. Si Redis
no puede contar, se registra y el pedido sigue.

## Prueba sin LLM

```bash
python -m pytest tests/test_flujo.py tests/test_extraccion.py tests/test_aislamiento.py
```
