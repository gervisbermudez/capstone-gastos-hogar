# Implementación de producto

Este plan parte la revisión de Gastos del hogar en frentes con archivos distintos. No reemplaza a `FUENTE-DE-LA-VERDAD.md`. Ese archivo no se edita. Las rutas y campos de abajo son extensiones: lo que ya responde la API sigue respondiendo igual, salvo los dos cambios de comportamiento marcados.

Fuera de este plan: hogar compartido, OAuth, recuperar clave, commits y secretos.

## Frentes

| Frente | Dueño | Archivos | Espera a |
| --- | --- | --- | --- |
| Tablero | agente de presentación | `frontend/src/formato.ts`, `pantallas/Tablero.tsx`, `componentes/GraficosResumen.tsx`, `componentes/MarcoPrivado.tsx`, `pantallas/FormularioAcceso.tsx`, `pantallas/Registro.tsx` | nada |
| Chat | agente de chat | `frontend/src/pantallas/Chat.tsx`, `frontend/src/almacen.ts` | nada |
| API | agente de API | `capstone/api/**` y `capstone/api/README.md` | nada |
| Cableado | orquestador, después | `frontend/src/api/cliente.ts`, `frontend/src/api/tipos.ts`, `pantallas/Revision.tsx`, y solo los botones nuevos en Tablero y Chat | los tres anteriores |

El tablero y el chat de esta ola no agregan llamadas a rutas nuevas. No tocan `cliente.ts` ni `tipos.ts`.

## Tablero

- Montos visibles con `Intl` en `es-AR` (`18500.50` + `ARS` → `$ 18.500,50`). Los gráficos siguen leyendo `total` de `GET /resumen`. No se suman montos en el navegador. Solo se formatea el texto.
- Badges «Borrador» y «Confirmado».
- Filtro de categoría solo sobre la lista de confirmados. Los gráficos quedan del período completo, con una frase que lo dice.
- Vacíos con acción que lleva a `#cargar-comprobante`.
- Si no hay borradores ni confirmados, tres pasos: cargar, revisar, preguntar.
- Nav con estado activo (`aria-current`) en Tablero y Chat.
- Email con `type="email"`. En el registro, «Usá una frase larga.»

## Chat

- El transcript del hilo vive en `sessionStorage` y vuelve al recargar.
- Se guarda el job en curso, no solo el de aprobación. Al volver se retoma `PENDING`, `RUNNING` y `AWAITING_APPROVAL`.
- `olvidarSesion` también borra transcript y job.
- La ficha de aprobación lee estas líneas si están, y si no muestra el texto crudo:

```
Acción: ...
Motivo: ...
Pedido: ...
Datos: ...
```

- `[comprobante {id}]` y `Borrador: {id}` son enlaces a `/documentos/{id}`.
- El texto de ayuda dice que los montos salen de lo confirmado y que el texto de la factura sale del índice.

## API

CORS suma `DELETE`. El resto de los métodos nuevos es `GET` o `POST`.

### Sin clave nueva en el JSON de tareas

- Un job `FAILED` deja en `result` una frase corta en español. No va el mensaje de la excepción, ni secretos, ni una clave `error`.
- La pausa formatea `result` así, y el `interrupt` sigue trayendo una `pregunta` que contiene «aprob»:

```
Acción: se va a crear un borrador para que lo revises antes de entrar al libro.
Motivo: ...
Pedido: ...
Datos: categoria=expensas periodo=2026-03 monto=18500.50
```

Si no es un pago:

```
Acción: queda registrada. No entra al libro.
Motivo: ...
Pedido: ...
```

- Aprobar un pago llama a `guardar_borrador`. No llama a `asentar_pago`. La acción resultante incluye `Borrador: {id}`. Si faltan categoría, período o monto, no se escribe nada y la acción lo dice.
- Un efecto que no es pago sigue escribiendo el jsonl de avisos. El texto deja de decir RRHH. El rechazo sigue empezando con `Rechazado`. `test_flujo.py` se actualiza a la frase nueva `Acción registrada`.
- Título de FastAPI, docstring de `app/__init__.py` y `api/README.md` hablan de gastos del hogar.

### Rutas nuevas

- `DELETE /documentos/{id}` → `204` si es un borrador o un confirmado de esa persona, también si está anulado. `404` si no existe o es de otra persona. Borra la fila, el archivo y los chunks de ese comprobante.
- `GET /documentos/{id}/archivo` → bytes y `Content-Type`. `404` si no hay archivo o es de otra persona. El token va en `Authorization`, no en la query.
- `POST /documentos/{id}/anular` → el comprobante confirmado queda fuera de `GET /resumen` y de `consultar_gastos`. `anulado: true` en el JSON. Un borrador responde `404`.
- `POST /documentos/{id}/corregir` con una `Factura` → actualiza el confirmado y guarda el antes y el después. No recalcula en el cliente.
- `GET /hilos` → `{ "items": [ { "thread_id", "titulo", "actualizado_en" } ] }` de esa persona, máximo 30.
- `GET /hilos/{thread_id}` → `{ "thread_id", "mensajes": [ { "rol", "texto", "creado_en" } ] }`. `404` si el hilo es de otra persona. `rol` es `persona`, `asistente` o `nota`.
- `GET /export?desde=YYYY-MM&hasta=YYYY-MM` → CSV de confirmados no anulados. Columnas: id, proveedor, categoria, periodo, monto, moneda, numero_comprobante.

### Campos opcionales

En un confirmado, sin romper los que ya están:

- `anulado`: boolean, default `false`.
- `indexado`: `ok`, `error` u `omitido`.
- `cambios`: lista de `{ "campo", "antes", "despues" }` entre lo extraído y lo confirmado. En el listado puede ir vacía.

Al confirmar se escribe el libro y después se indexa. Si el índice falla, la respuesta es `200`, `indexado` es `error` y el comprobante queda confirmado. El cuerpo y el log no incluyen el mensaje de la excepción. Hay que actualizar `test_indexar_que_falla_deja_el_borrador`. Si no existe el módulo de indexación, `indexado` es `omitido` y sigue el `200`.

El archivo de la carga se guarda en disco bajo `api/data/archivos/{user_id}/{id}`. Columnas nuevas nullable, para no romper los `INSERT` actuales. Migración con `ALTER TABLE` idempotente.

Tope diario, en UTC, con Redis: `MAX_CARGAS_DIA` (30) y `MAX_CONSULTAS_DIA` (50). `429` con `Llegaste al tope de cargas de hoy.` o `Llegaste al tope de consultas de hoy.` Si el contador de Redis falla, se registra y se deja pasar.

El worker anota cada consulta y cada cierre (`DONE`, `FAILED`, `AWAITING_APPROVAL`) en SQLite, filtrando por `user_id`.
