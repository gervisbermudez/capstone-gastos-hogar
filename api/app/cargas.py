"""Cola de comprobantes. El POST guarda el archivo y responde; esto extrae.

Corre al lado del worker del chat, en otra tarea del lifespan, para que
un PDF no deje una consulta esperando.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from .archivos import borrar_pendiente, leer_pendiente
from .canal import emitir
from .extraccion import DETALLE_MODELO, ArchivoRechazado, ErrorDeModelo
from .ingesta import recibir

logger = logging.getLogger(__name__)

QUEUE_KEY = "gastos:cargas:queue"
DATA_PREFIX = "gastos:cargas:data:"

RECIBIDA = "recibida"
EXTRAYENDO = "extrayendo"
LISTA = "lista"
FALLA = "falla"

MENSAJE_FALLA = "No se pudo cargar el comprobante."
MENSAJE_CORTE = "La carga se interrumpió. Volvé a subir el archivo."


def ahora() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def data_key(job_id: str) -> str:
    return f"{DATA_PREFIX}{job_id}"


def publico(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "fase": job["fase"],
        "documento_id": job.get("documento_id"),
        "mensaje": job.get("mensaje"),
    }


def _notificacion(job: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    fase = job.get("fase")
    user_id = str(job.get("user_id") or "")
    job_id = str(job.get("job_id") or "")
    if fase == LISTA and job.get("documento_id"):
        return (
            {
                "titulo": "Borrador listo",
                "cuerpo": "Quedó en borradores para que lo revises.",
                "accion": {
                    "etiqueta": "Revisar",
                    "ruta": f"/documentos/{job['documento_id']}",
                },
            },
            f"{user_id}:carga.estado:job:{job_id}:lista",
        )
    if fase == FALLA:
        return (
            {
                "titulo": "No se pudo cargar",
                "cuerpo": str(job.get("mensaje") or MENSAJE_FALLA),
                "accion": {"etiqueta": "Volver a cargar", "ruta": "/cargar"},
            },
            f"{user_id}:carga.estado:job:{job_id}:falla",
        )
    return None, None


async def guardar(redis, job: dict[str, Any]) -> None:
    job["updated_at"] = ahora()
    await redis.set(data_key(job["job_id"]), json.dumps(job, ensure_ascii=False))
    await _avisar(redis, job)


async def leer(redis, job_id: str) -> dict[str, Any] | None:
    crudo = await redis.get(data_key(job_id))
    if not crudo:
        return None
    if isinstance(crudo, bytes):
        crudo = crudo.decode()
    return json.loads(crudo)


async def _avisar(redis, job: dict[str, Any]) -> None:
    user_id = job.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        return
    notificacion, dedupe = _notificacion(job)
    try:
        await emitir(
            redis,
            user_id=user_id,
            tipo="carga.estado",
            recurso={"clase": "job", "id": str(job["job_id"])},
            payload=publico(job),
            notificacion=notificacion,
            dedupe=dedupe,
        )
    except Exception:
        logger.warning("No se pudo avisar la carga %s", job.get("job_id"))


async def crear_carga(redis, job_id: str, user_id: str) -> dict[str, Any]:
    """Persiste ``recibida`` antes de encolar. Un poll inmediato no da 404."""
    job = {
        "job_id": job_id,
        "user_id": user_id,
        "fase": RECIBIDA,
        "documento_id": None,
        "mensaje": None,
        "error": None,
        "created_at": ahora(),
        "updated_at": ahora(),
    }
    await guardar(redis, job)
    await redis.rpush(QUEUE_KEY, job_id)
    return job


async def _fallar(redis, job: dict[str, Any], mensaje: str, error: str) -> None:
    await borrar_pendiente(str(job.get("user_id") or ""), str(job["job_id"]))
    job["fase"] = FALLA
    job["mensaje"] = mensaje
    job["error"] = error
    job["documento_id"] = None
    await guardar(redis, job)


async def procesar_carga(redis, job_id: str) -> None:
    job = await leer(redis, job_id)
    if job is None:
        logger.error("Carga %s no está en Redis. No se procesa.", job_id)
        return
    if job.get("fase") in {LISTA, FALLA}:
        return
    user_id = str(job.get("user_id") or "")
    if not user_id:
        await _fallar(redis, job, MENSAJE_FALLA, "sin usuario")
        return

    job["fase"] = EXTRAYENDO
    job["mensaje"] = None
    job["error"] = None
    await guardar(redis, job)

    try:
        datos = await leer_pendiente(user_id, job_id)
        if not datos:
            await _fallar(redis, job, "Falta el archivo.", "sin archivo")
            return
        cuerpo = await recibir(datos, user_id=user_id)
        documento_id = str(cuerpo["id"])
        await borrar_pendiente(user_id, job_id)
    except ArchivoRechazado as exc:
        await _fallar(redis, job, exc.detail, "ArchivoRechazado")
        return
    except ErrorDeModelo:
        await _fallar(redis, job, DETALLE_MODELO, "ErrorDeModelo")
        return
    except Exception as exc:
        logger.warning("Carga %s falló: %s", job_id, type(exc).__name__)
        await _fallar(redis, job, MENSAJE_FALLA, type(exc).__name__)
        return

    job["fase"] = LISTA
    job["documento_id"] = documento_id
    job["mensaje"] = None
    job["error"] = None
    await guardar(redis, job)
    logger.info("Carga %s lista", job_id)


async def marcar_cortadas(redis) -> int:
    """Una ``extrayendo`` al arrancar murió a mitad de camino. No se reencola."""
    cortadas = 0
    async for clave in redis.scan_iter(match=f"{DATA_PREFIX}*"):
        crudo = await redis.get(clave)
        if not crudo:
            continue
        if isinstance(crudo, bytes):
            crudo = crudo.decode()
        job = json.loads(crudo)
        if job.get("fase") != EXTRAYENDO:
            continue
        await borrar_pendiente(str(job.get("user_id") or ""), str(job.get("job_id") or ""))
        job["fase"] = FALLA
        job["mensaje"] = MENSAJE_CORTE
        job["error"] = "reinicio"
        job["documento_id"] = None
        await guardar(redis, job)
        cortadas += 1
        logger.warning("Carga %s quedó en falla por un reinicio", job.get("job_id"))
    return cortadas


async def worker_cargas(redis, stop: asyncio.Event) -> None:
    logger.info("Cargas escuchando %s", QUEUE_KEY)
    while not stop.is_set():
        try:
            item = await redis.blpop(QUEUE_KEY, timeout=1)
        except TimeoutError:
            continue
        except Exception as exc:
            logger.error("Cargas no pudo leer la cola: %s", type(exc).__name__)
            await asyncio.sleep(1)
            continue
        if not item:
            continue
        _, job_id = item
        if isinstance(job_id, bytes):
            job_id = job_id.decode()
        try:
            await procesar_carga(redis, job_id)
        except Exception as exc:
            logger.error("Carga %s no se pudo procesar: %s", job_id, type(exc).__name__)
