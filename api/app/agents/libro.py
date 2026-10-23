"""Adaptador del libro de montos.

La tool no importa SQL. Llama ``repositorio.consultar_gastos`` con el
``user_id`` que el nodo sacó del estado. Si esa función todavía no está,
el import falla en la llamada y la tool no inventa un total.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any

_consulta: Callable[..., Any] | None = None


def usar_consulta(fn: Callable[..., Any] | None) -> None:
    """Reemplaza el repositorio. Los tests lo usan para no abrir SQLite."""
    global _consulta
    _consulta = fn


async def consultar_gastos_usuario(
    *,
    user_id: str,
    categoria: str | None = None,
    periodo_desde: str | None = None,
    periodo_hasta: str | None = None,
    proveedor: str | None = None,
) -> dict:
    fn = _consulta
    if fn is None:
        from ..repositorio import consultar_gastos as fn
    resultado = fn(
        user_id=user_id,
        categoria=categoria or None,
        periodo_desde=periodo_desde or None,
        periodo_hasta=periodo_hasta or None,
        proveedor=proveedor or None,
    )
    if inspect.isawaitable(resultado):
        resultado = await resultado
    if not isinstance(resultado, dict):
        raise TypeError("consultar_gastos no devolvió un dict")
    return resultado


def formatear_gastos(datos: dict) -> str:
    """Texto que la rúbrica reconoce: una línea ``Total:`` y el desglose."""
    lineas = [
        f"Total: {datos.get('total', '0.00')}",
        f"Promedio: {datos.get('promedio', '0.00')}",
        f"Cantidad: {datos.get('cantidad', 0)}",
    ]
    for fila in datos.get("por_mes") or []:
        if isinstance(fila, dict):
            lineas.append(f"Mes {fila.get('periodo')}: {fila.get('total')}")
    for fila in datos.get("por_categoria") or []:
        if isinstance(fila, dict):
            lineas.append(f"Categoría {fila.get('categoria')}: {fila.get('total')}")
    for fila in datos.get("por_proveedor") or []:
        if isinstance(fila, dict):
            lineas.append(f"Proveedor {fila.get('proveedor')}: {fila.get('total')}")
    return "\n".join(lineas)
