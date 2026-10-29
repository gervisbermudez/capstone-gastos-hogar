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
    CambioNombre,
    CambioPassword,
    Credenciales,
    Registro,
    ModeloActivo,
    RangoResumen,
    Resumen,
    Token,
    UsuarioActual,
)
from .llm import describir_modelo

logger = logging.getLogger(__name__)

router = APIRouter()

_NO_AUTENTICADO = {"WWW-Authenticate": "Bearer"}
_CLAVE_DISTINTA = "La contraseña no coincide."
_NO_HOGAR = "No existe ese hogar"


async def _contexto_hogar(request: Request, user_id: str) -> tuple[str, str]:
    """Header ``X-Hogar-Id`` o el hogar que administra. 404 si no es miembro."""
    crudo = request.headers.get("x-hogar-id")
    pedido = crudo.strip() if isinstance(crudo, str) else ""
    if pedido:
        hogar_id: str | None = pedido
    else:
        hogar_id = await repositorio.hogar_por_defecto(user_id)
    if not hogar_id:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    rol = await repositorio.membresia(user_id, hogar_id)
    if rol is None:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    return hogar_id, rol


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
async def registro(body: Registro) -> Token:
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
    return UsuarioActual(
        user_id=usuario["user_id"],
        email=usuario["email"],
        nombre=usuario["nombre"],
    )


@router.get("/auth/modelo", response_model=ModeloActivo)
async def ver_modelo(_usuario: Annotated[dict, Depends(usuario_actual)]) -> ModeloActivo:
    datos = describir_modelo()
    return ModeloActivo(proveedor=datos["proveedor"], modelo=datos["modelo"])


@router.post("/auth/nombre", response_model=UsuarioActual)
async def cambiar_nombre(
    body: CambioNombre,
    usuario: Annotated[dict, Depends(usuario_actual)],
) -> UsuarioActual:
    nombre = await repositorio.actualizar_nombre(user_id=usuario["user_id"], nombre=body.nombre)
    return UsuarioActual(
        user_id=usuario["user_id"],
        email=usuario["email"],
        nombre=nombre,
    )


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
    return UsuarioActual(user_id=user_id, email=correo, nombre=usuario["nombre"])


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
    hogares = await repositorio.listar_hogares(user_id)
    try:
        await repositorio.eliminar_usuario(user_id=user_id)
    except repositorio.HogarOcupado:
        raise HTTPException(
            status_code=409,
            detail=(
                "No se puede borrar la cuenta mientras seas administrador "
                "de un hogar con otros miembros"
            ),
        ) from None
    try:
        await archivos.borrar_directorio_usuario(user_id)
    except Exception as exc:
        _aviso("No se pudieron borrar los archivos de la cuenta", exc)
    try:
        await asyncio.to_thread(rag.olvidar_usuario, user_id)
    except Exception as exc:
        _aviso("No se pudo olvidar el índice de la cuenta", exc)
    try:
        redis = getattr(request.app.state, "redis", None)
        await invalidar(redis, user_id)
        for hogar in hogares:
            hogar_id = hogar.get("id")
            if isinstance(hogar_id, str) and hogar_id:
                await invalidar(redis, hogar_id)
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
    hogar_id, _rol = await _contexto_hogar(request, user_id)
    redis = getattr(request.app.state, "redis", None)
    cacheado = await leer(redis, hogar_id, rango.desde, rango.hasta)
    if cacheado is not None:
        try:
            return Resumen.model_validate(cacheado)
        except ValidationError:
            logger.warning("La caché del resumen no tenía la forma del contrato.")
    datos = await repositorio.resumen(
        user_id=user_id,
        desde=rango.desde,
        hasta=rango.hasta,
        hogar_id=hogar_id,
        rol="administrador",
    )
    modelo = Resumen.model_validate(datos)
    await guardar(redis, hogar_id, rango.desde, rango.hasta, modelo.model_dump(mode="json"))
    return modelo
