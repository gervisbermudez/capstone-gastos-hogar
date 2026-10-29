"""Corre una corrutina desde un nodo síncrono.

El lifespan compila el grafo con ``RedisSaver``. Ese saver no implementa
``aget_tuple``, así que el worker sigue en ``graph.invoke`` dentro de un
hilo. La llamada al modelo igual es ``ainvoke``: ese hilo no tiene un loop
mientras corre el grafo.
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
hogar_del_turno: contextvars.ContextVar[str] = contextvars.ContextVar(
    "gastos_hogar_id",
    default="",
)

_loop_del_hilo = threading.local()


def _loop_abierto() -> asyncio.AbstractEventLoop:
    """Un loop por hilo, y no se cierra entre nodos.

    ``asyncio.run`` cierra el loop al terminar. El cliente HTTP del modelo
    queda atado a ese loop y el nodo siguiente revienta con
    ``Event loop is closed`` al cerrar la respuesta.
    """
    loop = getattr(_loop_del_hilo, "loop", None)
    if loop is None or loop.is_closed():
        loop = asyncio.new_event_loop()
        _loop_del_hilo.loop = loop
    return loop


def correr_async(coro: Coroutine[object, object, T]) -> T:
    """Corre la corrutina en un contexto vacío.

    El nodo ya está dentro de ``graph.invoke``. Si se copia ese contexto,
    el agente interno hereda el ``RedisSaver`` del grafo padre y llama a
    ``aget_tuple``, que ese saver no implementa.
    """
    contexto = contextvars.Context()

    def _ejecutar() -> T:
        loop = _loop_abierto()
        asyncio.set_event_loop(loop)
        return contexto.run(loop.run_until_complete, coro)

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
