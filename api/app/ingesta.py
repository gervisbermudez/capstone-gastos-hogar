"""Borrador, confirmación e índice. Las rutas no hablan con el modelo ni con SQL.

``POST`` guarda el borrador y los bytes. Confirmar escribe el libro y después
indexa. Si ``app.indexacion`` no está, la fila igual queda y ``indexado`` es
``omitido``. Si el índice falla, el comprobante sigue confirmado.
"""

from __future__ import annotations

import logging

from .archivos import borrar_archivo, guardar_archivo, leer_archivo
from .esquemas import Factura
from .extraccion import ArchivoRechazado, extraer
from .repositorio import (
    anular_comprobante,
    confirmar_documento,
    corregir_comprobante,
    descartar_borrador,
    exportar_csv,
    guardar_borrador,
    listar_documentos,
    listar_hilos_de_documento,
    marcar_indexado,
    obtener_documento,
)

logger = logging.getLogger(__name__)

TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024
_DETALLE_AUSENTE = "No existe ese documento."
_DETALLE_CONFIRMAR = "Faltan proveedor, período o monto."


async def _indexar_noop(
    *,
    user_id: str,
    documento_id: str,
    texto: str,
    categoria: str,
    periodo: str,
    proveedor: str,
) -> None:
    """Corrutina local si ``app.indexacion`` todavía no existe.

    No abre Pinecone ni BM25. La confirmación en SQLite no depende de esto.
    """
    return None


async def _indexar(
    *,
    user_id: str,
    documento_id: str,
    texto: str,
    categoria: str,
    periodo: str,
    proveedor: str,
) -> str:
    """``ok``, ``error`` u ``omitido``. El mensaje de la excepción no se loguea."""
    try:
        from app.indexacion import indexar_comprobante
    except ImportError:
        await _indexar_noop(
            user_id=user_id,
            documento_id=documento_id,
            texto=texto,
            categoria=categoria,
            periodo=periodo,
            proveedor=proveedor,
        )
        return "omitido"
    try:
        await indexar_comprobante(
            user_id=user_id,
            documento_id=documento_id,
            texto=texto,
            categoria=categoria,
            periodo=periodo,
            proveedor=proveedor,
        )
    except Exception as exc:
        logger.warning(
            "no se pudo indexar el comprobante %s: %s",
            documento_id,
            type(exc).__name__,
        )
        return "error"
    return "ok"


async def recibir(datos: bytes, *, user_id: str) -> dict:
    """Guarda el borrador. No confirma y no indexa."""
    if not datos:
        raise ArchivoRechazado(422, "Falta el archivo.")
    if len(datos) > TAMANO_MAXIMO_BYTES:
        raise ArchivoRechazado(413, "El archivo supera el tamaño máximo.")
    resultado = await extraer(datos)
    documento_id = await guardar_borrador(
        user_id=user_id,
        texto=resultado.texto,
        campos=resultado.campos,
        advertencias=list(resultado.advertencias),
    )
    await guardar_archivo(user_id=user_id, documento_id=documento_id, datos=datos)
    return {
        "id": documento_id,
        "estado": "borrador",
        "campos": resultado.campos,
        "texto": resultado.texto,
        "advertencias": list(resultado.advertencias),
    }


async def obtener(*, user_id: str, documento_id: str) -> dict:
    datos = await obtener_documento(user_id=user_id, documento_id=documento_id)
    if not isinstance(datos, dict) or datos.get("estado") not in {"borrador", "confirmado"}:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return datos


async def listar(*, user_id: str) -> dict:
    return {"items": await listar_documentos(user_id=user_id)}


async def listar_hilos(*, user_id: str, documento_id: str) -> list[dict]:
    items = await listar_hilos_de_documento(user_id=user_id, documento_id=documento_id)
    if items is None:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return items


def _publico_confirmado(guardado: dict, *, indexado: str | None = None) -> dict:
    campos = guardado.get("campos")
    if not isinstance(campos, dict):
        campos = {}
    cambios = guardado.get("cambios")
    if not isinstance(cambios, list):
        cambios = []
    valor_indexado = indexado if indexado is not None else guardado.get("indexado")
    return {
        "id": str(guardado.get("id") or ""),
        "estado": "confirmado",
        "campos": campos,
        "anulado": bool(guardado.get("anulado")),
        "indexado": valor_indexado,
        "cambios": cambios,
    }


async def confirmar(*, user_id: str, documento_id: str, factura: Factura) -> dict:
    """Persiste el libro y después indexa.

    Si el índice falla, la respuesta sigue en 200 con ``indexado`` ``error``.
    Si el módulo de indexación no está, ``indexado`` es ``omitido``.
    Una segunda confirmación no pisa los campos: vuelve a indexar el mismo id.
    """
    if not factura.proveedor or not factura.periodo or not factura.monto:
        raise ArchivoRechazado(422, _DETALLE_CONFIRMAR)
    actual = await obtener_documento(user_id=user_id, documento_id=documento_id)
    if not isinstance(actual, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)

    try:
        guardado = await confirmar_documento(
            user_id=user_id,
            documento_id=documento_id,
            campos=factura.model_dump(),
        )
    except ValueError:
        raise ArchivoRechazado(422, _DETALLE_CONFIRMAR) from None
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)

    campos = guardado.get("campos")
    if not isinstance(campos, dict):
        campos = {}
    texto = guardado.get("texto") if isinstance(guardado.get("texto"), str) else ""
    documento = str(guardado.get("id") or documento_id)
    indexado = await _indexar(
        user_id=user_id,
        documento_id=documento,
        texto=texto,
        categoria=str(campos.get("categoria") or factura.categoria),
        periodo=str(campos.get("periodo") or factura.periodo),
        proveedor=str(campos.get("proveedor") or factura.proveedor),
    )
    await marcar_indexado(user_id=user_id, documento_id=documento, indexado=indexado)
    return _publico_confirmado(guardado, indexado=indexado)


async def descartar(*, user_id: str, documento_id: str) -> None:
    ok = await descartar_borrador(user_id=user_id, documento_id=documento_id)
    if not ok:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    await borrar_archivo(user_id, documento_id)


async def abrir_archivo(*, user_id: str, documento_id: str) -> tuple[bytes, str]:
    datos = await obtener_documento(user_id=user_id, documento_id=documento_id)
    if not isinstance(datos, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    encontrado = await leer_archivo(user_id, documento_id)
    if encontrado is None:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return encontrado


async def anular(*, user_id: str, documento_id: str) -> dict:
    guardado = await anular_comprobante(user_id=user_id, documento_id=documento_id)
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return _publico_confirmado(guardado)


async def corregir(*, user_id: str, documento_id: str, factura: Factura) -> dict:
    try:
        guardado = await corregir_comprobante(
            user_id=user_id,
            documento_id=documento_id,
            campos=factura.model_dump(),
        )
    except ValueError:
        raise ArchivoRechazado(422, _DETALLE_CONFIRMAR) from None
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return _publico_confirmado(guardado)


async def exportar(*, user_id: str, desde: str, hasta: str) -> bytes:
    texto = await exportar_csv(user_id=user_id, desde=desde, hasta=hasta)
    return texto.encode("utf-8")
