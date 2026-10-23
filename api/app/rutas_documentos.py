"""Rutas de comprobantes. El usuario sale de ``usuario_actual``; no hay SQL acá."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from starlette.datastructures import UploadFile

from .auth import usuario_actual
from .cupo import exigir_cupo
from .esquemas import (
    CAMPO_ARCHIVO,
    DocumentoBorrador,
    DocumentoConfirmado,
    DocumentoDetalle,
    Factura,
    ListaDocumentos,
    RangoResumen,
)
from .extraccion import DETALLE_MODELO, ArchivoRechazado, ErrorDeModelo
from .ingesta import (
    TAMANO_MAXIMO_BYTES,
    abrir_archivo,
    anular,
    confirmar,
    corregir,
    descartar,
    exportar,
    listar,
    obtener,
    recibir,
)

router = APIRouter(tags=["documentos"])


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


@router.post("/documentos", status_code=201, response_model=DocumentoBorrador)
async def crear_documento(
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoBorrador:
    try:
        datos = await _bytes_del_archivo(request)
        await exigir_cupo(getattr(request.app.state, "redis", None), _user_id(usuario), "cargas")
        cuerpo = await recibir(datos, user_id=_user_id(usuario))
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except ErrorDeModelo:
        raise HTTPException(status_code=502, detail=DETALLE_MODELO) from None
    return DocumentoBorrador.model_validate(cuerpo)


@router.get("/documentos", response_model=ListaDocumentos)
async def listar_documentos_http(
    usuario: dict = Depends(usuario_actual),
) -> ListaDocumentos:
    try:
        cuerpo = await listar(user_id=_user_id(usuario))
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


@router.post("/documentos/{id}/confirmar", response_model=DocumentoConfirmado)
async def confirmar_documento_http(
    id: str,
    factura: Factura,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoConfirmado:
    try:
        cuerpo = await confirmar(
            user_id=_user_id(usuario),
            documento_id=id,
            factura=factura,
        )
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
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
    usuario: dict = Depends(usuario_actual),
) -> Response:
    try:
        await descartar(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return Response(status_code=204)


@router.post("/documentos/{id}/anular", response_model=DocumentoConfirmado)
async def anular_documento(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> DocumentoConfirmado:
    try:
        cuerpo = await anular(user_id=_user_id(usuario), documento_id=id)
    except ArchivoRechazado as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    return DocumentoConfirmado.model_validate(cuerpo)


@router.post("/documentos/{id}/corregir", response_model=DocumentoConfirmado)
async def corregir_documento(
    id: str,
    factura: Factura,
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
    return DocumentoConfirmado.model_validate(cuerpo)


@router.get("/export")
async def exportar_documentos(
    rango: Annotated[RangoResumen, Query()],
    usuario: dict = Depends(usuario_actual),
) -> Response:
    contenido = await exportar(user_id=_user_id(usuario), desde=rango.desde, hasta=rango.hasta)
    return Response(content=contenido, media_type="text/csv; charset=utf-8")
