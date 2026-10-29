"""Historial del chat de un hogar. Solo lo usa el administrador."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual
from .esquemas import HiloDetalle, ListaHilos

router = APIRouter(tags=["hilos"])

_NO_EXISTE = "No existe ese hilo"
_NO_HOGAR = "No existe ese hogar"
_NO_CHAT = "Solo el administrador puede usar el chat"


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


async def exigir_administrador_del_hogar(user_id: str, hogar_id: str | None) -> str:
    """El header o el hogar por defecto. 404 si no es miembro. 403 si es asociado."""
    elegido = (hogar_id or "").strip()
    if not elegido:
        elegido = await repositorio.hogar_por_defecto(user_id) or ""
    if not elegido:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    rol = await repositorio.membresia(user_id, elegido)
    if rol is None:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    if rol != "administrador":
        raise HTTPException(status_code=403, detail=_NO_CHAT)
    return elegido


async def _sesion(
    usuario: dict = Depends(usuario_actual),
    x_hogar_id: Annotated[str | None, Header(alias="X-Hogar-Id")] = None,
) -> tuple[str, str]:
    user_id = _user_id(usuario)
    return user_id, await exigir_administrador_del_hogar(user_id, x_hogar_id)


@router.get("/hilos", response_model=ListaHilos)
async def listar_hilos(
    archivados: bool = Query(default=False),
    sesion: tuple[str, str] = Depends(_sesion),
) -> ListaHilos:
    user_id, hogar_id = sesion
    items = await repositorio.listar_hilos(
        user_id=user_id,
        archivados=archivados,
        hogar_id=hogar_id,
    )
    return ListaHilos.model_validate({"items": items})


@router.get("/hilos/{thread_id}", response_model=HiloDetalle)
async def ver_hilo(
    thread_id: str,
    sesion: tuple[str, str] = Depends(_sesion),
) -> HiloDetalle:
    user_id, hogar_id = sesion
    datos = await repositorio.obtener_hilo(
        user_id=user_id,
        thread_id=thread_id,
        hogar_id=hogar_id,
    )
    if datos is None:
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return HiloDetalle.model_validate(datos)


@router.post("/hilos/{thread_id}/archivar", status_code=204)
async def archivar_hilo(
    thread_id: str,
    sesion: tuple[str, str] = Depends(_sesion),
) -> Response:
    user_id, hogar_id = sesion
    if not await repositorio.archivar_hilo(
        user_id=user_id,
        thread_id=thread_id,
        hogar_id=hogar_id,
    ):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)


@router.post("/hilos/{thread_id}/desarchivar", status_code=204)
async def desarchivar_hilo(
    thread_id: str,
    sesion: tuple[str, str] = Depends(_sesion),
) -> Response:
    user_id, hogar_id = sesion
    if not await repositorio.desarchivar_hilo(
        user_id=user_id,
        thread_id=thread_id,
        hogar_id=hogar_id,
    ):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)


@router.delete("/hilos/{thread_id}", status_code=204)
async def eliminar_hilo(
    thread_id: str,
    sesion: tuple[str, str] = Depends(_sesion),
) -> Response:
    user_id, hogar_id = sesion
    if not await repositorio.eliminar_hilo(
        user_id=user_id,
        thread_id=thread_id,
        hogar_id=hogar_id,
    ):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)
