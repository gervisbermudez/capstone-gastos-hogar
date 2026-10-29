"""Rutas de comprobantes. El usuario sale de ``usuario_actual``; no hay SQL acá."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from starlette.datastructures import UploadFile

from . import repositorio
from .archivos import borrar_pendiente, guardar_pendiente
from .auth import usuario_actual
from .cache_resumen import invalidar
from .cargas import crear_carga, leer as leer_carga, publico as publico_carga
from .cupo import exigir_cupo
from .esquemas import (
    CAMPO_ARCHIVO,
    CargaAceptada,
    CargaEstado,
    DocumentoBorrador,
    DocumentoConfirmado,
    DocumentoDetalle,
    Factura,
    ListaDocumentos,
    ListaHilos,
    RangoResumen,
)
from .extraccion import DETALLE_TIPO, ArchivoRechazado, detectar_tipo
from .ingesta import (
    TAMANO_MAXIMO_BYTES,
    abrir_archivo,
    anular,
    confirmar,
    corregir,
    descartar,
    exportar,
    listar,
    listar_hilos,
    obtener,
)

router = APIRouter(tags=["documentos"])

_NO_HOGAR = "No existe ese hogar"
_PROHIBIDO = "No tenés permiso para esa acción."


async def _bytes_del_archivo(request: Request) -> bytes:
    """Un solo campo ``archivo``, leído hasta el tope y ni un byte más."""
    try:
        formulario = await request.form()
    except Exception as exc:
        if "python-multipart" in str(exc).lower():
            raise HTTPException(
                status_code=500,
                detail="No se pudo leer el formulario.",
            ) from None
        raise ArchivoRechazado(422, "Falta el archivo.") from None
    try:
        archivos = [
            (clave, valor)
            for clave, valor in formulario.multi_items()
            if isinstance(valor, UploadFile)
        ]
        if not archivos:
            raise ArchivoRechazado(422, "Falta el archivo.")
        if len(archivos) != 1 or archivos[0][0] != CAMPO_ARCHIVO:
            raise ArchivoRechazado(422, "Se acepta un solo archivo.")
        datos = await archivos[0][1].read(TAMANO_MAXIMO_BYTES + 1)
        if len(datos) > TAMANO_MAXIMO_BYTES:
            raise ArchivoRechazado(413, "El archivo supera el tamaño máximo.")
        if not datos:
            raise ArchivoRechazado(422, "Falta el archivo.")
        return datos
    finally:
        await formulario.close()


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


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


def _hogar_de(cuerpo: dict) -> str | None:
    hogar_id = cuerpo.get("hogar_id")
    if isinstance(hogar_id, str) and hogar_id:
        return hogar_id
    return None


async def _olvidar_resumen(request: Request, hogar_id: str | None) -> None:
    if not hogar_id:
        return
    await invalidar(getattr(request.app.state, "redis", None), hogar_id)


@router.post("/documentos", status_code=202, response_model=CargaAceptada)
async def crear_documento(
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> CargaAceptada:
    """Valida el archivo y lo encola. La extracción no corre en este request."""
    user_id = _user_id(usuario)
    hogar_id, _rol = await _contexto_hogar(request, user_id)
    try:
        datos = await _bytes_del_archivo(request)
        if detectar_tipo(datos) is None:
            raise ArchivoRechazado(415, DETALLE_TIPO)
        redis = getattr(request.app.state, "redis", None)
        await exigir_cupo(redis, user_id, "cargas")
        if redis is None:
            raise HTTPException(status_code=503, detail="Redis no responde")
        job_id = str(uuid.uuid4())
        await guardar_pendiente(user_id=user_id, job_id=job_id, datos=datos)
        try:
            await crear_carga(redis, job_id, user_id, hogar_id)
        except Exception:
            await borrar_pendiente(user_id, job_id)
            raise
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return CargaAceptada(job_id=job_id, status="PENDING")


@router.get("/cargas/{job_id}", response_model=CargaEstado)
async def ver_carga(
    job_id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> CargaEstado:
    redis = getattr(request.app.state, "redis", None)
    job = await leer_carga(redis, job_id) if redis is not None else None
    if not isinstance(job, dict) or job.get("user_id") != _user_id(usuario):
        raise HTTPException(status_code=404, detail="No existe esa carga")
    return CargaEstado.model_validate(publico_carga(job))


@router.get("/documentos", response_model=ListaDocumentos)
async def listar_documentos_http(
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> ListaDocumentos:
    user_id = _user_id(usuario)
    hogar_id, rol = await _contexto_hogar(request, user_id)
    try:
        cuerpo = await listar(user_id=user_id, hogar_id=hogar_id, rol=rol)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return ListaDocumentos.model_validate(cuerpo)


@router.get("/documentos/{id}", response_model=DocumentoDetalle)
async def ver_documento(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoBorrador | DocumentoConfirmado:
    try:
        datos = await obtener(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    if datos.get("estado") == "borrador":
        return DocumentoBorrador.model_validate(datos)
    return DocumentoConfirmado.model_validate(datos)


@router.get("/documentos/{id}/hilos", response_model=ListaHilos)
async def listar_hilos_documento(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> ListaHilos:
    try:
        items = await listar_hilos(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return ListaHilos.model_validate({"items": items})


@router.post("/documentos/{id}/confirmar", response_model=DocumentoConfirmado)
async def confirmar_documento_http(
    id: str,
    factura: Factura,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoConfirmado:
    try:
        cuerpo = await confirmar(
            user_id=_user_id(usuario),
            documento_id=id,
            factura=factura,
            redis=getattr(request.app.state, "redis", None),
        )
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    await _olvidar_resumen(request, _hogar_de(cuerpo))
    return DocumentoConfirmado.model_validate(cuerpo)


@router.get("/documentos/{id}/archivo")
async def archivo_documento(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    try:
        datos, mime = await abrir_archivo(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return Response(content=datos, media_type=mime)


@router.delete("/documentos/{id}", status_code=204)
async def descartar_documento(
    id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    try:
        hogar_id = await descartar(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    await _olvidar_resumen(request, hogar_id)
    return Response(status_code=204)


@router.post("/documentos/{id}/anular", response_model=DocumentoConfirmado)
async def anular_documento(
    id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoConfirmado:
    try:
        cuerpo = await anular(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    await _olvidar_resumen(request, _hogar_de(cuerpo))
    return DocumentoConfirmado.model_validate(cuerpo)


@router.post("/documentos/{id}/corregir", response_model=DocumentoConfirmado)
async def corregir_documento(
    id: str,
    factura: Factura,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoConfirmado:
    try:
        cuerpo = await corregir(
            user_id=_user_id(usuario),
            documento_id=id,
            factura=factura,
        )
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    await _olvidar_resumen(request, _hogar_de(cuerpo))
    return DocumentoConfirmado.model_validate(cuerpo)


@router.get("/export")
async def exportar_documentos(
    rango: Annotated[RangoResumen, Query()],
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    user_id = _user_id(usuario)
    hogar_id, rol = await _contexto_hogar(request, user_id)
    if rol != "administrador":
        raise HTTPException(status_code=403, detail=_PROHIBIDO)
    try:
        contenido = await exportar(
            user_id=user_id,
            desde=rango.desde,
            hasta=rango.hasta,
            hogar_id=hogar_id,
            rol=rol,
        )
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return Response(content=contenido, media_type="text/csv; charset=utf-8")
