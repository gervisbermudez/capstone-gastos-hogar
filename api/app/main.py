"""API que encola una consulta y devuelve el job_id al instante.

POST /tasks no corre el agente. GET /tasks/{id} lee Redis.
POST /tasks/{id}/approve reanuda un hilo que quedó pausado.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import redis.asyncio as aioredis
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import repositorio
from .auth import usuario_actual
from .cupo import exigir_cupo
from .esquemas import (
    Aprobacion,
    ConsultaTarea,
    HiloDetalle,
    ListaHilos,
    TareaCreada,
    TareaEstado,
)
from .graph import construir_grafo
from .observability import init_observability
from .worker import (
    PENDING,
    HiloInvalido,
    crear_job,
    encolar_reanudacion,
    es_del_usuario,
    leer,
    marcar_cortados,
    reclamar_hilo,
    worker_loop,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _id_usuario(usuario: object) -> str:
    """``usuario_actual`` devuelve el user_id del claim ``sub``."""
    if isinstance(usuario, dict):
        valor = usuario.get("user_id") or usuario.get("sub")
    elif isinstance(usuario, str):
        valor = usuario
    else:
        valor = getattr(usuario, "user_id", None) or getattr(usuario, "sub", None)
    if not isinstance(valor, str) or not valor.strip():
        raise HTTPException(status_code=401, detail="No autenticado")
    return valor.strip()


def _abrir_checkpointer(url: str):
    from langgraph.checkpoint.redis import RedisSaver

    contexto = RedisSaver.from_conn_string(url)
    saver = contexto.__enter__()
    try:
        saver.setup()
    except Exception:
        contexto.__exit__(*sys.exc_info())
        raise
    return contexto, saver


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_observability()
    cliente = aioredis.from_url(REDIS_URL, decode_responses=True)
    app.state.redis = cliente
    try:
        await cliente.ping()
    except Exception as exc:
        await cliente.aclose()
        raise RuntimeError(
            f"Redis no responde en {REDIS_URL}. Levantalo con `docker compose up -d`."
        ) from exc

    try:
        contexto, saver = await asyncio.to_thread(_abrir_checkpointer, REDIS_URL)
    except Exception as exc:
        await cliente.aclose()
        raise RuntimeError(
            "No pude crear los índices del checkpointer en Redis. "
            "Hace falta Redis 8 o Redis Stack (RedisJSON y RediSearch). "
            f"Detalle: {exc}"
        ) from exc

    app.state.graph = construir_grafo(saver)
    app.state.checkpointer_cm = contexto
    cortados = await marcar_cortados(cliente)
    if cortados:
        logger.warning("%s jobs quedaron FAILED porque el worker se había cortado.", cortados)

    stop = asyncio.Event()
    tarea = asyncio.create_task(worker_loop(cliente, app.state.graph, stop))
    try:
        yield
    finally:
        stop.set()
        try:
            await asyncio.wait_for(tarea, timeout=15)
        except asyncio.TimeoutError:
            tarea.cancel()
        await cliente.aclose()
        contexto.__exit__(None, None, None)


app = FastAPI(
    title="Gastos del hogar",
    summary="Carga comprobantes, confirma el libro y consulta los gastos.",
    version="1.0.0",
    lifespan=lifespan,
)


def _origenes_permitidos() -> list[str]:
    """Un solo origen, el de FRONTEND_ORIGIN. Vacío o * no habilita a nadie."""
    origen = os.getenv("FRONTEND_ORIGIN", "").strip().rstrip("/")
    if not origen or origen == "*":
        return []
    return [origen]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_origenes_permitidos(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
async def raiz() -> dict[str, str]:
    return {"docs": "/docs", "health": "/health"}


@app.get("/health")
async def health() -> dict[str, str]:
    try:
        await app.state.redis.ping()
    except Exception:
        logger.warning("health: Redis no responde")
        raise HTTPException(status_code=503, detail="Redis no responde") from None
    return {"status": "ok"}


@app.post("/tasks", status_code=202, response_model=TareaCreada)
async def crear_tarea(
    consulta: ConsultaTarea,
    usuario: Annotated[object, Depends(usuario_actual)],
) -> TareaCreada:
    user_id = _id_usuario(usuario)
    await exigir_cupo(app.state.redis, user_id, "consultas")
    try:
        thread_id = await reclamar_hilo(app.state.redis, user_id, consulta.thread_id)
    except HiloInvalido:
        raise HTTPException(status_code=422, detail="thread_id inválido") from None
    if thread_id is None:
        raise HTTPException(status_code=404, detail="No existe ese hilo")
    job_id = str(uuid.uuid4())
    # El estado queda escrito antes del RPUSH. Un poll inmediato no da 404.
    # No se espera al modelo: el worker corre el grafo.
    job = await crear_job(
        app.state.redis,
        job_id,
        consulta.query,
        user_id=user_id,
        thread_id=thread_id,
    )
    return TareaCreada(job_id=job["job_id"], status="PENDING", thread_id=job["thread_id"])


@app.get("/tasks/{job_id}", response_model=TareaEstado)
async def ver_tarea(
    job_id: str,
    usuario: Annotated[object, Depends(usuario_actual)],
) -> TareaEstado:
    user_id = _id_usuario(usuario)
    job = await leer(app.state.redis, job_id)
    if not es_del_usuario(job, user_id):
        raise HTTPException(status_code=404, detail="No existe ese job_id")
    return TareaEstado(
        job_id=job["job_id"],
        status=job["status"],
        thread_id=job["thread_id"],
        result=job.get("result"),
    )


@app.post("/tasks/{job_id}/approve", status_code=202)
async def aprobar(
    job_id: str,
    decision: Aprobacion,
    usuario: Annotated[object, Depends(usuario_actual)],
) -> dict[str, str]:
    user_id = _id_usuario(usuario)
    job = await leer(app.state.redis, job_id)
    if not es_del_usuario(job, user_id):
        raise HTTPException(status_code=404, detail="No existe ese job_id")
    resultado = await encolar_reanudacion(app.state.redis, job_id, decision.aprobado)
    if resultado == "missing":
        raise HTTPException(status_code=404, detail="No existe ese job_id")
    if resultado != "encolado":
        raise HTTPException(
            status_code=409,
            detail=f"El job está en {resultado} y no espera aprobación.",
        )
    return {"job_id": job_id, "status": PENDING}


@app.get("/hilos", response_model=ListaHilos)
async def listar_hilos(
    usuario: Annotated[object, Depends(usuario_actual)],
) -> ListaHilos:
    user_id = _id_usuario(usuario)
    items = await repositorio.listar_hilos(user_id=user_id)
    return ListaHilos.model_validate({"items": items})


@app.get("/hilos/{thread_id}", response_model=HiloDetalle)
async def ver_hilo(
    thread_id: str,
    usuario: Annotated[object, Depends(usuario_actual)],
) -> HiloDetalle:
    user_id = _id_usuario(usuario)
    datos = await repositorio.obtener_hilo(user_id=user_id, thread_id=thread_id)
    if datos is None:
        raise HTTPException(status_code=404, detail="No existe ese hilo")
    return HiloDetalle.model_validate(datos)


def _montar_router(modulo: str) -> None:
    """Incluye el router de un módulo hermano si ese agente ya lo creó.

    Datos escribe ``rutas_auth`` e ingesta escribe ``rutas_documentos``.
    No reescriben este archivo.
    """
    try:
        cargado = importlib.import_module(modulo, package=__package__)
    except ModuleNotFoundError:
        return
    router = getattr(cargado, "router", None)
    if router is not None:
        app.include_router(router)


_montar_router(".rutas_auth")
_montar_router(".rutas_documentos")
