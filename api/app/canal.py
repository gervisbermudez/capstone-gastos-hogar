"""Canal de sesión. Cualquier módulo publica con ``emitir``.

Redis reparte el JSON. Si viene una notificación, se guarda en SQLite
antes de publicar: un cliente que se conecta después la lee por HTTP.
Si ese insert falla, el evento igual sale y la bandeja no lleva esa fila.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from . import repositorio

logger = logging.getLogger(__name__)

PREFIJO = "gastos:usuarios:"
SUFIJO = ":eventos"
_CANAL_SALA = "gastos:sala:latido"


def canal_usuario(user_id: str) -> str:
    return f"{PREFIJO}{user_id}{SUFIJO}"


def user_de_canal(canal: str) -> str | None:
    if not canal.startswith(PREFIJO) or not canal.endswith(SUFIJO):
        return None
    medio = canal[len(PREFIJO) : -len(SUFIJO)]
    return medio or None


def origen_del_socket(websocket: WebSocket) -> bool:
    """Mismo origen que el CORS. El navegador no manda el header Bearer."""
    permitido = os.getenv("FRONTEND_ORIGIN", "").strip().rstrip("/")
    origen = (websocket.headers.get("origin") or "").rstrip("/")
    return bool(permitido) and origen == permitido


def _aviso_publico(fila: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": fila["id"],
        "titulo": fila["titulo"],
        "cuerpo": fila["cuerpo"],
        "accion": fila.get("accion"),
        "creada_en": fila["creada_en"],
    }


async def emitir(
    redis,
    *,
    user_id: str,
    tipo: str,
    recurso: dict[str, str],
    payload: dict[str, Any],
    notificacion: dict[str, Any] | None = None,
    dedupe: str | None = None,
) -> dict[str, Any]:
    """Publica un evento. Con ``notificacion``, persiste la bandeja primero.

    ``dedupe`` repetido no crea otra fila. El evento igual sale, con el id
    de la fila que ya estaba. Si esa fila se limpió de la bandeja, el
    evento sale sin notificación. Si el insert falla, ``notificacion``
    sale en null y el evento igual se publica.
    """
    if not user_id or not tipo:
        raise ValueError("evento incompleto")
    clase = str(recurso.get("clase") or "")
    recurso_id = str(recurso.get("id") or "")
    if not clase or not recurso_id:
        raise ValueError("recurso incompleto")

    aviso = None
    creado_en = datetime.now(timezone.utc).isoformat()
    if notificacion is not None:
        accion = notificacion.get("accion") if isinstance(notificacion.get("accion"), dict) else None
        etiqueta = accion.get("etiqueta") if accion else None
        ruta = accion.get("ruta") if accion else None
        try:
            fila = await repositorio.insertar_notificacion(
                user_id=user_id,
                tipo=tipo,
                titulo=str(notificacion.get("titulo") or ""),
                cuerpo=str(notificacion.get("cuerpo") or ""),
                accion_etiqueta=str(etiqueta) if etiqueta else None,
                accion_ruta=str(ruta) if ruta else None,
                recurso_clase=clase,
                recurso_id=recurso_id,
                dedupe=dedupe,
            )
        except Exception:
            logger.warning("No se pudo guardar la notificación %s de %s", tipo, user_id)
        else:
            if not fila.get("descartada"):
                aviso = _aviso_publico(fila)
                creado_en = str(aviso["creada_en"])

    evento = {
        "id": str(uuid.uuid4()),
        "tipo": tipo,
        "creado_en": creado_en,
        "recurso": {"clase": clase, "id": recurso_id},
        "payload": payload,
        "notificacion": aviso,
    }
    try:
        await redis.publish(canal_usuario(user_id), json.dumps(evento, ensure_ascii=False))
    except Exception:
        logger.warning("No se pudo publicar el evento %s de %s", tipo, user_id)
    return evento


class Sala:
    """Un pubsub por proceso. Cada pestaña del usuario es un socket más."""

    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = {}
        self._redis: Any = None
        self._pubsub: Any = None
        self._tarea: asyncio.Task[None] | None = None
        self._ordenes: asyncio.Queue[tuple[Any, ...]] = asyncio.Queue()
        self._lock = asyncio.Lock()
        self._cerrada = False

    async def arrancar(self, redis) -> None:
        self._redis = redis
        self._pubsub = redis.pubsub()
        await self._pubsub.subscribe(_CANAL_SALA)
        self._tarea = asyncio.create_task(self._escuchar())

    async def cerrar(self) -> None:
        self._cerrada = True
        tarea = self._tarea
        self._tarea = None
        if tarea is not None:
            tarea.cancel()
            try:
                await tarea
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.warning("La sala no cerró el bucle de avisos")
        pubsub = self._pubsub
        self._pubsub = None
        if pubsub is not None:
            try:
                await pubsub.aclose()
            except Exception:
                logger.warning("No se pudo cerrar el pubsub de la sala")

    async def unir(self, user_id: str, websocket: WebSocket) -> None:
        canal = canal_usuario(user_id)
        async with self._lock:
            primero = not self._sockets.get(user_id)
            self._sockets.setdefault(user_id, set()).add(websocket)
        if primero:
            await self._pedir("sub", canal)

    async def salir(self, user_id: str, websocket: WebSocket) -> None:
        canal = canal_usuario(user_id)
        ultimo = False
        async with self._lock:
            grupo = self._sockets.get(user_id)
            if not grupo:
                return
            grupo.discard(websocket)
            if not grupo:
                del self._sockets[user_id]
                ultimo = True
        if ultimo and not self._cerrada:
            await self._pedir("unsub", canal)

    async def _pedir(self, orden: str, canal: str) -> None:
        if self._cerrada or self._pubsub is None:
            return
        futuro: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        await self._ordenes.put((orden, canal, futuro))
        await futuro

    async def _escuchar(self) -> None:
        assert self._pubsub is not None
        while not self._cerrada:
            await self._aplicar_ordenes()
            try:
                mensaje = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=0.2,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("La sala no pudo leer Redis")
                await asyncio.sleep(1)
                continue
            if not mensaje or mensaje.get("type") != "message":
                continue
            canal = mensaje.get("channel")
            if isinstance(canal, bytes):
                canal = canal.decode()
            if not isinstance(canal, str):
                continue
            user_id = user_de_canal(canal)
            if user_id is None:
                continue
            data = mensaje.get("data")
            if isinstance(data, bytes):
                data = data.decode()
            if not isinstance(data, str):
                continue
            try:
                evento = json.loads(data)
            except json.JSONDecodeError:
                continue
            if not isinstance(evento, dict):
                continue
            await self._entregar(user_id, evento)

    async def _aplicar_ordenes(self) -> None:
        assert self._pubsub is not None
        while True:
            try:
                orden, canal, futuro = self._ordenes.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                if orden == "sub":
                    await self._pubsub.subscribe(canal)
                else:
                    await self._pubsub.unsubscribe(canal)
                if not futuro.done():
                    futuro.set_result(None)
            except Exception as exc:
                if not futuro.done():
                    futuro.set_exception(exc)

    async def _entregar(self, user_id: str, evento: dict[str, Any]) -> None:
        async with self._lock:
            destinatarios = list(self._sockets.get(user_id) or ())
        muertos: list[WebSocket] = []
        for websocket in destinatarios:
            try:
                await websocket.send_json(evento)
            except Exception:
                muertos.append(websocket)
        if not muertos:
            return
        async with self._lock:
            grupo = self._sockets.get(user_id)
            if not grupo:
                return
            for websocket in muertos:
                grupo.discard(websocket)
