"""Período ``YYYY-MM`` y los nombres de mes que leen facturas y pagos."""

from __future__ import annotations

import re

PERIODO = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

MESES = {
    "enero": "01",
    "febrero": "02",
    "marzo": "03",
    "abril": "04",
    "mayo": "05",
    "junio": "06",
    "julio": "07",
    "agosto": "08",
    "septiembre": "09",
    "setiembre": "09",
    "octubre": "10",
    "noviembre": "11",
    "diciembre": "12",
}
