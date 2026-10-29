"""Catálogo de categorías de cada hogar, aparte de las tres fijas.

``user_id`` queda como quien la creó, para que la baja de la cuenta pueda
borrarlas. Listar, crear, editar y borrar filtran por ``hogar_id``.
"""

from __future__ import annotations

import uuid

from .. import db
from .comun import NombreDuplicado, _ahora
from .hogares import hogar_por_defecto


def _categoria_publica(fila) -> dict:
    return {
        "id": fila["id"],
        "nombre": fila["nombre"],
        "descripcion": fila["descripcion"],
    }


async def _hogar(user_id: str, hogar_id: str | None) -> str | None:
    if isinstance(hogar_id, str) and hogar_id.strip():
        return hogar_id.strip()
    return await hogar_por_defecto(user_id)


async def listar_categorias(*, user_id: str, hogar_id: str | None = None) -> list[dict]:
    hogar = await _hogar(user_id, hogar_id)
    if not hogar:
        return []
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT id, nombre, descripcion
            FROM categorias
            WHERE hogar_id = ?
            ORDER BY nombre COLLATE NOCASE
            """,
            (hogar,),
        )
        filas = await cursor.fetchall()
    return [_categoria_publica(fila) for fila in filas]


async def crear_categoria(
    *, user_id: str, nombre: str, descripcion: str | None, hogar_id: str | None = None
) -> dict:
    hogar = await _hogar(user_id, hogar_id)
    if not hogar:
        raise ValueError("Falta el hogar")
    categoria_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO categorias (
                    id, user_id, hogar_id, nombre, descripcion, creado_en
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (categoria_id, user_id, hogar, nombre, descripcion, _ahora()),
            )
        except Exception as exc:
            if exc.__class__.__name__ != "IntegrityError":
                raise
            raise NombreDuplicado(nombre) from exc
    return {"id": categoria_id, "nombre": nombre, "descripcion": descripcion}


async def actualizar_categoria(
    *,
    user_id: str,
    categoria_id: str,
    nombre: str,
    descripcion: str | None,
    hogar_id: str | None = None,
) -> dict | None:
    hogar = await _hogar(user_id, hogar_id)
    if not hogar:
        return None
    async with db.conectar() as conn:
        try:
            await conn.execute(
                """
                UPDATE categorias
                SET nombre = ?, descripcion = ?
                WHERE id = ? AND hogar_id = ?
                """,
                (nombre, descripcion, categoria_id, hogar),
            )
        except Exception as exc:
            if exc.__class__.__name__ != "IntegrityError":
                raise
            raise NombreDuplicado(nombre) from exc
        cursor = await conn.execute("SELECT changes()")
        fila = await cursor.fetchone()
        # SQLite no cuenta la fila si los valores no cambian. Eso no es un 404.
        if fila is None or int(fila[0]) != 1:
            existe = await conn.execute(
                "SELECT 1 FROM categorias WHERE id = ? AND hogar_id = ?",
                (categoria_id, hogar),
            )
            if await existe.fetchone() is None:
                return None
    return {"id": categoria_id, "nombre": nombre, "descripcion": descripcion}


async def borrar_categoria(
    *, user_id: str, categoria_id: str, hogar_id: str | None = None
) -> bool:
    hogar = await _hogar(user_id, hogar_id)
    if not hogar:
        return False
    async with db.conectar() as conn:
        await conn.execute(
            "DELETE FROM categorias WHERE id = ? AND hogar_id = ?",
            (categoria_id, hogar),
        )
        cursor = await conn.execute("SELECT changes()")
        fila = await cursor.fetchone()
    return bool(fila and int(fila[0]) == 1)
