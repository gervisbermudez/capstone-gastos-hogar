"""Indexa el texto de un comprobante confirmado.

La ingesta importa esta función al confirmar. No escribe SQLite.
"""

from __future__ import annotations

from .rag import indexar_texto


async def indexar_comprobante(
    *,
    user_id: str,
    documento_id: str,
    texto: str,
    categoria: str,
    periodo: str,
    proveedor: str,
) -> None:
    await indexar_texto(
        user_id=user_id,
        documento_id=documento_id,
        texto=texto,
        categoria=categoria,
        periodo=periodo,
        proveedor=proveedor,
    )
