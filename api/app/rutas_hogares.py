"""Hogares y miembros. El SQL vive en el repositorio."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual

logger = logging.getLogger(__name__)
from .esquemas import (
    AltaMiembro,
    HogarDatos,
    HogarItem,
    ListaHogares,
    ListaMiembros,
    MiembroItem,
)

router = APIRouter(tags=["hogares"])

_NO_HOGAR = "No existe ese hogar"
_NO_EMAIL = "No existe una cuenta con ese email"
_YA_MIEMBRO = "Esa persona ya es miembro del hogar"
_NO_MIEMBRO = "No existe ese miembro"
_NO_QUITAR_ADMIN = "No se puede quitar al administrador"
_NO_DEJAR_ADMIN = "No se puede dejar un hogar que administrás"


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


def _etiqueta_persona(cuenta: dict | None) -> str:
    if not isinstance(cuenta, dict):
        return "Alguien"
    nombre = cuenta.get("nombre")
    if isinstance(nombre, str) and nombre.strip():
        return nombre.strip()
    email = cuenta.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip()
    return "Alguien"


async def _avisar_membresia(
    request: Request,
    *,
    destinatario_id: str,
    actor_id: str,
    hogar_id: str,
    alta: bool,
) -> None:
    """Avisa a la otra persona. Un fallo no deshace la membresía."""
    redis = getattr(request.app.state, "redis", None)
    if redis is None or not destinatario_id or destinatario_id == actor_id:
        return
    try:
        from .canal import emitir

        hogares = await repositorio.listar_hogares(actor_id)
        nombre = next(
            (item["nombre"] for item in hogares if item["id"] == hogar_id and item.get("nombre")),
            "un hogar",
        )
        if alta:
            quien = _etiqueta_persona(await repositorio.buscar_usuario_por_id(actor_id))
            titulo = "Te sumaron a un hogar"
            cuerpo = f"{quien} te sumó a {nombre} como asociado."
            accion = {"etiqueta": "Ver hogar", "ruta": f"/opciones?hogar={hogar_id}#hogar"}
            cambio = "alta"
        else:
            titulo = "Te quitaron de un hogar"
            cuerpo = f"Ya no pertenecés a {nombre}."
            accion = {"etiqueta": "Ver hogares", "ruta": "/opciones#hogar"}
            cambio = "baja"
        await emitir(
            redis,
            user_id=destinatario_id,
            tipo="hogar.membresia",
            recurso={"clase": "hogar", "id": hogar_id},
            payload={"hogar_id": hogar_id, "nombre": nombre, "cambio": cambio},
            notificacion={"titulo": titulo, "cuerpo": cuerpo, "accion": accion},
        )
    except Exception:
        logger.warning("No se pudo avisar la membresía %s", hogar_id)


async def _avisar_salida(request: Request, *, actor_id: str, hogar_id: str) -> None:
    """Avisa al administrador. Un fallo no deshace la salida."""
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        return
    try:
        from .canal import emitir

        admin_id = await repositorio.administrador_id(hogar_id)
        if not admin_id or admin_id == actor_id:
            return
        hogares = await repositorio.listar_hogares(admin_id)
        nombre = next(
            (item["nombre"] for item in hogares if item["id"] == hogar_id and item.get("nombre")),
            "un hogar",
        )
        quien = _etiqueta_persona(await repositorio.buscar_usuario_por_id(actor_id))
        await emitir(
            redis,
            user_id=admin_id,
            tipo="hogar.membresia",
            recurso={"clase": "hogar", "id": hogar_id},
            payload={"hogar_id": hogar_id, "nombre": nombre, "cambio": "baja"},
            notificacion={
                "titulo": "Alguien se desasoció",
                "cuerpo": f"{quien} se desasoció de {nombre}.",
                "accion": {
                    "etiqueta": "Ver hogar",
                    "ruta": f"/opciones?hogar={hogar_id}#hogar",
                },
            },
        )
    except Exception:
        logger.warning("No se pudo avisar la salida %s", hogar_id)


@router.get("/hogares", response_model=ListaHogares)
async def listar_hogares(usuario: dict = Depends(usuario_actual)) -> ListaHogares:
    items = await repositorio.listar_hogares(_user_id(usuario))
    return ListaHogares.model_validate({"items": items})


@router.post("/hogares", status_code=201, response_model=HogarItem)
async def crear_hogar(
    body: HogarDatos,
    usuario: dict = Depends(usuario_actual),
) -> HogarItem:
    fila = await repositorio.crear_hogar(
        user_id=_user_id(usuario),
        nombre=body.nombre,
        direccion=body.direccion,
    )
    return HogarItem.model_validate(fila)


@router.patch("/hogares/{id}", response_model=HogarItem)
async def actualizar_hogar(
    id: str,
    body: HogarDatos,
    usuario: dict = Depends(usuario_actual),
) -> HogarItem:
    fila = await repositorio.actualizar_hogar(
        user_id=_user_id(usuario),
        hogar_id=id,
        nombre=body.nombre,
        direccion=body.direccion,
    )
    if fila is None:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    return HogarItem.model_validate(fila)


@router.get("/hogares/{id}/miembros", response_model=ListaMiembros)
async def listar_miembros(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> ListaMiembros:
    items = await repositorio.listar_miembros(user_id=_user_id(usuario), hogar_id=id)
    if items is None:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    return ListaMiembros.model_validate({"items": items})


@router.post("/hogares/{id}/miembros", status_code=201, response_model=MiembroItem)
async def agregar_miembro(
    id: str,
    body: AltaMiembro,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> MiembroItem:
    actor_id = _user_id(usuario)
    try:
        fila = await repositorio.agregar_miembro(
            user_id=actor_id,
            hogar_id=id,
            email=body.email,
        )
    except repositorio.HogarNoEncontrado:
        raise HTTPException(status_code=404, detail=_NO_HOGAR) from None
    except repositorio.EmailInexistente:
        raise HTTPException(status_code=404, detail=_NO_EMAIL) from None
    except repositorio.MiembroDuplicado:
        raise HTTPException(status_code=409, detail=_YA_MIEMBRO) from None
    await _avisar_membresia(
        request,
        destinatario_id=str(fila["user_id"]),
        actor_id=actor_id,
        hogar_id=id,
        alta=True,
    )
    return MiembroItem.model_validate(fila)


@router.delete("/hogares/{id}/miembros/{user_id}", status_code=204)
async def quitar_miembro(
    id: str,
    user_id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    actor_id = _user_id(usuario)
    try:
        ok = await repositorio.quitar_miembro(
            user_id=actor_id,
            hogar_id=id,
            miembro_id=user_id,
        )
    except repositorio.AdministradorNoRemovible:
        raise HTTPException(status_code=409, detail=_NO_QUITAR_ADMIN) from None
    if not ok:
        raise HTTPException(status_code=404, detail=_NO_MIEMBRO)
    await _avisar_membresia(
        request,
        destinatario_id=user_id,
        actor_id=actor_id,
        hogar_id=id,
        alta=False,
    )
    return Response(status_code=204)


@router.delete("/hogares/{id}/membresia", status_code=204)
async def dejar_hogar(
    id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    actor_id = _user_id(usuario)
    try:
        ok = await repositorio.dejar_hogar(user_id=actor_id, hogar_id=id)
    except repositorio.AdministradorNoRemovible:
        raise HTTPException(status_code=409, detail=_NO_DEJAR_ADMIN) from None
    if not ok:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    await _avisar_salida(request, actor_id=actor_id, hogar_id=id)
    return Response(status_code=204)
