"""Caché de ``GET /resumen``. Un fallo de Redis no cambia el status ni el cuerpo.

La clave lleva el ``hogar_id``. Confirmar, anular, corregir, borrar y asentar
un pago borran las claves de ese hogar.
"""

from __future__ import annotations

import json
import logging
import re

from .periodo import PERIODO as _PERIODO

logger = logging.getLogger(__name__)

TTL_SEGUNDOS = 60
PREFIJO = "gastos:resumen:"

_IDENTIFICADOR = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

_cliente = None


def publicar_redis(redis) -> None:
    """El cliente del lifespan. ``asentar_pago`` no recibe el de la request."""
    global _cliente
    _cliente = redis


def clave(hogar_id: str, desde: str, hasta: str) -> str | None:
    if _IDENTIFICADOR.fullmatch(hogar_id) is None:
        return None
    if _PERIODO.fullmatch(desde) is None or _PERIODO.fullmatch(hasta) is None:
        return None
    return f"{PREFIJO}{hogar_id}:{desde}:{hasta}"


async def leer(redis, hogar_id: str, desde: str, hasta: str) -> dict | None:
    nombre = clave(hogar_id, desde, hasta)
    if redis is None or nombre is None:
        return None
    try:
        crudo = await redis.get(nombre)
    except Exception as exc:
        logger.warning("No se pudo leer la caché del resumen: %s", type(exc).__name__)
        return None
    if not crudo:
        return None
    try:
        if isinstance(crudo, bytes):
            crudo = crudo.decode()
        datos = json.loads(crudo)
    except (TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(datos, dict):
        return None
    return datos


async def guardar(redis, hogar_id: str, desde: str, hasta: str, datos: dict) -> None:
    nombre = clave(hogar_id, desde, hasta)
    if redis is None or nombre is None:
        return
    try:
        await redis.set(nombre, json.dumps(datos, ensure_ascii=False), ex=TTL_SEGUNDOS)
    except Exception as exc:
        logger.warning("No se pudo guardar la caché del resumen: %s", type(exc).__name__)


async def invalidar(redis, hogar_id: str) -> None:
    if redis is None or _IDENTIFICADOR.fullmatch(hogar_id or "") is None:
        return
    patron = f"{PREFIJO}{hogar_id}:*"
    try:
        claves: list[str] = []
        async for item in redis.scan_iter(match=patron):
            texto = item.decode() if isinstance(item, bytes) else item
            if isinstance(texto, str):
                claves.append(texto)
        if claves:
            await redis.delete(*claves)
    except Exception as exc:
        logger.warning("No se pudo invalidar la caché del resumen: %s", type(exc).__name__)


async def invalidar_publicado(hogar_id: str) -> None:
    await invalidar(_cliente, hogar_id)
