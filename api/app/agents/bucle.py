"""Corre una corrutina desde un nodo síncrono.

El lifespan compila el grafo con ``RedisSaver``. Ese saver no implementa
``aget_tuple``, así que el worker sigue en ``graph.invoke`` dentro de un
hilo. La llamada al modelo igual es ``ainvoke``: ese hilo no tiene un loop.
"""

from __future__ import annotations

import asyncio
import contextvars
import threading
from collections.abc import Coroutine
from typing import TypeVar

T = TypeVar("T")

usuario_del_turno: contextvars.ContextVar[str] = contextvars.ContextVar(
    "gastos_user_id",
    default="",
)


def correr_async(coro: Coroutine[object, object, T]) -> T:
    """Corre la corrutina en un contexto vacío.

    El nodo ya está dentro de ``graph.invoke``. Si se copia ese contexto,
    el agente interno hereda el ``RedisSaver`` del grafo padre y llama a
    ``aget_tuple``, que ese saver no implementa.
    """
    contexto = contextvars.Context()

    def _ejecutar() -> T:
        return contexto.run(asyncio.run, coro)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _ejecutar()

    caja: dict[str, object] = {}

    def _en_otro_hilo() -> None:
        try:
            caja["valor"] = _ejecutar()
        except BaseException as exc:
            caja["error"] = exc

    hilo = threading.Thread(target=_en_otro_hilo)
    hilo.start()
    hilo.join()
    if "error" in caja:
        raise caja["error"]  # type: ignore[misc]
    return caja["valor"]  # type: ignore[return-value]
