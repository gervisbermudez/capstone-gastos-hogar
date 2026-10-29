"""Borrador, confirmación e índice. Las rutas no hablan con el modelo ni con SQL.

``POST`` guarda el borrador y los bytes. Confirmar escribe el libro y después
indexa. Si ``app.indexacion`` no está, la fila igual queda y ``indexado`` es
``omitido``. Si el índice falla, el comprobante sigue confirmado.
"""

from __future__ import annotations

import asyncio
import logging

from .archivos import borrar_archivo, guardar_archivo, leer_archivo
from .esquemas import Factura
from .extraccion import ArchivoRechazado, extraer
from .repositorio import (
    administrador_id,
    anular_comprobante,
    confirmar_documento,
    corregir_comprobante,
    descartar_borrador,
    eliminar_comprobante,
    exportar_csv,
    guardar_borrador,
    listar_documentos,
    listar_hilos_de_documento,
    listar_hogares,
    marcar_indexado,
    obtener_documento,
)
from .repositorio.documentos import AccesoDenegado, acceso_documento

logger = logging.getLogger(__name__)

TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024
_DETALLE_AUSENTE = "No existe ese documento."
_DETALLE_CONFIRMAR = "Faltan proveedor, período o monto."
_DETALLE_PROHIBIDO = "No tenés permiso para esa acción."
_MENSAJES_LIBRO = frozenset(
    {
        "campos inválidos",
        "Falta proveedor",
        "Falta el hogar",
        "categoria inválida",
        "periodo inválido",
        "moneda inválida",
        "monto inválido",
        "campo opcional inválido",
    }
)


def _detalle_libro(exc: ValueError) -> str:
    texto = str(exc).strip()
    if texto in _MENSAJES_LIBRO:
        return texto
    return _DETALLE_CONFIRMAR


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
    hogar_id: str | None = None,
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
            hogar_id=hogar_id,
        )
    except Exception as exc:
        logger.warning(
            "no se pudo indexar el comprobante %s: %s",
            documento_id,
            type(exc).__name__,
        )
        return "error"
    return "ok"


async def recibir(datos: bytes, *, user_id: str, hogar_id: str | None = None) -> dict:
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
        hogar_id=hogar_id,
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


async def listar(
    *, user_id: str, hogar_id: str | None = None, rol: str | None = None
) -> dict:
    return {
        "items": await listar_documentos(user_id=user_id, hogar_id=hogar_id, rol=rol)
    }


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
    datos = {
        "id": str(guardado.get("id") or ""),
        "estado": "confirmado",
        "campos": campos,
        "anulado": bool(guardado.get("anulado")),
        "indexado": valor_indexado,
        "cambios": cambios,
    }
    hogar_id = guardado.get("hogar_id")
    if isinstance(hogar_id, str) and hogar_id:
        datos["hogar_id"] = hogar_id
    return datos


async def _avisar_confirmacion(redis, *, actor_id: str, hogar_id: object, documento_id: str) -> None:
    """Avisa al administrador si confirmó un asociado. Un fallo no deshace el libro."""
    if redis is None or not isinstance(hogar_id, str) or not hogar_id:
        return
    try:
        from .canal import emitir

        admin = await administrador_id(hogar_id)
        if not admin or admin == actor_id:
            return
        nombre = None
        for hogar in await listar_hogares(admin):
            if hogar.get("id") == hogar_id and isinstance(hogar.get("nombre"), str):
                nombre = hogar["nombre"].strip()
                break
        if nombre:
            cuerpo = f"Se confirmó un comprobante en {nombre}."
        else:
            cuerpo = "Se confirmó un comprobante."
        await emitir(
            redis,
            user_id=admin,
            tipo="comprobante.confirmado",
            recurso={"clase": "documento", "id": documento_id},
            payload={"documento_id": documento_id, "hogar_id": hogar_id},
            notificacion={
                "titulo": "Comprobante confirmado",
                "cuerpo": cuerpo,
                "accion": {"etiqueta": "Ver", "ruta": f"/documentos/{documento_id}"},
            },
            dedupe=f"{admin}:comprobante.confirmado:documento:{documento_id}",
        )
    except Exception:
        logger.warning("No se pudo avisar la confirmación %s", documento_id)


async def confirmar(*, user_id: str, documento_id: str, factura: Factura, redis=None) -> dict:
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
    except AccesoDenegado:
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO) from None
    except ValueError as exc:
        raise ArchivoRechazado(422, _detalle_libro(exc)) from None
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)

    campos = guardado.get("campos")
    if not isinstance(campos, dict):
        campos = {}
    texto = guardado.get("texto") if isinstance(guardado.get("texto"), str) else ""
    documento = str(guardado.get("id") or documento_id)
    dueno = guardado.get("user_id")
    indice_user = dueno if isinstance(dueno, str) and dueno else user_id
    hogar_indice = guardado.get("hogar_id")
    indexado = await _indexar(
        user_id=indice_user,
        documento_id=documento,
        texto=texto,
        categoria=str(campos.get("categoria") or factura.categoria),
        periodo=str(campos.get("periodo") or factura.periodo),
        proveedor=str(campos.get("proveedor") or factura.proveedor),
        hogar_id=hogar_indice if isinstance(hogar_indice, str) else None,
    )
    await marcar_indexado(user_id=indice_user, documento_id=documento, indexado=indexado)
    if guardado.get("recien_confirmado"):
        await _avisar_confirmacion(
            redis,
            actor_id=user_id,
            hogar_id=guardado.get("hogar_id"),
            documento_id=documento,
        )
    return _publico_confirmado(guardado, indexado=indexado)


async def _olvidar_indice(user_id: str, documento_id: str) -> None:
    """El libro ya se borró. Si el índice falla, la baja igual termina."""
    try:
        from app.rag import olvidar_documento
    except ImportError:
        return
    try:
        await asyncio.to_thread(olvidar_documento, user_id, documento_id)
    except Exception as exc:
        logger.warning(
            "no se pudo borrar el índice del comprobante %s: %s",
            documento_id,
            type(exc).__name__,
        )


async def descartar(*, user_id: str, documento_id: str) -> str | None:
    """Borra un borrador visible, o un confirmado si es administrador.

    Devuelve el hogar de la fila para invalidar la caché. El archivo vive
    en la carpeta de quien lo subió.
    """
    acceso = await acceso_documento(user_id=user_id, documento_id=documento_id)
    if acceso is None:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    if acceso["estado"] == "confirmado" and acceso["rol"] != "administrador":
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO)
    try:
        es_borrador = await descartar_borrador(user_id=user_id, documento_id=documento_id)
        es_confirmado = await eliminar_comprobante(user_id=user_id, documento_id=documento_id)
    except AccesoDenegado:
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO) from None
    if not es_borrador and not es_confirmado:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    dueno = str(acceso["user_id"])
    await borrar_archivo(dueno, documento_id)
    if es_confirmado:
        await _olvidar_indice(dueno, documento_id)
    hogar_id = acceso.get("hogar_id")
    if isinstance(hogar_id, str) and hogar_id:
        return hogar_id
    return None


async def abrir_archivo(*, user_id: str, documento_id: str) -> tuple[bytes, str]:
    """Bytes y MIME si el actor puede ver el documento. 404 si no."""
    acceso = await acceso_documento(user_id=user_id, documento_id=documento_id)
    if acceso is None:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    encontrado = await leer_archivo(str(acceso["user_id"]), documento_id)
    if encontrado is None:
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return encontrado


async def anular(*, user_id: str, documento_id: str) -> dict:
    """Saca el confirmado del resumen. 403 si el rol no alcanza. 404 si no lo ve."""
    try:
        guardado = await anular_comprobante(user_id=user_id, documento_id=documento_id)
    except AccesoDenegado:
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO) from None
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return _publico_confirmado(guardado)


async def corregir(*, user_id: str, documento_id: str, factura: Factura) -> dict:
    """Actualiza el confirmado. 422 si el libro rechaza los campos. 404 si no existe."""
    try:
        guardado = await corregir_comprobante(
            user_id=user_id,
            documento_id=documento_id,
            campos=factura.model_dump(),
        )
    except AccesoDenegado:
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO) from None
    except ValueError as exc:
        raise ArchivoRechazado(422, _detalle_libro(exc)) from None
    if not isinstance(guardado, dict):
        raise ArchivoRechazado(404, _DETALLE_AUSENTE)
    return _publico_confirmado(guardado)


async def exportar(
    *,
    user_id: str,
    desde: str,
    hasta: str,
    hogar_id: str | None = None,
    rol: str | None = None,
) -> bytes:
    """CSV en UTF-8 de los confirmados no anulados del hogar, en el rango."""
    if rol == "asociado":
        raise ArchivoRechazado(403, _DETALLE_PROHIBIDO)
    texto = await exportar_csv(
        user_id=user_id,
        desde=desde,
        hasta=hasta,
        hogar_id=hogar_id,
        rol=rol,
    )
    return texto.encode("utf-8")
