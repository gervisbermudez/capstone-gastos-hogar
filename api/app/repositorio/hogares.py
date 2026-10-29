"""Hogares y membresías. Un hogar tiene un administrador y cero o más asociados."""

from __future__ import annotations

import uuid

from .. import db
from .comun import _ahora, _rollback

_MAX_NOMBRE = 80
_MAX_DIRECCION = 160
_NOMBRE_INICIAL = "Mi hogar"


class HogarNoEncontrado(Exception):
    """No administra ese hogar, o el hogar no existe. La ruta responde 404."""


class EmailInexistente(Exception):
    """No hay una cuenta con ese email. La ruta responde 404."""


class MiembroDuplicado(Exception):
    """Esa cuenta ya es miembro. La ruta responde 409."""


class AdministradorNoRemovible(Exception):
    """No se puede quitar al administrador. La ruta responde 409."""


def _nombre(nombre: str) -> str:
    if not isinstance(nombre, str):
        raise ValueError("Falta el nombre")
    texto = nombre.strip()
    if not texto:
        raise ValueError("Falta el nombre")
    if len(texto) > _MAX_NOMBRE:
        raise ValueError("El nombre supera los 80 caracteres")
    return texto


def _direccion(direccion: str | None) -> str | None:
    if direccion is None:
        return None
    if not isinstance(direccion, str):
        raise ValueError("La dirección es inválida")
    texto = direccion.strip()
    if not texto:
        return None
    if len(texto) > _MAX_DIRECCION:
        raise ValueError("La dirección supera los 160 caracteres")
    return texto


def _correo(email: str) -> str:
    if not isinstance(email, str):
        raise ValueError("Falta el email")
    texto = email.strip().lower()
    if not texto:
        raise ValueError("Falta el email")
    return texto


def _hogar(hogar_id: str, nombre: str, direccion: str | None, rol: str) -> dict:
    return {
        "id": hogar_id,
        "nombre": nombre,
        "direccion": direccion,
        "rol": rol,
    }


def _miembro(fila) -> dict:
    return {
        "user_id": fila["user_id"],
        "email": fila["email"],
        "nombre": fila["nombre"],
        "rol": fila["rol"],
    }


async def _rol(conn, user_id: str, hogar_id: str) -> str | None:
    cursor = await conn.execute(
        """
        SELECT rol
        FROM membresias
        WHERE user_id = ? AND hogar_id = ?
        """,
        (user_id, hogar_id),
    )
    fila = await cursor.fetchone()
    if fila is None:
        return None
    return str(fila["rol"])


async def _insertar_hogar(conn, *, user_id: str, nombre: str, direccion: str | None) -> str:
    """Inserta el hogar y la membresía de administrador. El caller transacciona."""
    hogar_id = str(uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO hogares (hogar_id, nombre, direccion, creado_en)
        VALUES (?, ?, ?, ?)
        """,
        (hogar_id, nombre, direccion, _ahora()),
    )
    await conn.execute(
        """
        INSERT INTO membresias (hogar_id, user_id, rol)
        VALUES (?, ?, 'administrador')
        """,
        (hogar_id, user_id),
    )
    return hogar_id


async def membresia(user_id: str, hogar_id: str) -> str | None:
    """``administrador``, ``asociado`` o None si no pertenece a ese hogar."""
    async with db.conectar() as conn:
        return await _rol(conn, user_id, hogar_id)


async def hogar_por_defecto(user_id: str) -> str | None:
    """El hogar que administra, el más antiguo por ``creado_en``. None si no hay."""
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT h.hogar_id
            FROM membresias AS m
            JOIN hogares AS h ON h.hogar_id = m.hogar_id
            WHERE m.user_id = ? AND m.rol = 'administrador'
            ORDER BY h.creado_en, h.hogar_id
            LIMIT 1
            """,
            (user_id,),
        )
        fila = await cursor.fetchone()
    if fila is None:
        return None
    return str(fila["hogar_id"])


async def listar_hogares(user_id: str) -> list[dict]:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT h.hogar_id, h.nombre, h.direccion, m.rol
            FROM membresias AS m
            JOIN hogares AS h ON h.hogar_id = m.hogar_id
            WHERE m.user_id = ?
            ORDER BY h.creado_en, h.hogar_id
            """,
            (user_id,),
        )
        filas = await cursor.fetchall()
    return [
        _hogar(fila["hogar_id"], fila["nombre"], fila["direccion"], fila["rol"])
        for fila in filas
    ]


async def crear_hogar(*, user_id: str, nombre: str, direccion: str | None) -> dict:
    nombre_ok = _nombre(nombre)
    direccion_ok = _direccion(direccion)
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            hogar_id = await _insertar_hogar(
                conn,
                user_id=user_id,
                nombre=nombre_ok,
                direccion=direccion_ok,
            )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    return _hogar(hogar_id, nombre_ok, direccion_ok, "administrador")


async def actualizar_hogar(
    *,
    user_id: str,
    hogar_id: str,
    nombre: str,
    direccion: str | None,
) -> dict | None:
    """None si no es administrador de ese hogar."""
    nombre_ok = _nombre(nombre)
    direccion_ok = _direccion(direccion)
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if await _rol(conn, user_id, hogar_id) != "administrador":
                await _rollback(conn)
                return None
            await conn.execute(
                """
                UPDATE hogares
                SET nombre = ?, direccion = ?
                WHERE hogar_id = ?
                """,
                (nombre_ok, direccion_ok, hogar_id),
            )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    return _hogar(hogar_id, nombre_ok, direccion_ok, "administrador")


async def listar_miembros(*, user_id: str, hogar_id: str) -> list[dict] | None:
    """None si no es administrador. Cada item trae user_id, email, nombre y rol."""
    async with db.conectar() as conn:
        if await _rol(conn, user_id, hogar_id) != "administrador":
            return None
        cursor = await conn.execute(
            """
            SELECT u.user_id, u.email, u.nombre, m.rol
            FROM membresias AS m
            JOIN usuarios AS u ON u.user_id = m.user_id
            WHERE m.hogar_id = ?
            ORDER BY CASE m.rol WHEN 'administrador' THEN 0 ELSE 1 END,
                     u.email COLLATE NOCASE
            """,
            (hogar_id,),
        )
        filas = await cursor.fetchall()
    return [_miembro(fila) for fila in filas]


async def agregar_miembro(*, user_id: str, hogar_id: str, email: str) -> dict:
    """Suma un asociado. El email tiene que ser de una cuenta que ya existe."""
    correo = _correo(email)
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if await _rol(conn, user_id, hogar_id) != "administrador":
                await _rollback(conn)
                raise HogarNoEncontrado(hogar_id)
            cursor = await conn.execute(
                """
                SELECT user_id, email, nombre
                FROM usuarios
                WHERE email = ?
                """,
                (correo,),
            )
            cuenta = await cursor.fetchone()
            if cuenta is None:
                await _rollback(conn)
                raise EmailInexistente(correo)
            miembro_id = cuenta["user_id"]
            if await _rol(conn, miembro_id, hogar_id) is not None:
                await _rollback(conn)
                raise MiembroDuplicado(correo)
            await conn.execute(
                """
                INSERT INTO membresias (hogar_id, user_id, rol)
                VALUES (?, ?, 'asociado')
                """,
                (hogar_id, miembro_id),
            )
            await conn.commit()
            return _miembro(
                {
                    "user_id": miembro_id,
                    "email": cuenta["email"],
                    "nombre": cuenta["nombre"],
                    "rol": "asociado",
                }
            )
        except (HogarNoEncontrado, EmailInexistente, MiembroDuplicado):
            raise
        except Exception as exc:
            await _rollback(conn)
            if exc.__class__.__name__ != "IntegrityError":
                raise
            raise MiembroDuplicado(correo) from exc


async def quitar_miembro(*, user_id: str, hogar_id: str, miembro_id: str) -> bool:
    """False si el actor no administra o el miembro no está.

    Quitar al administrador, incluido uno mismo, lanza ``AdministradorNoRemovible``.
    """
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if await _rol(conn, user_id, hogar_id) != "administrador":
                await _rollback(conn)
                return False
            rol_miembro = await _rol(conn, miembro_id, hogar_id)
            if rol_miembro is None:
                await _rollback(conn)
                return False
            if rol_miembro == "administrador":
                await _rollback(conn)
                raise AdministradorNoRemovible(miembro_id)
            await conn.execute(
                """
                DELETE FROM membresias
                WHERE hogar_id = ? AND user_id = ? AND rol = 'asociado'
                """,
                (hogar_id, miembro_id),
            )
            cursor = await conn.execute("SELECT changes()")
            fila = await cursor.fetchone()
            if fila is None or int(fila[0]) != 1:
                await _rollback(conn)
                return False
            await conn.commit()
        except AdministradorNoRemovible:
            raise
        except Exception:
            await _rollback(conn)
            raise
    return True


async def dejar_hogar(*, user_id: str, hogar_id: str) -> bool:
    """False si no pertenece a ese hogar.

    El administrador no puede irse: lanza ``AdministradorNoRemovible``.
    Borradores y comprobantes quedan en el hogar. El administrador puede borrarlos.
    """
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            rol = await _rol(conn, user_id, hogar_id)
            if rol is None:
                await _rollback(conn)
                return False
            if rol == "administrador":
                await _rollback(conn)
                raise AdministradorNoRemovible(user_id)
            await conn.execute(
                """
                DELETE FROM membresias
                WHERE hogar_id = ? AND user_id = ? AND rol = 'asociado'
                """,
                (hogar_id, user_id),
            )
            cursor = await conn.execute("SELECT changes()")
            fila = await cursor.fetchone()
            if fila is None or int(fila[0]) != 1:
                await _rollback(conn)
                return False
            await conn.commit()
        except AdministradorNoRemovible:
            raise
        except Exception:
            await _rollback(conn)
            raise
    return True


async def administrador_id(hogar_id: str) -> str | None:
    """El user_id del administrador de ese hogar, o None si no hay."""
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT user_id
            FROM membresias
            WHERE hogar_id = ? AND rol = 'administrador'
            """,
            (hogar_id,),
        )
        fila = await cursor.fetchone()
    if fila is None:
        return None
    return str(fila["user_id"])
