"""Corre una corrutina desde un nodo síncrono.

El worker corre el grafo con ``ainvoke`` y ``AsyncRedisSaver``. Esos nodos
siguen siendo síncronos: ``ainvoke`` los ejecuta igual. La llamada al modelo
sigue siendo ``ainvoke``, en un loop de este hilo, porque el nodo no es una
corrutina.
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

    El nodo corre dentro de ``graph.ainvoke``, que copia el contexto del
    grafo al hilo del nodo. Si el agente interno hereda ese contexto, usa
    el ``AsyncRedisSaver`` del grafo padre y llama a ``aget_tuple`` desde
    otro loop: el cliente de Redis de ese saver vive en el loop de la API.
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
