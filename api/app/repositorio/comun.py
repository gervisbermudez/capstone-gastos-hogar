"""Fechas, dinero y las excepciones que las rutas traducen a HTTP."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

_MONTO = re.compile(r"^\d+\.\d{2}$")


class EmailDuplicado(Exception):
    """El email ya existe. La ruta lo traduce a 409."""


class NombreDuplicado(Exception):
    """El nombre ya existe para esa persona. La ruta lo traduce a 409."""


class HogarOcupado(Exception):
    """Administra un hogar que tiene otros miembros. La baja responde 409."""


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _centavos(monto: object) -> int:
    if not isinstance(monto, str) or _MONTO.fullmatch(monto) is None:
        raise ValueError("monto inválido")
    pesos, fraccion = monto.split(".")
    return int(pesos) * 100 + int(fraccion)


def _monto(centavos: int) -> str:
    if centavos < 0:
        raise ValueError("total negativo")
    return f"{centavos // 100}.{centavos % 100:02d}"


def _promedio(suma_centavos: int, cantidad: int) -> str:
    if cantidad <= 0:
        return "0.00"
    valor = (Decimal(suma_centavos) / Decimal(cantidad) / Decimal(100)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    return format(valor, "f")


async def _rollback(conn) -> None:
    try:
        await conn.rollback()
    except Exception:
        return

