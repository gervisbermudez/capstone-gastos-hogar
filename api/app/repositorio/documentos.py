"""Borradores y el libro confirmado. Los totales salen de estas tablas.

El hogar de la fila manda el permiso. El administrador suma el hogar entero.
El asociado, si lo llaman con ese rol, solo sus filas. Sin hogar ni rol, se
usa el hogar que administra esa persona: es el libro de hoy.
"""

from __future__ import annotations

import csv
import io
import json
import uuid

from .. import db
from ..periodo import PERIODO as _PERIODO
from .comun import _ahora, _centavos, _monto, _promedio, _rollback
from .hogares import hogar_por_defecto

_CATEGORIAS = {"servicios", "expensas", "alquiler"}


_CLAVES_CAMPOS = (
    "proveedor",
    "categoria",
    "periodo",
    "monto",
    "moneda",
    "numero_comprobante",
)


class AccesoDenegado(Exception):
    """El miembro ve la fila, pero el rol no alcanza. La ruta responde 403."""


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


def _hogar_de_fila(fila) -> str | None:
    if not _tiene(fila, "hogar_id"):
        return None
    valor = fila["hogar_id"]
    if isinstance(valor, str) and valor:
        return valor
    return None


def _con_hogar(datos: dict, fila) -> dict:
    hogar = _hogar_de_fila(fila)
    if hogar:
        datos["hogar_id"] = hogar
    datos["user_id"] = str(fila["user_id"])
    return datos


def _papel(rol: str | None) -> str:
    if rol == "asociado":
        return "asociado"
    return "administrador"


async def _rol_miembro(conn, user_id: str, hogar_id: str) -> str | None:
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


async def _hogar_defecto_conn(conn, user_id: str) -> str | None:
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


async def _puede_ver(conn, actor: str, fila) -> str | None:
    """Rol con el que el actor ve la fila. None si no es suya ni del hogar."""
    dueno = str(fila["user_id"])
    hogar_id = _hogar_de_fila(fila)
    if hogar_id is None:
        if dueno != actor:
            return None
        return "administrador"
    rol = await _rol_miembro(conn, actor, hogar_id)
    if rol is None:
        return None
    if rol == "asociado" and dueno != actor:
        return None
    return rol


async def _puede_leer(conn, actor: str, fila, _estado: str) -> str | None:
    """Lectura de cualquier carga del hogar. Escribir sigue en ``_puede_ver``."""
    rol = await _puede_ver(conn, actor, fila)
    if rol is not None:
        return rol
    hogar_id = _hogar_de_fila(fila)
    if hogar_id is None:
        return None
    if await _rol_miembro(conn, actor, hogar_id) is None:
        return None
    return "asociado"


async def _ambito(user_id: str, hogar_id: str | None, rol: str | None) -> tuple[str | None, str]:
    if isinstance(hogar_id, str) and hogar_id.strip():
        hogar = hogar_id.strip()
    else:
        hogar = await hogar_por_defecto(user_id)
    return hogar, _papel(rol)


def _donde_libro(user_id: str, hogar_id: str, rol: str, alias: str = "") -> tuple[str, list]:
    prefijo = f"{alias}." if alias else ""
    if rol == "asociado":
        return f"{prefijo}hogar_id = ? AND {prefijo}user_id = ?", [hogar_id, user_id]
    return f"{prefijo}hogar_id = ?", [hogar_id]


async def _ubicar(conn, documento_id: str):
    cursor = await conn.execute(
        """
        SELECT id, user_id, hogar_id, texto, campos_json, advertencias_json, creado_en
        FROM borradores
        WHERE id = ?
        """,
        (documento_id,),
    )
    borrador = await cursor.fetchone()
    if borrador is not None:
        return "borrador", borrador
    cursor = await conn.execute(
        f"""
        SELECT {_COLUMNAS_PUBLICAS}, texto, confirmado_en, user_id, hogar_id
        FROM comprobantes
        WHERE id = ?
        """,
        (documento_id,),
    )
    confirmado = await cursor.fetchone()
    if confirmado is None:
        return None
    return "confirmado", confirmado


async def _categoria_para_gasto(conn, hogar_id: str, categoria: object) -> str:
    """Clave fija, o el nombre canónico de una categoría de ese hogar."""
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
        WHERE hogar_id = ? AND nombre = ? COLLATE NOCASE
        """,
        (hogar_id, texto),
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
    hogar_id: str,
    rol: str,
    categoria: str | None,
    periodo_desde: str | None,
    periodo_hasta: str | None,
    proveedor: str | None,
) -> tuple[str, list]:
    donde, parametros = _donde_libro(user_id, hogar_id, rol)
    clausulas = [donde, _NO_ANULADO]
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


def _autor(fila, rol: str) -> str | None:
    if rol == "asociado" or not _tiene(fila, "autor_email"):
        return None
    email = fila["autor_email"]
    if isinstance(email, str) and email:
        return email
    return None


async def _hogar_de_fila_o_defecto(conn, fila) -> str:
    hogar = _hogar_de_fila(fila)
    if hogar:
        return hogar
    hogar = await _hogar_defecto_conn(conn, str(fila["user_id"]))
    if not hogar:
        raise ValueError("Falta el hogar")
    return hogar


async def guardar_borrador(
    *,
    user_id: str,
    texto: str,
    campos: dict,
    advertencias: list[str],
    hogar_id: str | None = None,
) -> str:
    if not isinstance(advertencias, list) or any(not isinstance(item, str) for item in advertencias):
        raise ValueError("advertencias tiene que ser una lista de strings")
    if isinstance(hogar_id, str) and hogar_id.strip():
        hogar = hogar_id.strip()
    else:
        hogar = await hogar_por_defecto(user_id)
    if not hogar:
        raise ValueError("Falta el hogar")
    documento_id = str(uuid.uuid4())
    async with db.conectar() as conn:
        await conn.execute(
            """
            INSERT INTO borradores (
                id, user_id, hogar_id, texto, campos_json, advertencias_json, creado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                documento_id,
                user_id,
                hogar,
                texto,
                json.dumps(_campos_publicos(campos), ensure_ascii=False),
                json.dumps(list(advertencias), ensure_ascii=False),
                _ahora(),
            ),
        )
    return documento_id


async def acceso_documento(*, user_id: str, documento_id: str) -> dict | None:
    """Dueño, hogar, rol y estado si el actor puede ver la fila. Si no, None."""
    async with db.conectar() as conn:
        ubicado = await _ubicar(conn, documento_id)
        if ubicado is None:
            return None
        estado, fila = ubicado
        rol = await _puede_leer(conn, user_id, fila, estado)
        if rol is None:
            return None
        return {
            "user_id": str(fila["user_id"]),
            "hogar_id": _hogar_de_fila(fila),
            "rol": rol,
            "estado": estado,
        }


async def _email_de(conn, user_id: str) -> str | None:
    cursor = await conn.execute("SELECT email FROM usuarios WHERE user_id = ?", (user_id,))
    fila = await cursor.fetchone()
    if fila is None:
        return None
    email = fila["email"]
    return email if isinstance(email, str) and email.strip() else None


async def obtener_documento(*, user_id: str, documento_id: str) -> dict | None:
    async with db.conectar() as conn:
        ubicado = await _ubicar(conn, documento_id)
        if ubicado is None:
            return None
        estado, fila = ubicado
        if await _puede_leer(conn, user_id, fila, estado) is None:
            return None
        email = await _email_de(conn, str(fila["user_id"]))
        if estado == "borrador":
            datos = {
                "id": fila["id"],
                "estado": "borrador",
                "campos": _campos_publicos(json.loads(fila["campos_json"])),
                "texto": fila["texto"],
                "advertencias": json.loads(fila["advertencias_json"]),
            }
            creado = fila["creado_en"]
            if isinstance(creado, str) and creado:
                datos["creado_en"] = creado
            if email:
                datos["autor_email"] = email
            return datos
        datos = _documento_confirmado(fila, con_texto=False)
        marca = fila["confirmado_en"]
        if isinstance(marca, str) and marca:
            datos["confirmado_en"] = marca
        if email:
            datos["autor_email"] = email
        return datos


async def listar_documentos(
    *, user_id: str, hogar_id: str | None = None, rol: str | None = None
) -> list[dict]:
    hogar, _papel = await _ambito(user_id, hogar_id, rol)
    if not hogar:
        return []
    # Cualquier miembro lee el libro. Confirmar, descartar y anular siguen en _puede_ver.
    donde_b, params_b = _donde_libro(user_id, hogar, "administrador", "b")
    donde_c, params_c = _donde_libro(user_id, hogar, "administrador", "c")
    async with db.conectar() as conn:
        cursor = await conn.execute(
            f"""
            SELECT b.id, b.campos_json, b.creado_en, u.email AS autor_email
            FROM borradores AS b
            LEFT JOIN usuarios AS u ON u.user_id = b.user_id
            WHERE {donde_b}
            """,
            params_b,
        )
        borradores = await cursor.fetchall()
        cursor = await conn.execute(
            f"""
            SELECT c.id, c.proveedor, c.categoria, c.periodo, c.monto_centavos,
                   c.moneda, c.numero_comprobante, c.anulado, c.indexado,
                   c.cambios_json, c.confirmado_en, u.email AS autor_email
            FROM comprobantes AS c
            LEFT JOIN usuarios AS u ON u.user_id = c.user_id
            WHERE {donde_c}
            """,
            params_c,
        )
        confirmados = await cursor.fetchall()
    ordenados: list[tuple[str, dict]] = []
    for fila in borradores:
        item = {
            "id": fila["id"],
            "estado": "borrador",
            "campos": _campos_publicos(json.loads(fila["campos_json"])),
        }
        email = _autor(fila, "administrador")
        if email:
            item["autor_email"] = email
        ordenados.append((fila["creado_en"], item))
    for fila in confirmados:
        item = _documento_confirmado(fila, con_texto=False)
        email = _autor(fila, "administrador")
        if email:
            item["autor_email"] = email
        ordenados.append((fila["confirmado_en"], item))
    ordenados.sort(key=lambda par: par[0], reverse=True)
    return [item for _, item in ordenados]


async def confirmar_documento(*, user_id: str, documento_id: str, campos: dict) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            ubicado = await _ubicar(conn, documento_id)
            if ubicado is None:
                await _rollback(conn)
                return None
            estado, fila = ubicado
            if await _puede_ver(conn, user_id, fila) is None:
                await _rollback(conn)
                return None
            if estado == "confirmado":
                datos = _con_hogar(_documento_confirmado(fila, con_texto=True), fila)
                await _rollback(conn)
                return datos
            if not isinstance(campos, dict):
                raise ValueError("campos inválidos")
            hogar = await _hogar_de_fila_o_defecto(conn, fila)
            dueno = str(fila["user_id"])
            resueltos = dict(campos)
            resueltos["categoria"] = await _categoria_para_gasto(
                conn, hogar, campos.get("categoria")
            )
            datos = _preparar_confirmacion(resueltos, catalogo=True)
            texto = fila["texto"]
            crudo = json.loads(fila["campos_json"] or "{}")
            extraidos = _campos_publicos(crudo if isinstance(crudo, dict) else {})
            publicos = _campos_desde_datos(datos)
            cambios = _diferencias(extraidos, publicos)
            await conn.execute(
                """
                INSERT INTO comprobantes (
                    id, user_id, hogar_id, proveedor, categoria, periodo, monto_centavos,
                    moneda, numero_comprobante, texto, confirmado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    documento_id,
                    dueno,
                    hogar,
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
                    dueno,
                ),
            )
            await conn.execute(
                "DELETE FROM borradores WHERE id = ? AND user_id = ?",
                (documento_id, dueno),
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
        "user_id": dueno,
        "hogar_id": hogar,
        "recien_confirmado": True,
    }


async def resumen(
    *,
    user_id: str,
    desde: str,
    hasta: str,
    hogar_id: str | None = None,
    rol: str | None = None,
) -> dict:
    hogar, papel = await _ambito(user_id, hogar_id, rol)
    if not hogar:
        return {"por_mes": [], "por_categoria": [], "comprobantes": []}
    donde, base = _donde_libro(user_id, hogar, papel)
    parametros = [*base, desde, hasta]
    async with db.conectar() as conn:
        por_mes = await _sumar_grupo(conn, "periodo", donde, parametros)
        por_categoria = await _sumar_grupo(conn, "categoria", donde, parametros)
        cursor = await conn.execute(
            f"""
            SELECT {_COLUMNAS_PUBLICAS}
            FROM comprobantes
            WHERE {donde} AND periodo >= ? AND periodo <= ?
              AND {_NO_ANULADO}
            ORDER BY periodo ASC, id ASC
            """,
            parametros,
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


async def _sumar_grupo(conn, columna: str, donde: str, parametros: list):
    if columna not in {"periodo", "categoria"}:
        raise ValueError("columna inválida")
    cursor = await conn.execute(
        f"""
        SELECT {columna} AS clave, COALESCE(SUM(monto_centavos), 0) AS suma
        FROM comprobantes
        WHERE {donde} AND periodo >= ? AND periodo <= ?
          AND {_NO_ANULADO}
        GROUP BY {columna}
        ORDER BY {columna} ASC
        """,
        parametros,
    )
    return await cursor.fetchall()


def _gastos_vacios() -> dict:
    return {
        "total": "0.00",
        "promedio": "0.00",
        "cantidad": 0,
        "por_mes": [],
        "por_categoria": [],
        "por_proveedor": [],
    }


async def consultar_gastos(
    *,
    user_id: str,
    categoria: str | None = None,
    periodo_desde: str | None = None,
    periodo_hasta: str | None = None,
    proveedor: str | None = None,
    hogar_id: str | None = None,
    rol: str | None = None,
) -> dict:
    hogar, papel = await _ambito(user_id, hogar_id, rol)
    if not hogar:
        return _gastos_vacios()
    where, parametros = _filtros(
        user_id=user_id,
        hogar_id=hogar,
        rol=papel,
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
    también borra la caché del resumen de ese hogar.
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
            hogar = await _hogar_defecto_conn(conn, user_id)
            if not hogar:
                await _rollback(conn)
                raise ValueError("Falta el hogar")
            await conn.execute(
                """
                INSERT INTO comprobantes (
                    id, user_id, hogar_id, proveedor, categoria, periodo, monto_centavos,
                    moneda, numero_comprobante, texto, confirmado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    documento_id,
                    user_id,
                    hogar,
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

    await invalidar_publicado(hogar)
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
    """Borra el borrador si el actor puede verlo. No toca confirmados."""
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT user_id, hogar_id FROM borradores WHERE id = ?",
                (documento_id,),
            )
            fila = await cursor.fetchone()
            if fila is None or await _puede_ver(conn, user_id, fila) is None:
                await _rollback(conn)
                return False
            await conn.execute(
                "DELETE FROM borradores WHERE id = ? AND user_id = ?",
                (documento_id, fila["user_id"]),
            )
            cursor = await conn.execute("SELECT changes()")
            cambios = await cursor.fetchone()
            if cambios is None or int(cambios[0]) != 1:
                await _rollback(conn)
                return False
            await conn.commit()
        except Exception:
            await _rollback(conn)
            raise
    return True


async def eliminar_comprobante(*, user_id: str, documento_id: str) -> bool:
    """Borra el confirmado. Un asociado que lo ve no puede: 403 vía excepción."""
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT user_id, hogar_id FROM comprobantes WHERE id = ?",
                (documento_id,),
            )
            fila = await cursor.fetchone()
            if fila is None:
                await _rollback(conn)
                return False
            rol = await _puede_ver(conn, user_id, fila)
            if rol is None:
                await _rollback(conn)
                return False
            if rol != "administrador":
                await _rollback(conn)
                raise AccesoDenegado(documento_id)
            await conn.execute(
                "DELETE FROM comprobantes WHERE id = ? AND user_id = ?",
                (documento_id, fila["user_id"]),
            )
            cursor = await conn.execute("SELECT changes()")
            cambios = await cursor.fetchone()
            if cambios is None or int(cambios[0]) != 1:
                await _rollback(conn)
                return False
            await conn.commit()
        except AccesoDenegado:
            raise
        except Exception:
            await _rollback(conn)
            raise
    return True


async def anular_comprobante(*, user_id: str, documento_id: str) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}, user_id, hogar_id
                FROM comprobantes
                WHERE id = ?
                """,
                (documento_id,),
            )
            fila = await cursor.fetchone()
            if fila is None:
                await _rollback(conn)
                return None
            rol = await _puede_ver(conn, user_id, fila)
            if rol is None:
                await _rollback(conn)
                return None
            if rol != "administrador":
                await _rollback(conn)
                raise AccesoDenegado(documento_id)
            dueno = str(fila["user_id"])
            await conn.execute(
                """
                UPDATE comprobantes
                SET anulado = 1
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, dueno),
            )
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}, user_id, hogar_id
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, dueno),
            )
            actualizado = await cursor.fetchone()
            await conn.commit()
        except AccesoDenegado:
            raise
        except Exception:
            await _rollback(conn)
            raise
    if actualizado is None:
        return None
    return _con_hogar(_documento_confirmado(actualizado, con_texto=False), actualizado)


async def corregir_comprobante(*, user_id: str, documento_id: str, campos: dict) -> dict | None:
    async with db.conectar() as conn:
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}, user_id, hogar_id
                FROM comprobantes
                WHERE id = ?
                """,
                (documento_id,),
            )
            fila = await cursor.fetchone()
            if fila is None:
                await _rollback(conn)
                return None
            rol = await _puede_ver(conn, user_id, fila)
            if rol is None:
                await _rollback(conn)
                return None
            if rol != "administrador":
                await _rollback(conn)
                raise AccesoDenegado(documento_id)
            if not isinstance(campos, dict):
                raise ValueError("campos inválidos")
            hogar = await _hogar_de_fila_o_defecto(conn, fila)
            dueno = str(fila["user_id"])
            resueltos = dict(campos)
            resueltos["categoria"] = await _categoria_para_gasto(
                conn, hogar, campos.get("categoria")
            )
            datos = _preparar_confirmacion(resueltos, catalogo=True)
            nuevos = _campos_desde_datos(datos)
            cambios = _leer_cambios(fila["cambios_json"])
            cambios.extend(_diferencias(_campos_desde_fila(fila), nuevos))
            await conn.execute(
                """
                UPDATE comprobantes
                SET proveedor = ?, categoria = ?, periodo = ?, monto_centavos = ?,
                    moneda = ?, numero_comprobante = ?, cambios_json = ?, hogar_id = ?
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
                    hogar,
                    documento_id,
                    dueno,
                ),
            )
            cursor = await conn.execute(
                f"""
                SELECT {_COLUMNAS_PUBLICAS}, user_id, hogar_id
                FROM comprobantes
                WHERE id = ? AND user_id = ?
                """,
                (documento_id, dueno),
            )
            actualizado = await cursor.fetchone()
            await conn.commit()
        except AccesoDenegado:
            raise
        except Exception:
            await _rollback(conn)
            raise
    if actualizado is None:
        return None
    return _con_hogar(_documento_confirmado(actualizado, con_texto=False), actualizado)


async def exportar_csv(
    *,
    user_id: str,
    desde: str,
    hasta: str,
    hogar_id: str | None = None,
    rol: str | None = None,
) -> str:
    hogar, papel = await _ambito(user_id, hogar_id, rol)
    filas = []
    if hogar:
        donde, base = _donde_libro(user_id, hogar, papel)
        async with db.conectar() as conn:
            cursor = await conn.execute(
                f"""
                SELECT id, proveedor, categoria, periodo, monto_centavos, moneda,
                       numero_comprobante
                FROM comprobantes
                WHERE {donde} AND periodo >= ? AND periodo <= ?
                  AND {_NO_ANULADO}
                ORDER BY periodo ASC, id ASC
                """,
                (*base, desde, hasta),
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
