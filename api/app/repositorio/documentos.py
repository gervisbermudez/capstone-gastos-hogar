"""Borradores y el libro confirmado. Los totales salen de estas tablas."""

from __future__ import annotations

import csv
import io
import json
import uuid

from .. import db
from ..periodo import PERIODO as _PERIODO
from .comun import _ahora, _centavos, _monto, _promedio, _rollback

_CATEGORIAS = {"servicios", "expensas", "alquiler"}


_CLAVES_CAMPOS = (
    "proveedor",
    "categoria",
    "periodo",
    "monto",
    "moneda",
    "numero_comprobante",
)


def _campos_publicos(datos: dict | None) -> dict:
    if not isinstance(datos, dict):
        return {}
    salida = {}
    for clave in _CLAVES_CAMPOS:
        valor = datos.get(clave)
        if valor is not None:
            salida[clave] = valor
    return salida


def _opcional(valor: object) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValueError("campo opcional inválido")
    texto = valor.strip()
    return texto or None


def _campos_desde_fila(row) -> dict:
    campos = {
        "proveedor": row["proveedor"],
        "categoria": row["categoria"],
        "periodo": row["periodo"],
        "monto": _monto(int(row["monto_centavos"])),
        "moneda": row["moneda"],
    }
    if row["numero_comprobante"]:
        campos["numero_comprobante"] = row["numero_comprobante"]
    return campos


_COLUMNAS_PUBLICAS = """
    id, proveedor, categoria, periodo, monto_centavos, moneda,
    numero_comprobante, anulado, indexado, cambios_json
"""


_NO_ANULADO = "COALESCE(anulado, 0) = 0"


def _tiene(row, nombre: str) -> bool:
    return nombre in row.keys()


def _leer_cambios(crudo: object) -> list[dict]:
    if isinstance(crudo, list):
        datos = crudo
    elif isinstance(crudo, str) and crudo:
        try:
            datos = json.loads(crudo)
        except json.JSONDecodeError:
            return []
    else:
        return []
    if not isinstance(datos, list):
        return []
    cambios = []
    for item in datos:
        if not isinstance(item, dict) or not isinstance(item.get("campo"), str):
            continue
        if item["campo"] == "vencimiento":
            continue
        antes = item.get("antes")
        despues = item.get("despues")
        cambios.append(
            {
                "campo": item["campo"],
                "antes": antes if isinstance(antes, str) or antes is None else str(antes),
                "despues": despues if isinstance(despues, str) or despues is None else str(despues),
            }
        )
    return cambios


def _indexado(row) -> str | None:
    if not _tiene(row, "indexado"):
        return None
    valor = row["indexado"]
    if valor in {"ok", "error", "omitido"}:
        return valor
    return None


def _anulado(row) -> bool:
    if not _tiene(row, "anulado") or row["anulado"] is None:
        return False
    return bool(row["anulado"])


def _diferencias(antes: dict | None, despues: dict | None) -> list[dict]:
    origen = antes if isinstance(antes, dict) else {}
    destino = despues if isinstance(despues, dict) else {}
    cambios = []
    for campo in _CLAVES_CAMPOS:
        viejo = origen.get(campo)
        nuevo = destino.get(campo)
        if viejo == nuevo:
            continue
        cambios.append({"campo": campo, "antes": viejo, "despues": nuevo})
    return cambios


def _campos_desde_datos(datos: dict) -> dict:
    return _campos_publicos(
        {
            "proveedor": datos["proveedor"],
            "categoria": datos["categoria"],
            "periodo": datos["periodo"],
            "monto": _monto(datos["monto_centavos"]),
            "moneda": datos["moneda"],
            "numero_comprobante": datos["numero_comprobante"],
        }
    )


def _documento_confirmado(row, *, con_texto: bool) -> dict:
    cambios = _leer_cambios(row["cambios_json"] if _tiene(row, "cambios_json") else None)
    datos = {
        "id": row["id"],
        "estado": "confirmado",
        "campos": _campos_desde_fila(row),
        "anulado": _anulado(row),
        "indexado": _indexado(row),
        "cambios": cambios,
    }
    if con_texto:
        datos["texto"] = row["texto"]
    return datos


async def _categoria_para_gasto(conn, user_id: str, categoria: object) -> str:
    """Clave fija, o el nombre canónico de una categoría de esa persona."""
    if not isinstance(categoria, str):
        raise ValueError("categoria inválida")
    texto = categoria.strip()
    if texto in _CATEGORIAS:
        return texto
    if texto == "" or len(texto) > 80:
        raise ValueError("categoria inválida")
    cursor = await conn.execute(
        """
        SELECT nombre
        FROM categorias
        WHERE user_id = ? AND nombre = ? COLLATE NOCASE
        """,
        (user_id, texto),
    )
    fila = await cursor.fetchone()
    if fila is None:
        raise ValueError("categoria inválida")
    nombre = str(fila["nombre"]).strip()
    if nombre.casefold() in _CATEGORIAS:
        return nombre.casefold()
    return nombre


def _preparar_confirmacion(campos: dict, *, catalogo: bool = False) -> dict:
    if not isinstance(campos, dict):
        raise ValueError("campos inválidos")
    proveedor = campos.get("proveedor")
    if not isinstance(proveedor, str) or not proveedor.strip():
        raise ValueError("Falta proveedor")
    categoria = campos.get("categoria")
    if catalogo:
        if not isinstance(categoria, str):
            raise ValueError("categoria inválida")
        categoria = categoria.strip()
        if categoria == "" or len(categoria) > 80:
            raise ValueError("categoria inválida")
    elif categoria not in _CATEGORIAS:
        raise ValueError("categoria inválida")
    periodo = campos.get("periodo")
    if not isinstance(periodo, str) or _PERIODO.fullmatch(periodo) is None:
        raise ValueError("periodo inválido")
    moneda = campos.get("moneda") or "ARS"
    if not isinstance(moneda, str) or not moneda.strip():
        raise ValueError("moneda inválida")
    return {
        "proveedor": proveedor.strip(),
        "categoria": categoria,
        "periodo": periodo,
        "monto_centavos": _centavos(campos.get("monto")),
        "moneda": moneda.strip(),
        "numero_comprobante": _opcional(campos.get("numero_comprobante")),
    }


def _grupo(clave: str, fila) -> dict:
    suma = int(fila["suma"])
    cantidad = int(fila["cantidad"])
    return {
        clave: fila["clave"],
        "total": _monto(suma),
        "promedio": _promedio(suma, cantidad),
        "cantidad": cantidad,
    }


def _filtros(
    *,
    user_id: str,
    categoria: str | None,
    periodo_desde: str | None,
    periodo_hasta: str | None,
    proveedor: str | None,
) -> tuple[str, list]:
    clausulas = ["user_id = ?", _NO_ANULADO]
    parametros: list = [user_id]
    if categoria:
        clausulas.append("categoria = ?")
        parametros.append(categoria)
    if periodo_desde:
        clausulas.append("periodo >= ?")
        parametros.append(periodo_desde)
    if periodo_hasta:
        clausulas.append("periodo <= ?")
        parametros.append(periodo_hasta)
    if proveedor:
        clausulas.append("LOWER(proveedor) = LOWER(?)")
        parametros.append(proveedor)
    return " AND ".join(clausulas), parametros


async def guardar_borrador(*, user_id: str, texto: str, campos: dict, advertencias: list[str]) -> str:
    if not isinstance(advertencias, list) or any(not isinstance(item, str) for item in advertencias):
        raise ValueError("advertencias tiene que ser una lista de strings")
    documento_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        await conn.execute(
            """
            INSERT INTO borradores (
                id, user_id, texto, campos_json, advertencias_json, creado_en
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                documento_id,
                user_id,
                texto,
                json.dumps(_campos_publicos(campos), ensure_ascii=False),
                json.dumps(list(advertencias), ensure_ascii=False),
                _ahora(),
            ),
        )
    return documento_id


async def obtener_documento(*, user_id: str, documento_id: str) -> dict | None:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT id, texto, campos_json, advertencias_json, creado_en
            FROM borradores
            WHERE id = ? AND user_id = ?
            """,
            (documento_id, user_id),
        )
        borrador = await cursor.fetchone()
        if borrador is not None:
            datos = {
                "id": borrador["id"],
                "estado": "borrador",
                "campos": _campos_publicos(json.loads(borrador["campos_json"])),
                "texto": borrador["texto"],
                "advertencias": json.loads(borrador["advertencias_json"]),
            }
            creado = borrador["creado_en"]
            if isinstance(creado, str) and creado:
                datos["creado_en"] = creado
            return datos
        cursor = await conn.execute(
            f"""
            SELECT {_COLUMNAS_PUBLICAS}, confirmado_en
            FROM comprobantes
            WHERE id = ? AND user_id = ?
            """,
            (documento_id, user_id),
        )
        confirmado = await cursor.fetchone()
    if confirmado is None:
        return None
    datos = _documento_confirmado(confirmado, con_texto=False)
    marca = confirmado["confirmado_en"]
    if isinstance(marca, str) and marca:
        datos["confirmado_en"] = marca
    return datos


async def listar_documentos(*, user_id: str) -> list[dict]:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            """
            SELECT id, campos_json, creado_en
            FROM borradores
            WHERE user_id = ?
            """,
            (user_id,),
        )
        borradores = await cursor.fetchall()
        cursor = await conn.execute(
            f"""
            SELECT {_COLUMNAS_PUBLICAS}, confirmado_en
            FROM comprobantes
            WHERE user_id = ?
            """,
            (user_id,),
        )
        confirmados = await cursor.fetchall()
    ordenados: list[tuple[str, dict]] = []
    for fila in borradores:
        ordenados.append(
            (
                fila["creado_en"],
                {
                    "id": fila["id"],
                    "estado": "borrador",
                    "campos": _campos_publicos(json.loads(fila["campos_json"])),
                },
            )
        )
    for fila in confirmados:
        ordenados.append((fila["confirmado_en"], _documento_confirmado(fila, con_texto=False)))
    ordenados.sort(key=lambda par: par[0], reverse=True)
    return [item for _, item in ordenados]


async def confirmar_documento(*, user_id: str, documento_id: str, campos: dict) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT id, texto, campos_json FROM borradores WHERE id = ? AND user_id = ?",
                (documento_id, user_id),
            )
            borrador = await cursor.fetchone()
            if borrador is None:
                cursor = await conn.execute(
                    f"""
                    SELECT {_COLUMNAS_PUBLICAS}, texto
                    FROM comprobantes
                    WHERE id = ? AND user_id = ?
                    """,
                    (documento_id, user_id),
                )
                ya = await cursor.fetchone()
                await _rollback(conn)
                if ya is None:
                    return None
                return _documento_confirmado(ya, con_texto=True)
            if not isinstance(campos, dict):
                raise ValueError("campos inválidos")
            resueltos = dict(campos)
            resueltos["categoria"] = await _categoria_para_gasto(
                conn, user_id, campos.get("categoria")
            )
            datos = _preparar_confirmacion(resueltos, catalogo=True)
            texto = borrador["texto"]
            crudo = json.loads(borrador["campos_json"] or "{}")
            extraidos = _campos_publicos(crudo if isinstance(crudo, dict) else {})
            publicos = _campos_desde_datos(datos)
            cambios = _diferencias(extraidos, publicos)
            await conn.execute(
                """
                INSERT INTO comprobantes (
                    id, user_id, proveedor, categoria, periodo, monto_centavos,
                    moneda, numero_comprobante, texto, confirmado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    documento_id,
                    user_id,
                    datos["proveedor"],
                    datos["categoria"],
                    datos["periodo"],
                    datos["monto_centavos"],
                    datos["moneda"],
                    datos["numero_comprobante"],
                    texto,
                    _ahora(),
                ),
            )
            await conn.execute(
                """
                UPDATE comprobantes
                SET extraidos_json = ?, cambios_json = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    json.dumps(extraidos, ensure_ascii=False),
                    json.dumps(cambios, ensure_ascii=False),
                    documento_id,
                    user_id,
                ),
            )
            await conn.execute(
                "DELETE FROM borradores WHERE id = ? AND user_id = ?",
                (documento_id, user_id),
            )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    return {
        "id": documento_id,
        "estado": "confirmado",
        "campos": publicos,
        "texto": texto,
        "anulado": False,
        "indexado": None,
        "cambios": cambios,
    }


async def resumen(*, user_id: str, desde: str, hasta: str) -> dict:
    async with db.conectar() as conn:
        por_mes = await _sumar_grupo(conn, "periodo", user_id, desde, hasta)
        por_categoria = await _sumar_grupo(conn, "categoria", user_id, desde, hasta)
        cursor = await conn.execute(
            f"""
            SELECT {_COLUMNAS_PUBLICAS}
            FROM comprobantes
            WHERE user_id = ? AND periodo >= ? AND periodo <= ?
              AND {_NO_ANULADO}
            ORDER BY periodo ASC, id ASC
            """,
            (user_id, desde, hasta),
        )
        filas = await cursor.fetchall()
    return {
        "por_mes": [
            {"periodo": fila["clave"], "total": _monto(int(fila["suma"]))} for fila in por_mes
        ],
        "por_categoria": [
            {"categoria": fila["clave"], "total": _monto(int(fila["suma"]))}
            for fila in por_categoria
        ],
        "comprobantes": [_documento_confirmado(fila, con_texto=False) for fila in filas],
    }


async def _sumar_grupo(conn, columna: str, user_id: str, desde: str, hasta: str):
    if columna not in {"periodo", "categoria"}:
        raise ValueError("columna inválida")
    cursor = await conn.execute(
        f"""
        SELECT {columna} AS clave, COALESCE(SUM(monto_centavos), 0) AS suma
        FROM comprobantes
        WHERE user_id = ? AND periodo >= ? AND periodo <= ?
          AND {_NO_ANULADO}
        GROUP BY {columna}
        ORDER BY {columna} ASC
        """,
        (user_id, desde, hasta),
    )
    return await cursor.fetchall()


async def consultar_gastos(*, user_id: str, categoria: str | None = None, periodo_desde: str | None = None, periodo_hasta: str | None = None, proveedor: str | None = None) -> dict:
    where, parametros = _filtros(
        user_id=user_id,
        categoria=categoria,
        periodo_desde=periodo_desde,
        periodo_hasta=periodo_hasta,
        proveedor=proveedor,
    )
    async with db.conectar() as conn:
        cursor = await conn.execute(
            f"""
            SELECT COALESCE(SUM(monto_centavos), 0) AS suma, COUNT(*) AS cantidad
            FROM comprobantes
            WHERE {where}
            """,
            parametros,
        )
        totales = await cursor.fetchone()
        grupos: dict[str, list[dict]] = {}
        for columna, nombre in (
            ("periodo", "por_mes"),
            ("categoria", "por_categoria"),
            ("proveedor", "por_proveedor"),
        ):
            cursor = await conn.execute(
                f"""
                SELECT {columna} AS clave,
                       COALESCE(SUM(monto_centavos), 0) AS suma,
                       COUNT(*) AS cantidad
                FROM comprobantes
                WHERE {where}
                GROUP BY {columna}
                ORDER BY {columna} ASC
                """,
                parametros,
            )
            filas = await cursor.fetchall()
            grupos[nombre] = [_grupo(columna, fila) for fila in filas]
    suma = int(totales["suma"] or 0)
    cantidad = int(totales["cantidad"] or 0)
    return {
        "total": _monto(suma),
        "promedio": _promedio(suma, cantidad),
        "cantidad": cantidad,
        "por_mes": grupos["por_mes"],
        "por_categoria": grupos["por_categoria"],
        "por_proveedor": grupos["por_proveedor"],
    }


async def asentar_pago(
    *,
    user_id: str,
    proveedor: str,
    categoria: str,
    periodo: str,
    monto: str,
    texto: str,
) -> str:
    """Inserta un comprobante ya confirmado. El chat aprobado no lo llama.

    Es el único write del libro que no pasa por una ruta HTTP, así que
    también borra la caché del resumen de esa persona.
    """
    datos = _preparar_confirmacion(
        {
            "proveedor": proveedor,
            "categoria": categoria,
            "periodo": periodo,
            "monto": monto,
            "moneda": "ARS",
        }
    )
    documento_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            await conn.execute(
                """
                INSERT INTO comprobantes (
                    id, user_id, proveedor, categoria, periodo, monto_centavos,
                    moneda, numero_comprobante, texto, confirmado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    documento_id,
                    user_id,
                    datos["proveedor"],
                    datos["categoria"],
                    datos["periodo"],
                    datos["monto_centavos"],
                    datos["moneda"],
                    None,
                    texto.strip() or "Pago asentado desde el chat.",
                    _ahora(),
                ),
            )
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    from ..cache_resumen import invalidar_publicado

    await invalidar_publicado(user_id)
    return documento_id


async def marcar_indexado(*, user_id: str, documento_id: str, indexado: str) -> None:
    if indexado not in {"ok", "error", "omitido"}:
        raise ValueError("indexado inválido")
    async with db.conectar() as conn:
        await conn.execute(
            """
            UPDATE comprobantes
            SET indexado = ?
            WHERE id = ? AND user_id = ?
            """,
            (indexado, documento_id, user_id),
        )


async def descartar_borrador(*, user_id: str, documento_id: str) -> bool:
    """Borra la fila solo si es un borrador de esa persona. No toca confirmados."""
    async with db.conectar() as conn:
        await conn.execute(
            "DELETE FROM borradores WHERE id = ? AND user_id = ?",
            (documento_id, user_id),
        )
        cursor = await conn.execute("SELECT changes()")
        fila = await cursor.fetchone()
    return bool(fila and int(fila[0]) == 1)


async def eliminar_comprobante(*, user_id: str, documento_id: str) -> bool:
    """Borra la fila solo si es un comprobante confirmado de esa persona."""
    async with db.conectar() as conn:
        await conn.execute(
            "DELETE FROM comprobantes WHERE id = ? AND user_id = ?",
            (documento_id, user_id),
        )
        cursor = await conn.execute("SELECT changes()")
        fila = await cursor.fetchone()
    return bool(fila and int(fila[0]) == 1)


async def anular_comprobante(*, user_id: str, documento_id: str) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, user_id),
            )
            fila = await cursor.fetchone()
            if fila is None:
                await _rollback(conn)
                return None
            await conn.execute(
                """
                UPDATE comprobantes
                SET anulado = 1
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, user_id),
            )
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, user_id),
            )
            actualizado = await cursor.fetchone()
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    if actualizado is None:
        return None
    return _documento_confirmado(actualizado, con_texto=False)


async def corregir_comprobante(*, user_id: str, documento_id: str, campos: dict) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, user_id),
            )
            fila = await cursor.fetchone()
            if fila is None:
                await _rollback(conn)
                return None
            if not isinstance(campos, dict):
                raise ValueError("campos inválidos")
            resueltos = dict(campos)
            resueltos["categoria"] = await _categoria_para_gasto(
                conn, user_id, campos.get("categoria")
            )
            datos = _preparar_confirmacion(resueltos, catalogo=True)
            nuevos = _campos_desde_datos(datos)
            cambios = _leer_cambios(fila["cambios_json"])
            cambios.extend(_diferencias(_campos_desde_fila(fila), nuevos))
            await conn.execute(
                """
                UPDATE comprobantes
                SET proveedor = ?, categoria = ?, periodo = ?, monto_centavos = ?,
                    moneda = ?, numero_comprobante = ?, cambios_json = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    datos["proveedor"],
                    datos["categoria"],
                    datos["periodo"],
                    datos["monto_centavos"],
                    datos["moneda"],
                    datos["numero_comprobante"],
                    json.dumps(cambios, ensure_ascii=False),
                    documento_id,
                    user_id,
                ),
            )
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, user_id),
            )
            actualizado = await cursor.fetchone()
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    if actualizado is None:
        return None
    return _documento_confirmado(actualizado, con_texto=False)


async def exportar_csv(*, user_id: str, desde: str, hasta: str) -> str:
    async with db.conectar() as conn:
        cursor = await conn.execute(
            f"""
            SELECT id, proveedor, categoria, periodo, monto_centavos, moneda,
                   numero_comprobante
            FROM comprobantes
            WHERE user_id = ? AND periodo >= ? AND periodo <= ?
              AND {_NO_ANULADO}
            ORDER BY periodo ASC, id ASC
            """,
            (user_id, desde, hasta),
        )
        filas = await cursor.fetchall()
    buffer = io.StringIO()
    escritor = csv.writer(buffer, lineterminator="\n")
    escritor.writerow(
        (
            "id",
            "proveedor",
            "categoria",
            "periodo",
            "monto",
            "moneda",
            "numero_comprobante",
        )
    )
    for fila in filas:
        escritor.writerow(
            (
                fila["id"],
                fila["proveedor"],
                fila["categoria"],
                fila["periodo"],
                _monto(int(fila["monto_centavos"])),
                fila["moneda"],
                fila["numero_comprobante"] or "",
            )
        )
    return buffer.getvalue()

