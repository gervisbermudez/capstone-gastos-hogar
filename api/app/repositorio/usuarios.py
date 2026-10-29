"""Cuentas. El hash ya viene armado: acá no se llama a Argon2."""

from __future__ import annotations

import uuid

from .. import db
from .comun import EmailDuplicado, HogarOcupado, _rollback
from .hogares import _NOMBRE_INICIAL, _insertar_hogar

def _email(email: str) -> str:
    texto = email.strip().lower()
    if not texto:
        raise ValueError("Falta el email")
    return texto


async def crear_usuario(email: str, password_hash: str) -> str:
    """Crea la cuenta y, en la misma transacción, el hogar «Mi hogar»."""
    correo = _email(email)
    if not isinstance(password_hash, str) or not password_hash:
        raise ValueError("Falta el hash")
    user_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            try:
                await conn.execute(
                    "INSERT INTO usuarios (user_id, email, password_hash) VALUES (?, ?, ?)",
                    (user_id, correo, password_hash),
                )
            except Exception as exc:
                if exc.__class__.__name__ != "IntegrityError":
                    raise
                raise EmailDuplicado(correo) from exc
            await _insertar_hogar(
                conn,
                user_id=user_id,
                nombre=_NOMBRE_INICIAL,
                direccion=None,
            )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    return user_id


async def buscar_usuario_por_email(email: str) -> dict | None:
    correo = email.strip().lower()
    if not correo:
        return None
    async with db.conectar() as conn:
        cursor = await conn.execute(
            "SELECT user_id, email, password_hash, nombre FROM usuarios WHERE email = ?",
            (correo,),
        )
        fila = await cursor.fetchone()
    if fila is None:
        return None
    return {
        "user_id": fila["user_id"],
        "email": fila["email"],
        "password_hash": fila["password_hash"],
        "nombre": fila["nombre"],
    }


async def buscar_usuario_por_id(user_id: str) -> dict | None:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            "SELECT user_id, email, password_hash, nombre FROM usuarios WHERE user_id = ?",
            (user_id,),
        )
        fila = await cursor.fetchone()
    if fila is None:
        return None
    return {
        "user_id": fila["user_id"],
        "email": fila["email"],
        "password_hash": fila["password_hash"],
        "nombre": fila["nombre"],
    }


async def actualizar_email(*, user_id: str, email: str) -> str:
    """Deja el correo normalizado. El mismo usuario no choca consigo mismo."""
    correo = _email(email)
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT user_id FROM usuarios WHERE email = ?",
                (correo,),
            )
            fila = await cursor.fetchone()
            if fila is not None and fila["user_id"] != user_id:
                await _rollback(conn)
                raise EmailDuplicado(correo)
            await conn.execute(
                "UPDATE usuarios SET email = ? WHERE user_id = ?",
                (correo, user_id),
            )
            await conn.commit()
        except EmailDuplicado:
            raise
        except Exception as exc:
            await _rollback(conn)
            if exc.__class__.__name__ != "IntegrityError":
                raise
            raise EmailDuplicado(correo) from exc
    return correo


async def actualizar_nombre(*, user_id: str, nombre: str | None) -> str | None:
    """Guarda el alias ya normalizado. No exige que sea único."""
    async with db.conectar() as conn:
        await conn.execute(
            "UPDATE usuarios SET nombre = ? WHERE user_id = ?",
            (nombre, user_id),
        )
    return nombre


async def actualizar_password_hash(*, user_id: str, password_hash: str) -> None:
    if not isinstance(password_hash, str) or not password_hash:
        raise ValueError("Falta el hash")
    async with db.conectar() as conn:
        await conn.execute(
            "UPDATE usuarios SET password_hash = ? WHERE user_id = ?",
            (password_hash, user_id),
        )


async def eliminar_usuario(*, user_id: str) -> None:
    """Borra la cuenta y lo que apunta a ella. Una sola transacción.

    Si administra un hogar con otros miembros, no borra nada.
    """
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                """
                SELECT 1
                FROM membresias AS propia
                WHERE propia.user_id = ?
                  AND propia.rol = 'administrador'
                  AND EXISTS (
                      SELECT 1
                      FROM membresias AS otra
                      WHERE otra.hogar_id = propia.hogar_id
                        AND otra.user_id != propia.user_id
                  )
                """,
                (user_id,),
            )
            if await cursor.fetchone() is not None:
                await _rollback(conn)
                raise HogarOcupado(user_id)
            cursor = await conn.execute(
                "SELECT hogar_id FROM membresias WHERE user_id = ?",
                (user_id,),
            )
            hogares = [fila["hogar_id"] for fila in await cursor.fetchall()]
            await conn.execute("DELETE FROM mensajes WHERE user_id = ?", (user_id,))
            await conn.execute("DELETE FROM hilos_estado WHERE user_id = ?", (user_id,))
            await conn.execute("DELETE FROM borradores WHERE user_id = ?", (user_id,))
            await conn.execute("DELETE FROM comprobantes WHERE user_id = ?", (user_id,))
            # El catálogo también referencia usuarios. Sin este DELETE la baja
            # falla por la foreign key.
            await conn.execute("DELETE FROM categorias WHERE user_id = ?", (user_id,))
            await conn.execute("DELETE FROM notificaciones WHERE user_id = ?", (user_id,))
            await conn.execute("DELETE FROM membresias WHERE user_id = ?", (user_id,))
            if hogares:
                marcas = ", ".join("?" for _ in hogares)
                await conn.execute(
                    f"""
                    DELETE FROM hogares
                    WHERE hogar_id IN ({marcas})
                      AND NOT EXISTS (
                          SELECT 1
                          FROM membresias AS m
                          WHERE m.hogar_id = hogares.hogar_id
                      )
                    """,
                    hogares,
                )
            await conn.execute("DELETE FROM usuarios WHERE user_id = ?", (user_id,))
            await conn.commit()
        except HogarOcupado:
            raise
        except Exception:
            await _rollback(conn)
            raise

