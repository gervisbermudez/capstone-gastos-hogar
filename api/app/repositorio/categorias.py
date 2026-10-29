"""Catálogo de categorías de cada persona, aparte de las tres fijas."""

from __future__ import annotations

import uuid

from .. import db
from .comun import NombreDuplicado, _ahora

def _categoria_publica(fila) -> dict:
    return {
        "id": fila["id"],
        "nombre": fila["nombre"],
        "descripcion": fila["descripcion"],
    }


async def listar_categorias(*, user_id: str) -> list[dict]:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT id, nombre, descripcion
            FROM categorias
            WHERE user_id = ?
            ORDER BY nombre COLLATE NOCASE
            """,
            (user_id,),
        )
        filas = await cursor.fetchall()
    return [_categoria_publica(fila) for fila in filas]


async def crear_categoria(*, user_id: str, nombre: str, descripcion: str | None) -> dict:
    categoria_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO categorias (id, user_id, nombre, descripcion, creado_en)
                VALUES (?, ?, ?, ?, ?)
                """,
                (categoria_id, user_id, nombre, descripcion, _ahora()),
            )
        except Exception as exc:
            if exc.__class__.__name__ != "IntegrityError":
                raise
            raise NombreDuplicado(nombre) from exc
    return {"id": categoria_id, "nombre": nombre, "descripcion": descripcion}


async def actualizar_categoria(
    *, user_id: str, categoria_id: str, nombre: str, descripcion: str | None
) -> dict | None:
    async with db.conectar() as conn:
        try:
            await conn.execute(
                """
                UPDATE categorias
                SET nombre = ?, descripcion = ?
                WHERE id = ? AND user_id = ?
                """,
                (nombre, descripcion, categoria_id, user_id),
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
                "SELECT 1 FROM categorias WHERE id = ? AND user_id = ?",
                (categoria_id, user_id),
            )
            if await existe.fetchone() is None:
                return None
    return {"id": categoria_id, "nombre": nombre, "descripcion": descripcion}


async def borrar_categoria(*, user_id: str, categoria_id: str) -> bool:
    async with db.conectar() as conn:
        await conn.execute(
            "DELETE FROM categorias WHERE id = ? AND user_id = ?",
            (categoria_id, user_id),
        )
        cursor = await conn.execute("SELECT changes()")
        fila = await cursor.fetchone()
    return bool(fila and int(fila[0]) == 1)

