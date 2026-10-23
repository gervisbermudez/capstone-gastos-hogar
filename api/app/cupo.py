"""Tope diario en UTC. Redis INCR + expire. Si contar falla, se deja pasar."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

logger = logging.getLogger(__name__)

DETALLE_CARGAS = "Llegaste al tope de cargas de hoy."
DETALLE_CONSULTAS = "Llegaste al tope de consultas de hoy."

_DETALLES = {"cargas": DETALLE_CARGAS, "consultas": DETALLE_CONSULTAS}


def _limite(tipo: str) -> int:
    variable = "MAX_CARGAS_DIA" if tipo == "cargas" else "MAX_CONSULTAS_DIA"
    defecto = 30 if tipo == "cargas" else 50
    crudo = os.getenv(variable, "").strip()
    if not crudo:
        return defecto
    try:
        numero = int(crudo)
    except ValueError:
        return defecto
    if numero < 1:
        return defecto
    return numero


def _segundos_hasta_medianoche_utc() -> int:
    ahora = datetime.now(timezone.utc)
    manana = datetime.combine(
        ahora.date() + timedelta(days=1),
        datetime.min.time(),
        tzinfo=timezone.utc,
    )
    return max(1, int((manana - ahora).total_seconds()))


async def exigir_cupo(redis, user_id: str, tipo: str) -> None:
    """Cuenta una carga o una consulta. 429 si pasa el tope del día UTC.

    ``redis`` en None, o un INCR que revienta, se loguea y no frena el pedido.
    """
    if tipo not in _DETALLES or not user_id:
        return
    if redis is None:
        logger.warning("No se pudo contar el tope de %s. Se deja pasar.", tipo)
        return
    try:
        limite = _limite(tipo)
        dia = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        clave = f"gastos:cupo:{tipo}:{user_id}:{dia}"
        valor = int(await redis.incr(clave))
    except Exception as exc:
        logger.warning("No se pudo contar el tope de %s: %s", tipo, type(exc).__name__)
        return
    try:
        if valor == 1:
            await redis.expire(clave, _segundos_hasta_medianoche_utc())
    except Exception as exc:
        logger.warning("No se pudo expirar el tope de %s: %s", tipo, type(exc).__name__)
    if valor > limite:
        raise HTTPException(status_code=429, detail=_DETALLES[tipo])
