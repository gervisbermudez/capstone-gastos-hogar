"""Sesión, cuenta y resumen. El SQL vive en el repositorio."""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import ValidationError

from . import archivos, auth, rag, repositorio
from .auth import usuario_actual
from .cache_resumen import guardar, invalidar, leer
from .esquemas import (
    BajaCuenta,
    CambioEmail,
    CambioPassword,
    Credenciales,
    RangoResumen,
    Resumen,
    Token,
    UsuarioActual,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_NO_AUTENTICADO = {"WWW-Authenticate": "Bearer"}
_CLAVE_DISTINTA = "La contraseña no coincide."


async def _exigir_clave(user_id: str, password: str) -> None:
    fila = await repositorio.buscar_usuario_por_id(user_id)
    if fila is None:
        raise HTTPException(status_code=401, detail="No autenticado", headers=_NO_AUTENTICADO)
    coincide = await asyncio.to_thread(auth.verificar, password, fila["password_hash"])
    if not coincide:
        raise HTTPException(status_code=401, detail=_CLAVE_DISTINTA)


def _aviso(mensaje: str, exc: Exception) -> None:
    logger.warning("%s (%s).", mensaje, type(exc).__name__)


@router.post("/auth/registro", response_model=Token, status_code=201)
async def registro(body: Credenciales) -> Token:
    try:
        password_hash = await asyncio.to_thread(auth.hashear, body.password)
        user_id = await repositorio.crear_usuario(body.email, password_hash)
    except repositorio.EmailDuplicado:
        raise HTTPException(status_code=409, detail="Ese email ya está registrado") from None
    return Token(
        access_token=auth.emitir_token(user_id),
        token_type="bearer",
        user_id=user_id,
    )


@router.post("/auth/login", response_model=Token)
async def login(body: Credenciales) -> Token:
    usuario = await repositorio.buscar_usuario_por_email(body.email)
    guardado = usuario["password_hash"] if usuario else await asyncio.to_thread(auth.hash_falso)
    coincide = await asyncio.to_thread(auth.verificar, body.password, guardado)
    if usuario is None or not coincide:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    return Token(
        access_token=auth.emitir_token(usuario["user_id"]),
        token_type="bearer",
        user_id=usuario["user_id"],
    )


@router.get("/auth/me", response_model=UsuarioActual)
async def me(usuario: Annotated[dict, Depends(usuario_actual)]) -> UsuarioActual:
    return UsuarioActual(user_id=usuario["user_id"], email=usuario["email"])


@router.post("/auth/email", response_model=UsuarioActual)
async def cambiar_email(
    body: CambioEmail,
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> UsuarioActual:
    user_id = usuario["user_id"]
    await _exigir_clave(user_id, body.password)
    try:
        correo = await repositorio.actualizar_email(user_id=user_id, email=body.email)
    except repositorio.EmailDuplicado:
        raise HTTPException(status_code=409, detail="Ese email ya está registrado") from None
    return UsuarioActual(user_id=user_id, email=correo)


@router.post("/auth/password", status_code=204)
async def cambiar_password(
    body: CambioPassword,
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> Response:
    user_id = usuario["user_id"]
    await _exigir_clave(user_id, body.password_actual)
    password_hash = await asyncio.to_thread(auth.hashear, body.password_nueva)
    await repositorio.actualizar_password_hash(user_id=user_id, password_hash=password_hash)
    return Response(status_code=204)


@router.delete("/auth/cuenta", status_code=204)
async def borrar_cuenta(
    body: BajaCuenta,
    request: Request,
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> Response:
    user_id = usuario["user_id"]
    await _exigir_clave(user_id, body.password)
    await repositorio.eliminar_usuario(user_id=user_id)
    try:
        await archivos.borrar_directorio_usuario(user_id)
    except Exception as exc:
        _aviso("No se pudieron borrar los archivos de la cuenta", exc)
    try:
        await asyncio.to_thread(rag.olvidar_usuario, user_id)
    except Exception as exc:
        _aviso("No se pudo olvidar el índice de la cuenta", exc)
    try:
        await invalidar(getattr(request.app.state, "redis", None), user_id)
    except Exception as exc:
        _aviso("No se pudo invalidar la caché de la cuenta", exc)
    return Response(status_code=204)


@router.get("/resumen", response_model=Resumen)
async def ver_resumen(
    request: Request,
    rango: Annotated[RangoResumen, Query()],
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> Resumen:
    user_id = usuario["user_id"]
    redis = getattr(request.app.state, "redis", None)
    cacheado = await leer(redis, user_id, rango.desde, rango.hasta)
    if cacheado is not None:
        try:
            return Resumen.model_validate(cacheado)
        except ValidationError:
            logger.warning("La caché del resumen no tenía la forma del contrato.")
    datos = await repositorio.resumen(user_id=user_id, desde=rango.desde, hasta=rango.hasta)
    modelo = Resumen.model_validate(datos)
    await guardar(redis, user_id, rango.desde, rango.hasta, modelo.model_dump(mode="json"))
    return modelo
