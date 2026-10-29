"""Historial del chat de una persona: listar, archivar y eliminar."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual
from .esquemas import HiloDetalle, ListaHilos

router = APIRouter(tags=["hilos"])

_NO_EXISTE = "No existe ese hilo"


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


@router.get("/hilos", response_model=ListaHilos)
async def listar_hilos(
    archivados: bool = Query(default=False),
    usuario: dict = Depends(usuario_actual),
) -> ListaHilos:
    items = await repositorio.listar_hilos(
        user_id=_user_id(usuario),
        archivados=archivados,
    )
    return ListaHilos.model_validate({"items": items})


@router.get("/hilos/{thread_id}", response_model=HiloDetalle)
async def ver_hilo(
    thread_id: str,
    usuario: dict = Depends(usuario_actual),
) -> HiloDetalle:
    datos = await repositorio.obtener_hilo(user_id=_user_id(usuario), thread_id=thread_id)
    if datos is None:
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return HiloDetalle.model_validate(datos)


@router.post("/hilos/{thread_id}/archivar", status_code=204)
async def archivar_hilo(
    thread_id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    if not await repositorio.archivar_hilo(user_id=_user_id(usuario), thread_id=thread_id):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)


@router.post("/hilos/{thread_id}/desarchivar", status_code=204)
async def desarchivar_hilo(
    thread_id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    if not await repositorio.desarchivar_hilo(user_id=_user_id(usuario), thread_id=thread_id):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)


@router.delete("/hilos/{thread_id}", status_code=204)
async def eliminar_hilo(
    thread_id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    if not await repositorio.eliminar_hilo(user_id=_user_id(usuario), thread_id=thread_id):
        raise HTTPException(status_code=404, detail=_NO_EXISTE)
    return Response(status_code=204)
