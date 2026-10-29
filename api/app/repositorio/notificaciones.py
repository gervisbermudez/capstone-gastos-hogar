"""Bandeja. El dedupe evita repetir la misma fila si el evento se reintenta."""

from __future__ import annotations

import uuid

from .. import db
from .comun import _ahora

def _notificacion_publica(fila) -> dict:
    accion = None
    if fila["accion_etiqueta"] and fila["accion_ruta"]:
        accion = {"etiqueta": fila["accion_etiqueta"], "ruta": fila["accion_ruta"]}
    recurso = None
    if fila["recurso_clase"] and fila["recurso_id"]:
        recurso = {"clase": fila["recurso_clase"], "id": fila["recurso_id"]}
    publica = {
        "id": fila["id"],
        "tipo": fila["tipo"],
        "titulo": fila["titulo"],
        "cuerpo": fila["cuerpo"],
        "accion": accion,
        "recurso": recurso,
        "leida": fila["leida_en"] is not None,
        "creada_en": fila["creada_en"],
    }
    if fila["descartada_en"] is not None:
        publica["descartada"] = True
    return publica


async def insertar_notificacion(
    *,
    user_id: str,
    tipo: str,
    titulo: str,
    cuerpo: str,
    accion_etiqueta: str | None,
    accion_ruta: str | None,
    recurso_clase: str | None,
    recurso_id: str | None,
    dedupe: str | None,
) -> dict:
    """Inserta una fila. Si ``dedupe`` ya existe, devuelve esa fila."""
    import sqlite3

    notificacion_id = str(uuid.uuid4())
    creada_en = _ahora()
    async with db.conectar() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO notificaciones (
                    id, user_id, tipo, titulo, cuerpo,
                    accion_etiqueta, accion_ruta, recurso_clase, recurso_id,
                    dedupe, leida_en, creada_en
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    notificacion_id,
                    user_id,
                    tipo,
                    titulo,
                    cuerpo,
                    accion_etiqueta,
                    accion_ruta,
                    recurso_clase,
                    recurso_id,
                    dedupe,
                    creada_en,
                ),
            )
        except sqlite3.IntegrityError:
            if not dedupe:
                raise
            cursor = await conn.execute(
                "SELECT * FROM notificaciones WHERE dedupe = ?",
                (dedupe,),
            )
            fila = await cursor.fetchone()
            if fila is None:
                raise
            return _notificacion_publica(fila)
        cursor = await conn.execute(
            "SELECT * FROM notificaciones WHERE id = ?",
            (notificacion_id,),
        )
        fila = await cursor.fetchone()
    if fila is None:
        raise RuntimeError("No se pudo leer la notificación recién creada.")
    return _notificacion_publica(fila)


async def listar_notificaciones(*, user_id: str, limite: int = 40) -> dict:
    tope = max(1, min(int(limite), 40))
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT * FROM notificaciones
            WHERE user_id = ? AND descartada_en IS NULL
            ORDER BY creada_en DESC, id DESC
            LIMIT ?
            """,
            (user_id, tope),
        )
        filas = await cursor.fetchall()
        cuenta = await conn.execute(
            """
            SELECT COUNT(*) FROM notificaciones
            WHERE user_id = ? AND leida_en IS NULL AND descartada_en IS NULL
            """,
            (user_id,),
        )
        total = await cuenta.fetchone()
    return {
        "items": [_notificacion_publica(fila) for fila in filas],
        "no_leidas": int(total[0]) if total else 0,
    }


async def marcar_notificacion_leida(*, user_id: str, notificacion_id: str) -> bool:
    """True si la fila es de esta persona. Ya leída sigue siendo True."""
    async with db.conectar() as conn:
        existe = await conn.execute(
            "SELECT 1 FROM notificaciones WHERE id = ? AND user_id = ?",
            (notificacion_id, user_id),
        )
        if await existe.fetchone() is None:
            return False
        await conn.execute(
            """
            UPDATE notificaciones
            SET leida_en = ?
            WHERE id = ? AND user_id = ? AND leida_en IS NULL
            """,
            (_ahora(), notificacion_id, user_id),
        )
    return True


async def marcar_notificaciones_leidas(*, user_id: str) -> None:
    """Marca lo ya creado. Una fila posterior al corte sigue sin leer."""
    corte = _ahora()
    async with db.conectar() as conn:
        await conn.execute(
            """
            UPDATE notificaciones
            SET leida_en = ?
            WHERE user_id = ? AND leida_en IS NULL AND creada_en <= ?
            """,
            (corte, user_id, corte),
        )


async def descartar_notificaciones_leidas(*, user_id: str) -> None:
    """Oculta las ya leídas. La fila queda para que el dedupe no las vuelva a crear.

    Una marcada después del corte sigue en la bandeja.
    """
    corte = _ahora()
    async with db.conectar() as conn:
        await conn.execute(
            """
            UPDATE notificaciones
            SET descartada_en = ?
            WHERE user_id = ?
              AND leida_en IS NOT NULL
              AND descartada_en IS NULL
              AND leida_en <= ?
            """,
            (corte, user_id, corte),
        )

