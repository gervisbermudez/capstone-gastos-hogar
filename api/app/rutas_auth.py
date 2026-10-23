"""Sesión y resumen. El SQL vive en el repositorio."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from . import auth, repositorio
from .auth import usuario_actual
from .esquemas import Credenciales, RangoResumen, Resumen, Token, UsuarioActual

router = APIRouter()


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


@router.get("/resumen", response_model=Resumen)
async def ver_resumen(
    rango: Annotated[RangoResumen, Query()],
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> Resumen:
    datos = await repositorio.resumen(
        user_id=usuario["user_id"],
        desde=rango.desde,
        hasta=rango.hasta,
    )
    return Resumen.model_validate(datos)
