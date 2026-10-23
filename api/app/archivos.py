"""Bytes originales del upload. Viven junto a la base, en ``archivos/{user_id}/{id}``.

Con ``SQLITE_PATH`` vacío eso es ``api/data/archivos/{user_id}/{id}``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from .db import ruta_base
from .extraccion import detectar_tipo

_MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def directorio_archivos() -> Path:
    return ruta_base().parent / "archivos"


def _segmento(valor: str) -> str:
    if not isinstance(valor, str) or not valor or valor != Path(valor).name:
        raise ValueError("id inválido")
    if valor in {".", ".."}:
        raise ValueError("id inválido")
    return valor


def ruta_de_archivo(user_id: str, documento_id: str) -> Path:
    base = directorio_archivos().resolve()
    destino = (base / _segmento(user_id) / _segmento(documento_id)).resolve()
    if not destino.is_relative_to(base):
        raise ValueError("id inválido")
    return destino


async def guardar_archivo(*, user_id: str, documento_id: str, datos: bytes) -> None:
    ruta = ruta_de_archivo(user_id, documento_id)

    def _escribir() -> None:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(datos)

    await asyncio.to_thread(_escribir)


async def leer_archivo(user_id: str, documento_id: str) -> tuple[bytes, str] | None:
    try:
        ruta = ruta_de_archivo(user_id, documento_id)
    except ValueError:
        return None

    def _leer() -> bytes | None:
        if not ruta.is_file():
            return None
        return ruta.read_bytes()

    datos = await asyncio.to_thread(_leer)
    if datos is None:
        return None
    mime = _MIME.get(detectar_tipo(datos) or "", "application/octet-stream")
    return datos, mime


async def borrar_archivo(user_id: str, documento_id: str) -> None:
    try:
        ruta = ruta_de_archivo(user_id, documento_id)
    except ValueError:
        return

    def _borrar() -> None:
        ruta.unlink(missing_ok=True)

    await asyncio.to_thread(_borrar)
