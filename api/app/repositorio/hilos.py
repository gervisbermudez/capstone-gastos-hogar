"""Historial de chat. Un hilo es de un hogar y, si se elimina, no vuelve."""

from __future__ import annotations

import re

from .. import db
from ..texto import sin_cita_comprobante
from .comun import _ahora, _rollback
from .documentos import obtener_documento
from .hogares import hogar_por_defecto

_UUID_DOCUMENTO = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


_ROLES_HILO = {"persona", "asistente", "nota"}


def _titulo(texto: str) -> str:
    plano = " ".join(sin_cita_comprobante(texto or "").split())
    if len(plano) <= 80:
        return plano
    return plano[:80].rstrip()


async def _hogar_de(user_id: str, hogar_id: str | None) -> str | None:
    """El id que vino, o el hogar que esa persona administra."""
    if isinstance(hogar_id, str) and hogar_id.strip():
        return hogar_id.strip()
    return await hogar_por_defecto(user_id)


async def anotar_mensaje(
    *,
    user_id: str,
    thread_id: str,
    rol: str,
    texto: str,
    hogar_id: str | None = None,
) -> None:
    if rol not in _ROLES_HILO:
        raise ValueError("rol inválido")
    if not user_id or not thread_id or not isinstance(texto, str):
        raise ValueError("mensaje inválido")
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        raise ValueError("Falta el hogar")
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            estado = await _marca_hilo(conn, user_id, thread_id, hogar)
            if estado == "eliminado":
                await conn.commit()
                return
            await conn.execute(
                """
                INSERT INTO mensajes (user_id, thread_id, rol, texto, creado_en, hogar_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, thread_id, rol, texto, _ahora(), hogar),
            )
            if estado == "archivado" and rol == "persona":
                await conn.execute(
                    """
                    DELETE FROM hilos_estado
                    WHERE user_id = ? AND thread_id = ? AND estado = 'archivado' AND hogar_id = ?
                    """,
                    (user_id, thread_id, hogar),
                )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise


async def listar_hilos(
    *,
    user_id: str,
    limite: int = 30,
    archivados: bool = False,
    hogar_id: str | None = None,
) -> list[dict]:
    tope = max(1, min(int(limite), 30))
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return []
    presencia = "EXISTS" if archivados else "NOT EXISTS"
    estados = "('archivado')" if archivados else "('archivado', 'eliminado')"
    async with db.conectar() as conn:
        cursor = await conn.execute(
            f"""
            SELECT thread_id, MAX(creado_en) AS actualizado_en, MIN(id) AS primero
            FROM mensajes
            WHERE user_id = ?
              AND hogar_id = ?
              AND {presencia} (
                  SELECT 1 FROM hilos_estado AS marca
                  WHERE marca.user_id = mensajes.user_id
                    AND marca.thread_id = mensajes.thread_id
                    AND marca.hogar_id = mensajes.hogar_id
                    AND marca.estado IN {estados}
              )
            GROUP BY thread_id
            ORDER BY actualizado_en DESC, thread_id ASC
            LIMIT ?
            """,
            (user_id, hogar, tope),
        )
        filas = await cursor.fetchall()
        if not filas:
            return []
        ids = [fila["primero"] for fila in filas]
        marcas = ",".join("?" for _ in ids)
        cursor = await conn.execute(
            f"""
            SELECT id, texto FROM mensajes
            WHERE user_id = ? AND hogar_id = ? AND id IN ({marcas})
            """,
            (user_id, hogar, *ids),
        )
        textos = {fila["id"]: fila["texto"] for fila in await cursor.fetchall()}
    return [
        {
            "thread_id": fila["thread_id"],
            "titulo": _titulo(textos.get(fila["primero"]) or ""),
            "actualizado_en": fila["actualizado_en"],
        }
        for fila in filas
    ]


async def listar_hilos_de_documento(
    *,
    user_id: str,
    documento_id: str,
    hogar_id: str | None = None,
) -> list[dict] | None:
    if _UUID_DOCUMENTO.fullmatch(documento_id) is None:
        return None
    if await obtener_documento(user_id=user_id, documento_id=documento_id) is None:
        return None
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return []
    cita = f"[comprobante {documento_id}"
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT thread_id, MAX(creado_en) AS actualizado_en, MIN(id) AS primero
            FROM mensajes
            WHERE user_id = ?
              AND hogar_id = ?
              AND thread_id IN (
                  SELECT DISTINCT thread_id
                  FROM mensajes
                  WHERE user_id = ? AND hogar_id = ? AND instr(lower(texto), lower(?)) > 0
              )
              AND NOT EXISTS (
                  SELECT 1 FROM hilos_estado AS marca
                  WHERE marca.user_id = mensajes.user_id
                    AND marca.thread_id = mensajes.thread_id
                    AND marca.hogar_id = mensajes.hogar_id
                    AND marca.estado IN ('archivado', 'eliminado')
              )
            GROUP BY thread_id
            ORDER BY actualizado_en DESC, thread_id ASC
            LIMIT 20
            """,
            (user_id, hogar, user_id, hogar, cita),
        )
        filas = await cursor.fetchall()
        if not filas:
            return []
        ids = [fila["primero"] for fila in filas]
        marcas = ",".join("?" for _ in ids)
        cursor = await conn.execute(
            f"""
            SELECT id, texto FROM mensajes
            WHERE user_id = ? AND hogar_id = ? AND id IN ({marcas})
            """,
            (user_id, hogar, *ids),
        )
        textos = {fila["id"]: fila["texto"] for fila in await cursor.fetchall()}
    return [
        {
            "thread_id": fila["thread_id"],
            "titulo": _titulo(textos.get(fila["primero"]) or ""),
            "actualizado_en": fila["actualizado_en"],
        }
        for fila in filas
    ]


async def obtener_hilo(
    *,
    user_id: str,
    thread_id: str,
    hogar_id: str | None = None,
) -> dict | None:
    if not user_id or not thread_id:
        return None
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return None
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT rol, texto, creado_en
            FROM mensajes
            WHERE user_id = ? AND thread_id = ? AND hogar_id = ?
            ORDER BY id ASC
            """,
            (user_id, thread_id, hogar),
        )
        filas = await cursor.fetchall()
    if not filas:
        return None
    return {
        "thread_id": thread_id,
        "mensajes": [
            {"rol": fila["rol"], "texto": fila["texto"], "creado_en": fila["creado_en"]}
            for fila in filas
        ],
    }


async def _marca_hilo(conn, user_id: str, thread_id: str, hogar_id: str) -> str | None:
    cursor = await conn.execute(
        """
        SELECT estado FROM hilos_estado
        WHERE user_id = ? AND thread_id = ? AND hogar_id = ?
        """,
        (user_id, thread_id, hogar_id),
    )
    fila = await cursor.fetchone()
    if fila is None:
        return None
    return str(fila["estado"])


async def _tiene_mensajes(conn, user_id: str, thread_id: str, hogar_id: str) -> bool:
    cursor = await conn.execute(
        """
        SELECT 1 FROM mensajes
        WHERE user_id = ? AND thread_id = ? AND hogar_id = ?
        LIMIT 1
        """,
        (user_id, thread_id, hogar_id),
    )
    return await cursor.fetchone() is not None


async def _guardar_estado(conn, user_id: str, thread_id: str, hogar_id: str, estado: str) -> bool:
    """Deja la marca de este hogar. False si la fila es de otro hogar."""
    cursor = await conn.execute(
        """
        SELECT hogar_id, estado
        FROM hilos_estado
        WHERE user_id = ? AND thread_id = ?
        """,
        (user_id, thread_id),
    )
    fila = await cursor.fetchone()
    if fila is None:
        await conn.execute(
            """
            INSERT INTO hilos_estado (user_id, thread_id, estado, hogar_id)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, thread_id, estado, hogar_id),
        )
        return True
    if fila["hogar_id"] != hogar_id:
        return False
    if fila["estado"] != estado:
        await conn.execute(
            """
            UPDATE hilos_estado
            SET estado = ?
            WHERE user_id = ? AND thread_id = ? AND hogar_id = ?
            """,
            (estado, user_id, thread_id, hogar_id),
        )
    return True


async def hilo_esta_eliminado(
    *,
    user_id: str,
    thread_id: str,
    hogar_id: str | None = None,
) -> bool:
    if not user_id or not thread_id:
        return False
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return False
    async with db.conectar() as conn:
        return await _marca_hilo(conn, user_id, thread_id, hogar) == "eliminado"


async def archivar_hilo(
    *,
    user_id: str,
    thread_id: str,
    hogar_id: str | None = None,
) -> bool:
    """Oculta el hilo del listado activo. False si no es de ese hogar."""
    if not user_id or not thread_id:
        return False
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return False
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if not await _tiene_mensajes(conn, user_id, thread_id, hogar):
                await conn.commit()
                return False
            if await _marca_hilo(conn, user_id, thread_id, hogar) == "eliminado":
                await conn.commit()
                return False
            if not await _guardar_estado(conn, user_id, thread_id, hogar, "archivado"):
                await _rollback(conn)
                return False
            await conn.commit()
            return True
        except Exception:
            await _rollback(conn)
            raise


async def desarchivar_hilo(
    *,
    user_id: str,
    thread_id: str,
    hogar_id: str | None = None,
) -> bool:
    """Vuelve a mostrar el hilo. Si ya estaba activo y existe, también es True."""
    if not user_id or not thread_id:
        return False
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return False
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if not await _tiene_mensajes(conn, user_id, thread_id, hogar):
                await conn.commit()
                return False
            if await _marca_hilo(conn, user_id, thread_id, hogar) == "eliminado":
                await conn.commit()
                return False
            await conn.execute(
                """
                DELETE FROM hilos_estado
                WHERE user_id = ? AND thread_id = ? AND estado = 'archivado' AND hogar_id = ?
                """,
                (user_id, thread_id, hogar),
            )
            await conn.commit()
            return True
        except Exception:
            await _rollback(conn)
            raise


async def eliminar_hilo(
    *,
    user_id: str,
    thread_id: str,
    hogar_id: str | None = None,
) -> bool:
    """Borra los mensajes de ese hogar y deja el hilo inutilizable."""
    if not user_id or not thread_id:
        return False
    hogar = await _hogar_de(user_id, hogar_id)
    if not hogar:
        return False
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            estado = await _marca_hilo(conn, user_id, thread_id, hogar)
            if estado == "eliminado" or not await _tiene_mensajes(conn, user_id, thread_id, hogar):
                await conn.commit()
                return False
            await conn.execute(
                """
                DELETE FROM mensajes
                WHERE user_id = ? AND thread_id = ? AND hogar_id = ?
                """,
                (user_id, thread_id, hogar),
            )
            if not await _guardar_estado(conn, user_id, thread_id, hogar, "eliminado"):
                await _rollback(conn)
                return False
            await conn.commit()
            return True
        except Exception:
            await _rollback(conn)
            raise
