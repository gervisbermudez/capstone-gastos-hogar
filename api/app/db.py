"""SQLite async. El esquema se crea en el primer uso, no en el lifespan."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

_ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nombre TEXT
);

CREATE TABLE IF NOT EXISTS borradores (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    texto TEXT NOT NULL,
    campos_json TEXT NOT NULL,
    advertencias_json TEXT NOT NULL,
    creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comprobantes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    proveedor TEXT NOT NULL,
    categoria TEXT NOT NULL,
    periodo TEXT NOT NULL,
    monto_centavos INTEGER NOT NULL,
    moneda TEXT NOT NULL,
    numero_comprobante TEXT,
    texto TEXT NOT NULL,
    confirmado_en TEXT NOT NULL,
    anulado INTEGER NOT NULL DEFAULT 0,
    indexado TEXT,
    cambios_json TEXT,
    extraidos_json TEXT
);

CREATE INDEX IF NOT EXISTS ix_comprobantes_user_periodo
    ON comprobantes(user_id, periodo);
CREATE INDEX IF NOT EXISTS ix_comprobantes_user_categoria
    ON comprobantes(user_id, categoria);
CREATE INDEX IF NOT EXISTS ix_borradores_user
    ON borradores(user_id);

CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    thread_id TEXT NOT NULL,
    rol TEXT NOT NULL,
    texto TEXT NOT NULL,
    creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mensajes_user_hilo
    ON mensajes(user_id, thread_id, id);

CREATE TABLE IF NOT EXISTS hilos_estado (
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    thread_id TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('archivado', 'eliminado')),
    PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE IF NOT EXISTS categorias (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    nombre TEXT NOT NULL,
    descripcion TEXT,
    creado_en TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categorias_user_nombre
    ON categorias(user_id, nombre COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS notificaciones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES usuarios(user_id),
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    cuerpo TEXT NOT NULL,
    accion_etiqueta TEXT,
    accion_ruta TEXT,
    recurso_clase TEXT,
    recurso_id TEXT,
    dedupe TEXT,
    leida_en TEXT,
    descartada_en TEXT,
    creada_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_notificaciones_user_fecha
    ON notificaciones(user_id, creada_en DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notificaciones_dedupe
    ON notificaciones(dedupe);
"""

# Columnas nuevas: nullable o con default, para que los INSERT viejos sigan.
_COLUMNAS_COMPROBANTES = (
    ("anulado", "INTEGER NOT NULL DEFAULT 0"),
    ("indexado", "TEXT"),
    ("cambios_json", "TEXT"),
    ("extraidos_json", "TEXT"),
)
_COLUMNAS_NOTIFICACIONES = (("descartada_en", "TEXT"),)


async def _migrar(conn: aiosqlite.Connection) -> None:
    """``ALTER TABLE`` idempotente. Una base vieja gana las columnas; una nueva no se toca."""
    cursor = await conn.execute("PRAGMA table_info(comprobantes)")
    filas = await cursor.fetchall()
    existentes = {fila["name"] for fila in filas}
    for nombre, definicion in _COLUMNAS_COMPROBANTES:
        if nombre in existentes:
            continue
        await conn.execute(f"ALTER TABLE comprobantes ADD COLUMN {nombre} {definicion}")
    if "vencimiento" in existentes:
        await conn.execute("ALTER TABLE comprobantes DROP COLUMN vencimiento")
    # Una base nueva ya trae ``nombre`` en el CREATE TABLE. El ALTER es solo para las viejas.
    cursor = await conn.execute("PRAGMA table_info(usuarios)")
    filas = await cursor.fetchall()
    columnas_usuario = {fila["name"] for fila in filas}
    if "nombre" not in columnas_usuario:
        await conn.execute("ALTER TABLE usuarios ADD COLUMN nombre TEXT")
    cursor = await conn.execute("PRAGMA table_info(notificaciones)")
    filas = await cursor.fetchall()
    columnas_aviso = {fila["name"] for fila in filas}
    for nombre, definicion in _COLUMNAS_NOTIFICACIONES:
        if nombre in columnas_aviso:
            continue
        await conn.execute(f"ALTER TABLE notificaciones ADD COLUMN {nombre} {definicion}")


def ruta_base() -> Path:
    """``SQLITE_PATH`` o ``api/data/gastos.db``, siempre absoluto."""
    crudo = os.getenv("SQLITE_PATH", "").strip()
    if not crudo:
        return Path(__file__).resolve().parent.parent / "data" / "gastos.db"
    ruta = Path(crudo)
    if not ruta.is_absolute():
        ruta = Path(__file__).resolve().parent.parent / ruta
    return ruta


@asynccontextmanager
async def conectar() -> AsyncIterator[aiosqlite.Connection]:
    """Abre una conexión corta y garantiza las tablas. No toca el lifespan."""
    ruta = ruta_base()
    ruta.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(ruta, isolation_level=None)
    try:
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA busy_timeout = 5000")
        cursor = await conn.execute("PRAGMA journal_mode = WAL")
        await cursor.fetchone()
        await conn.executescript(_ESQUEMA)
        await conn.execute("PRAGMA foreign_keys = ON")
        await _migrar(conn)
        yield conn
    finally:
        await conn.close()
