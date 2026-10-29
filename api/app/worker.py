"""Cola Redis y worker que corre el grafo fuera del request.

El POST guarda el estado PENDING y recién ahí hace RPUSH. El worker saca
el id, pasa a RUNNING y ejecuta el grafo en un hilo: el checkpointer del
lifespan es RedisSaver, síncrono, y ``ainvoke`` no puede usarlo. Las
llamadas al modelo, adentro del grafo, sí son ``ainvoke``.

Si el grafo se pausa, el estado queda AWAITING_APPROVAL. Si revienta,
queda FAILED: el cliente no se queda esperando para siempre.

Cada guardado avisa por Redis al canal del job. El chat escucha ese
canal por un WebSocket, en vez de preguntar el estado cada segundo.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from opentelemetry import trace

from .graph import config_hilo, estado_inicial
from .texto import extraer_texto

logger = logging.getLogger(__name__)

QUEUE_KEY = "gastos:jobs:queue"
DATA_PREFIX = "gastos:jobs:data:"
EVENT_PREFIX = "gastos:jobs:events:"
RESUME_PREFIX = "gastos:jobs:resume-once:"
THREAD_PREFIX = "gastos:threads:"
# Si el aviso se pierde, el stream relee Redis al cumplirse esta espera.
ESPERA_AVISO = 5.0

PENDING = "PENDING"
RUNNING = "RUNNING"
AWAITING_APPROVAL = "AWAITING_APPROVAL"
FAILED = "FAILED"
DONE = "DONE"

# Frase pública. El tipo de la excepción queda en Redis, en ``error``, no acá.
RESULTADO_FALLO = "La consulta no se pudo completar. Probá de nuevo en un rato."

_HILO = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
_candados: dict[str, asyncio.Lock] = {}


class HiloInvalido(ValueError):
    """El cliente mandó un thread_id que no vamos a usar como clave de Redis."""


def ahora() -> str:
    return datetime.now(timezone.utc).isoformat()


def data_key(job_id: str) -> str:
    return f"{DATA_PREFIX}{job_id}"


def event_channel(job_id: str) -> str:
    return f"{EVENT_PREFIX}{job_id}"


def resume_key(job_id: str) -> str:
    return f"{RESUME_PREFIX}{job_id}"


def hilo_valido(thread_id: str) -> bool:
    return _HILO.fullmatch(thread_id) is not None


def es_del_usuario(job: dict[str, Any] | None, user_id: str) -> bool:
    if not job or not user_id:
        return False
    return job.get("user_id") == user_id


def _candado(thread_id: str) -> asyncio.Lock:
    candado = _candados.get(thread_id)
    if candado is None:
        candado = asyncio.Lock()
        _candados[thread_id] = candado
    return candado


def _recorte(valor: object, n: int = 160) -> str:
    plano = " ".join(str(valor or "").split())
    if len(plano) <= n:
        return plano
    return plano[: n - 1].rstrip() + "…"


def _notificacion_de_chat(job: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Bandeja solo al cerrar o al pedir aprobación. El resto es estado en vivo."""
    status = job.get("status")
    user_id = str(job.get("user_id") or "")
    job_id = str(job.get("job_id") or "")
    thread_id = str(job.get("thread_id") or "")
    if status == DONE:
        ruta = f"/chat?hilo={quote(thread_id, safe='')}" if thread_id else "/chat"
        cuerpo = _recorte(job.get("result")) or "La respuesta ya está en el chat."
        return (
            {
                "titulo": "Respuesta lista",
                "cuerpo": cuerpo,
                "accion": {"etiqueta": "Ver respuesta", "ruta": ruta},
            },
            f"{user_id}:chat.estado:job:{job_id}:DONE",
        )
    if status == FAILED:
        return (
            {
                "titulo": "La consulta no se pudo completar",
                "cuerpo": RESULTADO_FALLO,
                "accion": {"etiqueta": "Reintentar", "ruta": "/chat"},
            },
            f"{user_id}:chat.estado:job:{job_id}:FAILED",
        )
    if status == AWAITING_APPROVAL:
        if thread_id:
            ruta = f"/chat?hilo={quote(thread_id, safe='')}&job={quote(job_id, safe='')}"
        else:
            ruta = f"/chat?job={quote(job_id, safe='')}"
        cuerpo = _recorte(job.get("result")) or "Hay una acción pendiente de tu decisión."
        return (
            {
                "titulo": "Hay algo para revisar",
                "cuerpo": cuerpo,
                "accion": {"etiqueta": "Revisar", "ruta": ruta},
            },
            f"{user_id}:chat.estado:job:{job_id}:AWAITING_APPROVAL",
        )
    return None, None


async def _avisar_sesion(redis, job: dict[str, Any]) -> None:
    user_id = job.get("user_id")
    if not isinstance(user_id, str) or not user_id or not job.get("job_id"):
        return
    notificacion, dedupe = _notificacion_de_chat(job)
    try:
        from .canal import emitir

        await emitir(
            redis,
            user_id=user_id,
            tipo="chat.estado",
            recurso={"clase": "job", "id": str(job["job_id"])},
            payload=publico(job),
            notificacion=notificacion,
            dedupe=dedupe,
        )
    except Exception:
        logger.warning("No se pudo avisar la sesión del job %s", job.get("job_id"))


async def guardar(redis, job: dict[str, Any]) -> None:
    job["updated_at"] = ahora()
    await redis.set(data_key(job["job_id"]), json.dumps(job, ensure_ascii=False))
    # El SET ya quedó. Un publish fallido solo atrasa el aviso: el stream relee.
    try:
        await redis.publish(event_channel(job["job_id"]), str(job.get("status") or ""))
    except Exception:
        logger.warning("No se pudo avisar el cambio del job %s", job.get("job_id"))
    await _avisar_sesion(redis, job)


async def leer(redis, job_id: str) -> dict[str, Any] | None:
    crudo = await redis.get(data_key(job_id))
    if not crudo:
        return None
    return json.loads(crudo)


async def actualizar(redis, job_id: str, **cambios: Any) -> dict[str, Any] | None:
    job = await leer(redis, job_id)
    if job is None:
        return None
    job.update(cambios)
    await guardar(redis, job)
    return job


def _plano(valor: object) -> str:
    return " ".join(str(valor or "").split())


def texto_de_pausa(payload: dict[str, Any] | None) -> str:
    """Texto de ``AWAITING_APPROVAL``. ``Datos`` solo si están los tres campos."""
    datos = payload if isinstance(payload, dict) else {}
    if datos.get("efecto") == "borrador":
        accion = "Acción: se va a crear un borrador para que lo revises antes de sumarlo a tus gastos."
    else:
        accion = "Acción: queda registrada. No se suma a tus gastos."
    lineas = [
        accion,
        f"Motivo: {_plano(datos.get('motivo'))}",
        f"Pedido: {_plano(datos.get('pedido'))}",
    ]
    crudos = datos.get("datos") if isinstance(datos.get("datos"), dict) else None
    if crudos:
        categoria = crudos.get("categoria")
        periodo = crudos.get("periodo")
        monto = crudos.get("monto")
        if categoria and periodo and monto:
            lineas.append(
                f"Datos: Categoría {_plano(categoria)}, período {_plano(periodo)}, monto {_plano(monto)}"
            )
    return "\n".join(lineas)


async def _anotar(user_id: str, thread_id: str, rol: str, texto: str) -> None:
    if not user_id or not thread_id:
        return
    try:
        from .repositorio import anotar_mensaje

        await anotar_mensaje(
            user_id=user_id,
            thread_id=thread_id,
            rol=rol,
            texto=texto if isinstance(texto, str) else "",
        )
    except Exception as exc:
        logger.warning("No se pudo anotar el hilo: %s", type(exc).__name__)


def publico(job: dict[str, Any]) -> dict[str, Any]:
    """Forma de ``TareaEstado``. El error y el interrupt quedan en Redis."""
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "thread_id": job.get("thread_id") or job["job_id"],
        "result": job.get("result"),
    }


_CIERRA_STREAM = frozenset({DONE, FAILED, AWAITING_APPROVAL})


async def _esperar_aviso(pubsub, segundos: float) -> bool:
    """True si alguien publicó. False si se cumplió la espera.

    El ack de SUBSCRIBE vuelve enseguida como ``None`` y no cuenta como espera.
    """
    limite = asyncio.get_running_loop().time() + segundos
    while True:
        restante = limite - asyncio.get_running_loop().time()
        if restante <= 0:
            return False
        try:
            mensaje = await pubsub.get_message(ignore_subscribe_messages=True, timeout=restante)
        except TimeoutError:
            return False
        if mensaje is None:
            continue
        if mensaje.get("type") == "message":
            return True


async def eventos_job(
    redis,
    job_id: str,
    *,
    espera: float = ESPERA_AVISO,
) -> AsyncIterator[dict[str, Any] | None]:
    """Estados públicos del job, en el momento en que cambian.

    El primer valor es el estado actual. ``None`` es un latido. Termina en
    ``DONE``, ``FAILED`` o ``AWAITING_APPROVAL``. Si el job desaparece, termina
    sin emitir nada más.
    """
    pubsub = redis.pubsub()
    await pubsub.subscribe(event_channel(job_id))
    try:
        ultimo: tuple[Any, Any] | None = None
        while True:
            job = await leer(redis, job_id)
            if job is None:
                return
            actual = publico(job)
            firma = (actual["status"], actual.get("result"))
            if firma != ultimo:
                ultimo = firma
                yield actual
                if actual["status"] in _CIERRA_STREAM:
                    return
            if await _esperar_aviso(pubsub, espera):
                continue
            yield None
    finally:
        try:
            await pubsub.aclose()
        except Exception:
            logger.warning("No se pudo cerrar el aviso del job %s", job_id)


async def reclamar_hilo(redis, user_id: str, thread_id: str | None) -> str | None:
    """Ata el hilo a esta persona. None si ya es de otra. El id nuevo es un UUID."""
    if not user_id:
        return None
    if thread_id is None:
        thread_id = str(uuid.uuid4())
    elif not hilo_valido(thread_id):
        raise HiloInvalido(thread_id)
    clave = f"{THREAD_PREFIX}{thread_id}"
    nuevo = await redis.set(clave, user_id, nx=True)
    if nuevo:
        return thread_id
    dueno = await redis.get(clave)
    if dueno == user_id:
        return thread_id
    return None


async def crear_job(
    redis,
    job_id: str,
    query: str,
    *,
    user_id: str,
    thread_id: str,
) -> dict[str, Any]:
    """Persiste PENDING antes de encolar. Si no, un poll temprano da 404."""
    job = {
        "job_id": job_id,
        "status": PENDING,
        "query": query,
        "result": None,
        "error": None,
        "interrupt": None,
        "accion": None,
        "critica": None,
        "motivo_critico": None,
        "contribuciones": [],
        "action": "start",
        "aprobado": None,
        "user_id": user_id,
        "thread_id": thread_id,
        "created_at": ahora(),
        "updated_at": ahora(),
    }
    await guardar(redis, job)
    await redis.rpush(QUEUE_KEY, job_id)
    return job


async def encolar_reanudacion(redis, job_id: str, aprobado: bool) -> str:
    """Devuelve ``encolado`` si pasó a la cola. Si no, el estado actual o ``missing``."""
    job = await leer(redis, job_id)
    if job is None:
        return "missing"
    if job["status"] != AWAITING_APPROVAL:
        return job["status"]

    # Una sola reanudación. Dos clics no disparan dos efectos.
    reservado = await redis.set(resume_key(job_id), "si" if aprobado else "no", nx=True)
    if not reservado:
        return job["status"]

    job["status"] = PENDING
    job["action"] = "resume"
    job["aprobado"] = aprobado
    job["interrupt"] = None
    job["error"] = None
    try:
        await guardar(redis, job)
        await redis.rpush(QUEUE_KEY, job_id)
    except Exception:
        await redis.delete(resume_key(job_id))
        raise
    return "encolado"


async def marcar_cortados(redis) -> int:
    """Un RUNNING al arrancar es un job que murió a mitad de camino.

    No se reencola: volver a invocar el mismo hilo puede repetir el efecto.
    AWAITING_APPROVAL se deja como está: el checkpoint sigue en Redis
    y el approve reanuda después de un reinicio.
    """
    cortados = 0
    async for clave in redis.scan_iter(match=f"{DATA_PREFIX}*"):
        crudo = await redis.get(clave)
        if not crudo:
            continue
        job = json.loads(crudo)
        if job.get("status") != RUNNING:
            continue
        job["status"] = FAILED
        job["error"] = (
            "El worker se reinició mientras corría esta tarea. Enviá un pedido nuevo."
        )
        job["result"] = RESULTADO_FALLO
        await guardar(redis, job)
        await _anotar(
            str(job.get("user_id") or ""),
            str(job.get("thread_id") or ""),
            "nota",
            RESULTADO_FALLO,
        )
        cortados += 1
        logger.warning("Job %s quedó FAILED por un reinicio", job["job_id"])
    return cortados


def extraer_interrupt(snapshot) -> dict[str, Any] | None:
    interrupciones = list(getattr(snapshot, "interrupts", None) or [])
    if not interrupciones:
        for tarea in getattr(snapshot, "tasks", ()) or ():
            interrupciones.extend(getattr(tarea, "interrupts", ()) or ())
    if interrupciones:
        valor = interrupciones[0].value
        if isinstance(valor, dict):
            return valor
        return {"pregunta": str(valor)}
    if getattr(snapshot, "next", ()):
        return {"pregunta": "El grafo está pausado esperando aprobación."}
    return None


def _correr(graph, entrada, config, user_id: str, *, reanudar: bool) -> tuple[Any, dict[str, Any] | None]:
    """Corre en un hilo. La pausa humana no es un fallo: el checkpoint queda en Redis."""
    previo = graph.get_state(config)
    dueno = (getattr(previo, "values", None) or {}).get("user_id")
    if dueno and dueno != user_id:
        raise PermissionError("El hilo no pertenece a esta sesión.")
    if not reanudar and getattr(previo, "next", ()):
        raise RuntimeError("Hay una aprobación pendiente en este hilo.")

    tracer = trace.get_tracer("gastos.worker")
    resultado = None
    with tracer.start_as_current_span("ejecutar_tarea") as span:
        span.set_attribute("job.id", config["metadata"]["job_id"])
        span.set_attribute("session.id", config["configurable"]["thread_id"])
        span.set_attribute("enduser.id", user_id)
        try:
            resultado = graph.invoke(entrada, config)
        except _pausas():
            logger.info("Grafo en pausa para %s", config["configurable"]["thread_id"])
        return graph.get_state(config), _interrupt_en_resultado(resultado)


def _pausas():
    try:
        from langgraph.errors import GraphInterrupt
    except ImportError:
        return (type("GraphInterrupt", (Exception,), {}),)
    return (GraphInterrupt,)


def _interrupt_en_resultado(resultado: Any) -> dict[str, Any] | None:
    if not isinstance(resultado, dict) or "__interrupt__" not in resultado:
        return None
    bruto = resultado["__interrupt__"]
    item = bruto[0] if isinstance(bruto, (list, tuple)) and bruto else bruto
    valor = getattr(item, "value", item)
    if isinstance(valor, dict):
        return valor
    return {"pregunta": str(valor)}


async def procesar(redis, graph, job_id: str) -> None:
    job = await leer(redis, job_id)
    if job is None:
        logger.error("Job %s no está en Redis. No se procesa.", job_id)
        return

    thread_id = job.get("thread_id")
    user_id = job.get("user_id")
    if not thread_id or not user_id:
        await actualizar(
            redis,
            job_id,
            status=FAILED,
            error="El job no tiene hilo o usuario.",
            result=RESULTADO_FALLO,
        )
        return

    try:
        async with _candado(thread_id):
            config = config_hilo(thread_id, job_id=job_id)
            reanudar = job.get("action") == "resume"
            if not reanudar:
                await _anotar(user_id, thread_id, "persona", str(job.get("query") or ""))
            if reanudar:
                from langgraph.types import Command

                decision = "si" if job.get("aprobado") else "no"
                entrada: Any = Command(resume=decision)
            else:
                entrada = estado_inicial(job["query"], user_id)

            snapshot, interrupt_directo = await asyncio.to_thread(
                _correr,
                graph,
                entrada,
                config,
                user_id,
                reanudar=reanudar,
            )
    except Exception as exc:
        logger.exception("Job %s falló", job_id)
        await _anotar(user_id, thread_id, "nota", RESULTADO_FALLO)
        await actualizar(
            redis,
            job_id,
            status=FAILED,
            error=type(exc).__name__,
            result=RESULTADO_FALLO,
        )
        return

    payload = extraer_interrupt(snapshot) or interrupt_directo
    if getattr(snapshot, "next", ()) or payload:
        motivo = (payload or {}).get("motivo") or ""
        texto = texto_de_pausa(payload)
        await _anotar(user_id, thread_id, "nota", texto)
        await actualizar(
            redis,
            job_id,
            status=AWAITING_APPROVAL,
            interrupt=payload,
            critica=True,
            motivo_critico=motivo or None,
            error=None,
            result=texto,
        )
        logger.info("Job %s esperando aprobación: %s", job_id, motivo)
        return

    values = snapshot.values or {}
    mensajes = values.get("messages") or []
    respuesta = extraer_texto(mensajes[-1]) if mensajes else ""
    await _anotar(user_id, thread_id, "asistente", respuesta or "")
    await actualizar(
        redis,
        job_id,
        status=DONE,
        result=respuesta,
        error=None,
        interrupt=None,
        accion=values.get("accion") or None,
        critica=bool(values.get("critica")),
        motivo_critico=values.get("motivo_critico"),
        contribuciones=list(values.get("contribuciones") or []),
    )
    logger.info("Job %s terminó", job_id)


async def worker_loop(redis, graph, stop: asyncio.Event) -> None:
    concurrencia = max(1, int(os.getenv("WORKER_CONCURRENCY", "4")))
    semaforo = asyncio.Semaphore(concurrencia)
    tareas: set[asyncio.Task] = set()
    logger.info("Worker escuchando %s (concurrencia %s)", QUEUE_KEY, concurrencia)

    async def _uno(job_id: str) -> None:
        async with semaforo:
            await procesar(redis, graph, job_id)

    while not stop.is_set():
        try:
            item = await redis.blpop(QUEUE_KEY, timeout=1)
        except TimeoutError:
            continue
        except Exception as exc:
            logger.error("Worker no pudo leer la cola: %s", type(exc).__name__)
            await asyncio.sleep(1)
            continue
        if not item:
            continue
        _, job_id = item
        if isinstance(job_id, bytes):
            job_id = job_id.decode()
        try:
            await actualizar(redis, job_id, status=RUNNING, error=None)
        except Exception as exc:
            logger.error("Worker no pudo marcar RUNNING %s: %s", job_id, type(exc).__name__)
            try:
                job = await leer(redis, job_id)
                if job:
                    await _anotar(
                        str(job.get("user_id") or ""),
                        str(job.get("thread_id") or ""),
                        "nota",
                        RESULTADO_FALLO,
                    )
                await actualizar(
                    redis,
                    job_id,
                    status=FAILED,
                    error="Redis no pudo actualizar el job.",
                    result=RESULTADO_FALLO,
                )
            except Exception as fallo:
                logger.error("Worker no pudo marcar FAILED %s: %s", job_id, type(fallo).__name__)
            continue
        tarea = asyncio.create_task(_uno(job_id))
        tareas.add(tarea)
        tarea.add_done_callback(tareas.discard)

    if tareas:
        await asyncio.wait(tareas, timeout=10)
