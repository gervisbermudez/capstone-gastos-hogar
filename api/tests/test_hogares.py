"""Hogares y membresías. No usa Redis ni la red."""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import db, rag, repositorio
from app.extraccion import ArchivoRechazado
from app.ingesta import descartar
from app.rutas_auth import router as router_auth
from app.rutas_hogares import router as router_hogares

CLAVE = "una frase larga"
DETALLE_HOGAR_OCUPADO = (
    "No se puede borrar la cuenta mientras seas administrador "
    "de un hogar con otros miembros"
)

_ESQUEMA_VIEJO = """
CREATE TABLE usuarios (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nombre TEXT
);
CREATE TABLE borradores (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    texto TEXT NOT NULL,
    campos_json TEXT NOT NULL,
    advertencias_json TEXT NOT NULL,
    creado_en TEXT NOT NULL
);
CREATE TABLE comprobantes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    proveedor TEXT NOT NULL,
    categoria TEXT NOT NULL,
    periodo TEXT NOT NULL,
    monto_centavos INTEGER NOT NULL,
    moneda TEXT NOT NULL,
    numero_comprobante TEXT,
    texto TEXT NOT NULL,
    confirmado_en TEXT NOT NULL,
    indexado TEXT
);
CREATE TABLE mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    rol TEXT NOT NULL,
    texto TEXT NOT NULL,
    creado_en TEXT NOT NULL
);
CREATE TABLE hilos_estado (
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('archivado', 'eliminado')),
    PRIMARY KEY (user_id, thread_id)
);
CREATE TABLE categorias (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    creado_en TEXT NOT NULL
);
"""


class _IndiceMudo:
    def delete(self, **_kwargs) -> None:
        return


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-aislado-con-32-bytes")


def _aislar_indice(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rag, "INDICE_LOCAL", tmp_path / "comprobantes.jsonl")
    monkeypatch.setattr(rag, "_documentos", [])
    monkeypatch.setattr(rag, "_store_pinecone", lambda: _IndiceMudo())


class _RedisMudo:
    def __init__(self) -> None:
        self.mensajes: list[tuple[str, str]] = []

    async def publish(self, canal: str, mensaje: str) -> int:
        self.mensajes.append((canal, mensaje))
        return 1


class _RedisRoto:
    async def publish(self, canal: str, mensaje: str) -> int:
        raise RuntimeError(canal)


def _cliente(redis: _RedisMudo | _RedisRoto | None = None) -> TestClient:
    aplicacion = FastAPI()
    if redis is not None:
        aplicacion.state.redis = redis
    aplicacion.include_router(router_auth)
    aplicacion.include_router(router_hogares)
    return TestClient(aplicacion)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _registrar(cliente: TestClient, email: str, password: str = CLAVE) -> dict:
    respuesta = cliente.post("/auth/registro", json={"email": email, "password": password})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _listar(cliente: TestClient, headers: dict[str, str]) -> list[dict]:
    respuesta = cliente.get("/hogares", headers=headers)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()["items"]


def _baja(cliente: TestClient, token: str, password: str = CLAVE):
    return cliente.request(
        "DELETE",
        "/auth/cuenta",
        json={"password": password},
        headers=_bearer(token),
    )


def _mi_hogar(items: list[dict]) -> dict:
    return next(item for item in items if item["nombre"] == "Mi hogar")


async def _cifras() -> tuple[int, int, int]:
    async with db.conectar() as conn:
        cifras = []
        for tabla in ("usuarios", "hogares", "membresias"):
            cursor = await conn.execute(f"SELECT COUNT(*) FROM {tabla}")
            fila = await cursor.fetchone()
            cifras.append(int(fila[0]))
    return cifras[0], cifras[1], cifras[2]


def test_el_registro_crea_mi_hogar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        assert cliente.get("/hogares").status_code == 401
        alta = _registrar(cliente, "ada@example.com")
        user_id = alta["user_id"]
        headers = _bearer(alta["access_token"])
        items = _listar(cliente, headers)
        assert len(items) == 1
        hogar = items[0]
        assert hogar["nombre"] == "Mi hogar"
        assert hogar["direccion"] is None
        assert hogar["rol"] == "administrador"
        assert hogar["id"]
        assert "password" not in cliente.get("/hogares", headers=headers).text

        async def defecto() -> None:
            assert await repositorio.hogar_por_defecto(user_id) == hogar["id"]
            assert await repositorio.membresia(user_id, hogar["id"]) == "administrador"
            assert await repositorio.membresia(user_id, "no-existe") is None
            assert await repositorio.hogar_por_defecto("nadie") is None

        asyncio.run(defecto())

        duplicado = cliente.post(
            "/auth/registro",
            json={"email": "Ada@Example.com", "password": "otra frase distinta"},
        )
        assert duplicado.status_code == 409
        assert _listar(cliente, headers) == items
        assert asyncio.run(_cifras()) == (1, 1, 1)


def test_crear_otro_hogar_y_listar_los_dos(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "ada@example.com")
        headers = _bearer(alta["access_token"])
        primero = _mi_hogar(_listar(cliente, headers))

        creado = cliente.post(
            "/hogares",
            json={"nombre": "  Departamento  ", "direccion": "  Calle 1  "},
            headers=headers,
        )
        assert creado.status_code == 201
        cuerpo = creado.json()
        assert cuerpo["nombre"] == "Departamento"
        assert cuerpo["direccion"] == "Calle 1"
        assert cuerpo["rol"] == "administrador"
        assert cuerpo["id"] != primero["id"]

        por_nombre = {item["nombre"]: item for item in _listar(cliente, headers)}
        assert set(por_nombre) == {"Mi hogar", "Departamento"}
        assert all(item["rol"] == "administrador" for item in por_nombre.values())

        async def defecto() -> None:
            assert await repositorio.hogar_por_defecto(alta["user_id"]) == primero["id"]
            assert await repositorio.membresia(alta["user_id"], cuerpo["id"]) == "administrador"

        asyncio.run(defecto())

        editado = cliente.patch(
            f"/hogares/{cuerpo['id']}",
            json={"nombre": "  PH  ", "direccion": "   "},
            headers=headers,
        )
        assert editado.status_code == 200
        assert editado.json() == {
            "id": cuerpo["id"],
            "nombre": "PH",
            "direccion": None,
            "rol": "administrador",
        }

        for respuesta in (
            cliente.post("/hogares", json={"nombre": "   "}, headers=headers),
            cliente.post("/hogares", json={"nombre": "a" * 81}, headers=headers),
            cliente.post(
                "/hogares",
                json={"nombre": "Casa", "direccion": "d" * 161},
                headers=headers,
            ),
            cliente.post(
                "/hogares",
                json={"nombre": "Casa", "user_id": alta["user_id"]},
                headers=headers,
            ),
            cliente.patch(
                f"/hogares/{cuerpo['id']}",
                json={"nombre": "PH", "rol": "asociado"},
                headers=headers,
            ),
        ):
            assert respuesta.status_code == 422

        justo = cliente.post(
            "/hogares",
            json={"nombre": f"  {'n' * 80}  ", "direccion": f"  {'d' * 160}  "},
            headers=headers,
        )
        assert justo.status_code == 201
        assert justo.json()["nombre"] == "n" * 80
        assert justo.json()["direccion"] == "d" * 160
        assert {item["nombre"] for item in _listar(cliente, headers)} == {
            "Mi hogar",
            "PH",
            "n" * 80,
        }


def test_otro_usuario_no_ve_el_hogar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]

        assert all(item["id"] != hogar_id for item in _listar(cliente, headers_grace))
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_grace)
        cambio = cliente.patch(
            f"/hogares/{hogar_id}",
            json={"nombre": "Robado"},
            headers=headers_grace,
        )
        assert miembros.status_code == 404
        assert cambio.status_code == 404
        assert _mi_hogar(_listar(cliente, headers_ada))["nombre"] == "Mi hogar"
        assert _mi_hogar(_listar(cliente, headers_grace))["id"] != hogar_id


def test_el_administrador_agrega_por_email(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers = _bearer(ada["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers))["id"]

        async def segundo_admin() -> None:
            async with db.conectar() as conn:
                await conn.execute(
                    """
                    INSERT INTO membresias (hogar_id, user_id, rol)
                    VALUES (?, ?, 'administrador')
                    """,
                    (hogar_id, grace["user_id"]),
                )

        with pytest.raises(Exception) as error:
            asyncio.run(segundo_admin())
        assert error.type.__name__ == "IntegrityError"

        async def todavia_no() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) is None

        asyncio.run(todavia_no())

        nadie = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "nadie@example.com"},
            headers=headers,
        )
        assert nadie.status_code == 404
        vacio = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "   "},
            headers=headers,
        )
        assert vacio.status_code == 422

        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "  Grace@Example.com "},
            headers=headers,
        )
        assert alta.status_code == 201
        assert alta.json() == {
            "user_id": grace["user_id"],
            "email": "grace@example.com",
            "nombre": None,
            "rol": "asociado",
        }
        assert "password" not in alta.text

        repetido = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers,
        )
        mismo = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "ada@example.com"},
            headers=headers,
        )
        assert repetido.status_code == 409
        assert mismo.status_code == 409

        nombre = cliente.post(
            "/auth/nombre",
            json={"nombre": "Grace"},
            headers=_bearer(grace["access_token"]),
        )
        assert nombre.status_code == 200
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers)
        assert miembros.status_code == 200
        por_id = {item["user_id"]: item for item in miembros.json()["items"]}
        assert set(por_id) == {ada["user_id"], grace["user_id"]}
        assert por_id[ada["user_id"]]["rol"] == "administrador"
        assert por_id[ada["user_id"]]["email"] == "ada@example.com"
        assert por_id[grace["user_id"]]["rol"] == "asociado"
        assert por_id[grace["user_id"]]["nombre"] == "Grace"
        assert por_id[grace["user_id"]]["email"] == "grace@example.com"

        async def rol() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) == "asociado"

        asyncio.run(rol())


def test_el_asociado_no_administra(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        sumar = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "ada@example.com"},
            headers=headers_grace,
        )
        editar = cliente.patch(
            f"/hogares/{hogar_id}",
            json={"nombre": "Otro"},
            headers=headers_grace,
        )
        ver = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_grace)
        quitar = cliente.delete(
            f"/hogares/{hogar_id}/miembros/{ada['user_id']}",
            headers=headers_grace,
        )
        for respuesta in (sumar, editar, ver, quitar):
            assert respuesta.status_code == 404

        assert _mi_hogar(_listar(cliente, headers_ada))["nombre"] == "Mi hogar"
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert {item["user_id"] for item in miembros.json()["items"]} == {
            ada["user_id"],
            grace["user_id"],
        }
        compartido = next(
            item for item in _listar(cliente, headers_grace) if item["id"] == hogar_id
        )
        assert compartido["rol"] == "asociado"


def test_no_se_quita_al_administrador_y_si_al_asociado(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        no = cliente.delete(
            f"/hogares/{hogar_id}/miembros/{ada['user_id']}",
            headers=headers_ada,
        )
        assert no.status_code == 409
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert {item["user_id"] for item in miembros.json()["items"]} == {
            ada["user_id"],
            grace["user_id"],
        }

        ajeno = cliente.delete(
            f"/hogares/{hogar_id}/miembros/{uuid.uuid4()}",
            headers=headers_ada,
        )
        assert ajeno.status_code == 404

        si = cliente.delete(
            f"/hogares/{hogar_id}/miembros/{grace['user_id']}",
            headers=headers_ada,
        )
        assert si.status_code == 204
        assert si.content == b""
        despues = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert [item["user_id"] for item in despues.json()["items"]] == [ada["user_id"]]
        assert all(item["id"] != hogar_id for item in _listar(cliente, headers_grace))
        assert _mi_hogar(_listar(cliente, headers_grace))["rol"] == "administrador"

        async def membresias() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) is None
            assert await repositorio.membresia(ada["user_id"], hogar_id) == "administrador"

        asyncio.run(membresias())


def test_el_asociado_puede_desasociarse(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        async def cargas() -> tuple[str, str]:
            borrador_id = await repositorio.guardar_borrador(
                user_id=grace["user_id"],
                hogar_id=hogar_id,
                texto="borrador de grace",
                campos={"proveedor": "Edenor"},
                advertencias=[],
            )
            confirmado_id = await repositorio.guardar_borrador(
                user_id=grace["user_id"],
                hogar_id=hogar_id,
                texto="factura de grace",
                campos={"proveedor": "Metrogas", "monto": "4.00"},
                advertencias=[],
            )
            await repositorio.confirmar_documento(
                user_id=grace["user_id"],
                documento_id=confirmado_id,
                campos={
                    "proveedor": "Metrogas",
                    "categoria": "servicios",
                    "periodo": "2026-03",
                    "monto": "4.00",
                    "moneda": "ARS",
                },
            )
            return borrador_id, confirmado_id

        async def contar_cargas() -> tuple[int, int]:
            async with db.conectar() as conn:
                borradores = await (
                    await conn.execute("SELECT COUNT(*) FROM borradores")
                ).fetchone()
                comprobantes = await (
                    await conn.execute("SELECT COUNT(*) FROM comprobantes")
                ).fetchone()
            return int(borradores[0]), int(comprobantes[0])

        borrador_id, confirmado_id = asyncio.run(cargas())
        assert asyncio.run(contar_cargas()) == (1, 1)
        sin_sesion = cliente.delete(f"/hogares/{hogar_id}/membresia")
        assert sin_sesion.status_code == 401
        ajeno = cliente.delete(
            f"/hogares/{uuid.uuid4()}/membresia",
            headers=headers_grace,
        )
        assert ajeno.status_code == 404
        assert ajeno.json()["detail"] == "No existe ese hogar"

        salida = cliente.delete(f"/hogares/{hogar_id}/membresia", headers=headers_grace)
        assert salida.status_code == 204
        assert salida.content == b""
        otra = cliente.delete(f"/hogares/{hogar_id}/membresia", headers=headers_grace)
        assert otra.status_code == 404

        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert [item["user_id"] for item in miembros.json()["items"]] == [ada["user_id"]]
        assert all(item["id"] != hogar_id for item in _listar(cliente, headers_grace))
        propio = _mi_hogar(_listar(cliente, headers_grace))
        assert propio["rol"] == "administrador"
        assert propio["id"] != hogar_id

        assert asyncio.run(contar_cargas()) == (1, 1)

        async def libro() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) is None
            assert await repositorio.membresia(ada["user_id"], hogar_id) == "administrador"
            vistos = await repositorio.listar_documentos(
                user_id=ada["user_id"],
                hogar_id=hogar_id,
                rol="administrador",
            )
            assert {item["id"] for item in vistos} == {borrador_id, confirmado_id}
            for documento_id in (borrador_id, confirmado_id):
                assert (
                    await repositorio.obtener_documento(
                        user_id=ada["user_id"],
                        documento_id=documento_id,
                    )
                ) is not None
                assert (
                    await repositorio.obtener_documento(
                        user_id=grace["user_id"],
                        documento_id=documento_id,
                    )
                ) is None
                with pytest.raises(ArchivoRechazado) as rechazo:
                    await descartar(user_id=grace["user_id"], documento_id=documento_id)
                assert rechazo.value.status == 404
            assert await descartar(user_id=ada["user_id"], documento_id=borrador_id) == hogar_id
            assert await descartar(user_id=ada["user_id"], documento_id=confirmado_id) == hogar_id
            assert await repositorio.listar_documentos(
                user_id=ada["user_id"],
                hogar_id=hogar_id,
                rol="administrador",
            ) == []

        asyncio.run(libro())
        assert asyncio.run(contar_cargas()) == (0, 0)


def test_el_administrador_no_puede_desasociarse(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        de_grace = _mi_hogar(_listar(cliente, _bearer(grace["access_token"])))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        no = cliente.delete(f"/hogares/{hogar_id}/membresia", headers=headers_ada)
        assert no.status_code == 409
        assert no.json()["detail"] == "No se puede dejar un hogar que administrás"
        ajeno = cliente.delete(f"/hogares/{de_grace}/membresia", headers=headers_ada)
        assert ajeno.status_code == 404

        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert {item["user_id"] for item in miembros.json()["items"]} == {
            ada["user_id"],
            grace["user_id"],
        }

        async def sigue() -> None:
            assert await repositorio.membresia(ada["user_id"], hogar_id) == "administrador"
            assert await repositorio.membresia(grace["user_id"], hogar_id) == "asociado"

        asyncio.run(sigue())


def test_la_salida_avisa_al_administrador(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    redis = _RedisMudo()
    with _cliente(redis) as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        nombre = cliente.post(
            "/auth/nombre",
            json={"nombre": "Grace Hopper"},
            headers=headers_grace,
        )
        assert nombre.status_code == 200
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201
        assert len(redis.mensajes) == 1

        salida = cliente.delete(f"/hogares/{hogar_id}/membresia", headers=headers_grace)
        assert salida.status_code == 204
        assert len(redis.mensajes) == 2
        canal, crudo = redis.mensajes[1]
        assert ada["user_id"] in canal
        assert grace["user_id"] not in canal
        evento = json.loads(crudo)
        assert evento["tipo"] == "hogar.membresia"
        assert evento["recurso"] == {"clase": "hogar", "id": hogar_id}
        assert evento["payload"] == {
            "hogar_id": hogar_id,
            "nombre": "Mi hogar",
            "cambio": "baja",
        }
        aviso = evento["notificacion"]
        assert aviso["titulo"] == "Alguien se desasoció"
        assert aviso["cuerpo"] == "Grace Hopper se desasoció de Mi hogar."
        assert aviso["accion"] == {
            "etiqueta": "Ver hogar",
            "ruta": f"/opciones?hogar={hogar_id}#hogar",
        }

        async def bandeja() -> None:
            de_ada = await repositorio.listar_notificaciones(user_id=ada["user_id"])
            assert de_ada["no_leidas"] == 1
            assert de_ada["items"][0]["cuerpo"] == aviso["cuerpo"]
            de_grace = await repositorio.listar_notificaciones(user_id=grace["user_id"])
            assert de_grace["no_leidas"] == 1
            assert de_grace["items"][0]["titulo"] == "Te sumaron a un hogar"

        asyncio.run(bandeja())


def test_la_salida_sigue_si_redis_no_publica(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente(_RedisRoto()) as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        salida = cliente.delete(f"/hogares/{hogar_id}/membresia", headers=headers_grace)
        assert salida.status_code == 204
        assert salida.content == b""

        async def quedo() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) is None
            lista = await repositorio.listar_notificaciones(user_id=ada["user_id"])
            assert lista["no_leidas"] == 1
            assert lista["items"][0]["titulo"] == "Alguien se desasoció"

        asyncio.run(quedo())


def test_no_se_borra_la_cuenta_si_el_hogar_tiene_miembros(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _aislar_indice(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201
        cabaña = cliente.post("/hogares", json={"nombre": "Cabaña"}, headers=headers_ada)
        assert cabaña.status_code == 201

        baja = _baja(cliente, ada["access_token"])
        assert baja.status_code == 409
        assert baja.json()["detail"] == DETALLE_HOGAR_OCUPADO

        yo = cliente.get("/auth/me", headers=headers_ada)
        assert yo.status_code == 200
        assert yo.json()["email"] == "ada@example.com"
        grace_yo = cliente.get("/auth/me", headers=_bearer(grace["access_token"]))
        assert grace_yo.status_code == 200
        assert {item["nombre"] for item in _listar(cliente, headers_ada)} == {
            "Mi hogar",
            "Cabaña",
        }
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert {item["email"] for item in miembros.json()["items"]} == {
            "ada@example.com",
            "grace@example.com",
        }
        assert asyncio.run(_cifras()) == (2, 3, 4)


def test_la_baja_de_un_usuario_solo_sigue_en_204(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _aislar_indice(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "ada@example.com")
        headers = _bearer(alta["access_token"])
        otro = cliente.post("/hogares", json={"nombre": "PH"}, headers=headers)
        assert otro.status_code == 201
        assert asyncio.run(_cifras()) == (1, 2, 2)

        baja = _baja(cliente, alta["access_token"])
        assert baja.status_code == 204
        assert baja.content == b""
        assert cliente.get("/auth/me", headers=headers).status_code == 401
        login = cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE},
        )
        assert login.status_code == 401
        assert asyncio.run(_cifras()) == (0, 0, 0)


def test_el_asociado_puede_borrar_su_cuenta(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _aislar_indice(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        baja = _baja(cliente, grace["access_token"])
        assert baja.status_code == 204
        assert cliente.get("/auth/me", headers=_bearer(grace["access_token"])).status_code == 401
        yo = cliente.get("/auth/me", headers=headers_ada)
        assert yo.status_code == 200
        assert yo.json()["user_id"] == ada["user_id"]
        miembros = cliente.get(f"/hogares/{hogar_id}/miembros", headers=headers_ada)
        assert [item["user_id"] for item in miembros.json()["items"]] == [ada["user_id"]]
        assert asyncio.run(_cifras()) == (1, 1, 1)


def test_migra_al_usuario_que_no_tenia_hogar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        import aiosqlite

        ruta = tmp_path / "gastos.db"
        conn = await aiosqlite.connect(ruta)
        await conn.executescript(_ESQUEMA_VIEJO)
        await conn.execute(
            """
            INSERT INTO usuarios (user_id, email, password_hash, nombre)
            VALUES (?, ?, ?, ?)
            """,
            ("user-viejo", "viejo@example.com", "hash", None),
        )
        await conn.execute(
            """
            INSERT INTO comprobantes (
                id, user_id, proveedor, categoria, periodo, monto_centavos,
                moneda, numero_comprobante, texto, confirmado_en, indexado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "comp-1",
                "user-viejo",
                "Edenor",
                "servicios",
                "2026-03",
                1010,
                "ARS",
                None,
                "texto",
                "2026-03-01T00:00:00+00:00",
                "ok",
            ),
        )
        await conn.execute(
            """
            INSERT INTO borradores (
                id, user_id, texto, campos_json, advertencias_json, creado_en
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("borr-1", "user-viejo", "texto", "{}", "[]", "2026-03-01T00:00:00+00:00"),
        )
        await conn.execute(
            """
            INSERT INTO mensajes (user_id, thread_id, rol, texto, creado_en)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("user-viejo", "hilo-1", "persona", "hola", "2026-03-01T00:00:00+00:00"),
        )
        await conn.execute(
            """
            INSERT INTO hilos_estado (user_id, thread_id, estado)
            VALUES (?, ?, ?)
            """,
            ("user-viejo", "hilo-1", "archivado"),
        )
        await conn.execute(
            """
            INSERT INTO categorias (id, user_id, nombre, descripcion, creado_en)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("cat-1", "user-viejo", "Colegio", None, "2026-03-01T00:00:00+00:00"),
        )
        await conn.commit()
        await conn.close()

        hogares = await repositorio.listar_hogares("user-viejo")
        assert len(hogares) == 1
        assert hogares[0]["nombre"] == "Mi hogar"
        assert hogares[0]["direccion"] is None
        assert hogares[0]["rol"] == "administrador"
        hogar_id = hogares[0]["id"]
        assert await repositorio.hogar_por_defecto("user-viejo") == hogar_id
        assert await repositorio.listar_hogares("user-viejo") == hogares

        revisada = await aiosqlite.connect(ruta)
        revisada.row_factory = aiosqlite.Row
        cursor = await revisada.execute(
            "SELECT hogar_id, indexado FROM comprobantes WHERE id = 'comp-1'"
        )
        comprobante = await cursor.fetchone()
        assert comprobante["hogar_id"] == hogar_id
        assert comprobante["indexado"] is None
        for tabla in ("borradores", "mensajes", "hilos_estado", "categorias"):
            cursor = await revisada.execute(f"SELECT hogar_id FROM {tabla}")
            fila = await cursor.fetchone()
            assert fila is not None
            assert fila["hogar_id"] == hogar_id
            cursor = await revisada.execute(f"PRAGMA table_info({tabla})")
            columnas = {item["name"]: item for item in await cursor.fetchall()}
            assert columnas["hogar_id"]["notnull"] == 0
            cursor = await revisada.execute(f"PRAGMA foreign_key_list({tabla})")
            origenes = {item["from"] for item in await cursor.fetchall()}
            assert "hogar_id" not in origenes
        cursor = await revisada.execute("PRAGMA table_info(comprobantes)")
        columnas = {item["name"]: item for item in await cursor.fetchall()}
        assert columnas["hogar_id"]["notnull"] == 0
        cursor = await revisada.execute("PRAGMA foreign_key_list(comprobantes)")
        origenes = {item["from"] for item in await cursor.fetchall()}
        assert "hogar_id" not in origenes
        cursor = await revisada.execute(
            """
            SELECT sql FROM sqlite_master
            WHERE type = 'index' AND name = 'ux_hogar_administrador'
            """
        )
        indice = await cursor.fetchone()
        assert indice is not None
        assert "administrador" in indice["sql"]

        await revisada.execute(
            "UPDATE comprobantes SET indexado = 'ok' WHERE id = 'comp-1'"
        )
        await revisada.execute(
            """
            INSERT INTO usuarios (user_id, email, password_hash, nombre)
            VALUES ('user-b', 'b@example.com', 'hash', NULL)
            """
        )
        await revisada.execute(
            """
            INSERT INTO comprobantes (
                id, user_id, proveedor, categoria, periodo, monto_centavos,
                moneda, texto, confirmado_en, indexado, hogar_id
            ) VALUES (
                'comp-nuevo', 'user-b', 'Edenor', 'servicios', '2026-04',
                100, 'ARS', 't', '2026-04-01T00:00:00+00:00', 'ok', NULL
            )
            """
        )
        await revisada.execute(
            """
            INSERT INTO comprobantes (
                id, user_id, proveedor, categoria, periodo, monto_centavos,
                moneda, texto, confirmado_en, indexado, hogar_id
            ) VALUES (
                'comp-previo', 'user-b', 'Agua', 'servicios', '2026-04',
                200, 'ARS', 't', '2026-04-01T00:00:00+00:00', 'ok', 'ya-tenia'
            )
            """
        )
        await revisada.commit()
        await revisada.close()

        de_b = await repositorio.listar_hogares("user-b")
        assert len(de_b) == 1
        assert de_b[0]["nombre"] == "Mi hogar"
        assert de_b[0]["rol"] == "administrador"
        assert de_b[0]["id"] != hogar_id
        assert await repositorio.listar_hogares("user-viejo") == hogares

        final = await aiosqlite.connect(ruta)
        final.row_factory = aiosqlite.Row
        cursor = await final.execute(
            "SELECT id, hogar_id, indexado FROM comprobantes ORDER BY id"
        )
        por_id = {fila["id"]: fila for fila in await cursor.fetchall()}
        await final.close()
        assert por_id["comp-1"]["hogar_id"] == hogar_id
        assert por_id["comp-1"]["indexado"] == "ok"
        assert por_id["comp-nuevo"]["hogar_id"] == de_b[0]["id"]
        assert por_id["comp-nuevo"]["indexado"] is None
        assert por_id["comp-previo"]["hogar_id"] == "ya-tenia"
        assert por_id["comp-previo"]["indexado"] == "ok"

        nuevo = await repositorio.crear_usuario("nuevo@example.com", "hash-de-test")
        del_nuevo = await repositorio.listar_hogares(nuevo)
        assert len(del_nuevo) == 1
        assert del_nuevo[0]["nombre"] == "Mi hogar"
        assert del_nuevo[0]["rol"] == "administrador"
        assert del_nuevo[0]["id"] not in {hogar_id, de_b[0]["id"]}
        assert await repositorio.listar_hogares("user-viejo") == hogares
        assert len(await repositorio.listar_hogares("user-b")) == 1

    asyncio.run(caso())


def test_el_alta_avisa_al_asociado_y_la_baja_tambien(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    redis = _RedisMudo()
    with _cliente(redis) as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers = _bearer(ada["access_token"])
        nombre = cliente.post("/auth/nombre", json={"nombre": "Ada Prueba"}, headers=headers)
        assert nombre.status_code == 200
        hogar_id = _mi_hogar(_listar(cliente, headers))["id"]

        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers,
        )
        assert alta.status_code == 201
        assert len(redis.mensajes) == 1
        canal, crudo = redis.mensajes[0]
        assert grace["user_id"] in canal
        evento = json.loads(crudo)
        assert evento["tipo"] == "hogar.membresia"
        assert evento["recurso"] == {"clase": "hogar", "id": hogar_id}
        assert evento["payload"] == {
            "hogar_id": hogar_id,
            "nombre": "Mi hogar",
            "cambio": "alta",
        }
        aviso = evento["notificacion"]
        assert aviso["titulo"] == "Te sumaron a un hogar"
        assert aviso["cuerpo"] == "Ada Prueba te sumó a Mi hogar como asociado."
        assert aviso["accion"] == {
            "etiqueta": "Ver hogar",
            "ruta": f"/opciones?hogar={hogar_id}#hogar",
        }

        async def bandeja() -> None:
            lista = await repositorio.listar_notificaciones(user_id=grace["user_id"])
            assert lista["no_leidas"] == 1
            assert lista["items"][0]["tipo"] == "hogar.membresia"
            assert lista["items"][0]["cuerpo"] == aviso["cuerpo"]

        asyncio.run(bandeja())

        baja = cliente.delete(
            f"/hogares/{hogar_id}/miembros/{grace['user_id']}",
            headers=headers,
        )
        assert baja.status_code == 204
        assert len(redis.mensajes) == 2
        baja_evento = json.loads(redis.mensajes[1][1])
        assert grace["user_id"] in redis.mensajes[1][0]
        assert baja_evento["payload"]["cambio"] == "baja"
        assert baja_evento["notificacion"]["titulo"] == "Te quitaron de un hogar"
        assert baja_evento["notificacion"]["cuerpo"] == "Ya no pertenecés a Mi hogar."
        assert baja_evento["notificacion"]["accion"]["ruta"] == "/opciones#hogar"

        async def las_dos() -> None:
            lista = await repositorio.listar_notificaciones(user_id=grace["user_id"])
            assert lista["no_leidas"] == 2
            assert await repositorio.membresia(grace["user_id"], hogar_id) is None

        asyncio.run(las_dos())


def test_el_asociado_ve_el_tablero_del_hogar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers_ada = _bearer(ada["access_token"])
        headers_grace = _bearer(grace["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers_ada))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers_ada,
        )
        assert alta.status_code == 201

        async def libro() -> str:
            documento_id = await repositorio.guardar_borrador(
                user_id=ada["user_id"],
                hogar_id=hogar_id,
                texto="factura de ada",
                campos={"proveedor": "Edenor", "monto": "10.10"},
                advertencias=[],
            )
            await repositorio.confirmar_documento(
                user_id=ada["user_id"],
                documento_id=documento_id,
                campos={
                    "proveedor": "Edenor",
                    "categoria": "servicios",
                    "periodo": "2026-03",
                    "monto": "10.10",
                    "moneda": "ARS",
                },
            )
            return documento_id

        async def borrador_ajeno() -> str:
            return await repositorio.guardar_borrador(
                user_id=ada["user_id"],
                hogar_id=hogar_id,
                texto="borrador de ada",
                campos={"proveedor": "Metrogas", "monto": "4.00"},
                advertencias=[],
            )

        documento_id = asyncio.run(libro())
        borrador_id = asyncio.run(borrador_ajeno())
        resumen = cliente.get(
            "/resumen",
            params={"desde": "2026-01", "hasta": "2026-12"},
            headers={**headers_grace, "X-Hogar-Id": hogar_id},
        )
        assert resumen.status_code == 200, resumen.text
        cuerpo = resumen.json()
        assert {item["id"] for item in cuerpo["comprobantes"]} == {documento_id}
        assert cuerpo["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        propio = cliente.get(
            "/resumen",
            params={"desde": "2026-01", "hasta": "2026-12"},
            headers=headers_grace,
        )
        assert propio.status_code == 200
        assert propio.json()["comprobantes"] == []
        de_grace = next(item["id"] for item in _listar(cliente, headers_grace) if item["id"] != hogar_id)
        ajeno = cliente.get(
            "/resumen",
            params={"desde": "2026-01", "hasta": "2026-12"},
            headers={**headers_ada, "X-Hogar-Id": de_grace},
        )
        assert ajeno.status_code == 404

        async def lectura() -> None:
            visto = await repositorio.obtener_documento(
                user_id=grace["user_id"],
                documento_id=documento_id,
            )
            assert visto is not None
            assert visto["id"] == documento_id
            assert visto["autor_email"] == "ada@example.com"
            cargas = await repositorio.listar_documentos(
                user_id=grace["user_id"],
                hogar_id=hogar_id,
                rol="asociado",
            )
            assert {item["id"] for item in cargas} == {documento_id, borrador_id}
            assert {item["autor_email"] for item in cargas} == {"ada@example.com"}
            propias = await repositorio.listar_documentos(
                user_id=grace["user_id"],
                rol="asociado",
            )
            assert documento_id not in {item["id"] for item in propias}
            assert borrador_id not in {item["id"] for item in propias}
            abierto = await repositorio.obtener_documento(
                user_id=grace["user_id"],
                documento_id=borrador_id,
            )
            assert abierto is not None
            assert abierto["estado"] == "borrador"
            assert abierto["autor_email"] == "ada@example.com"
            assert (
                await repositorio.descartar_borrador(
                    user_id=grace["user_id"],
                    documento_id=borrador_id,
                )
                is False
            )
            assert (
                await repositorio.confirmar_documento(
                    user_id=grace["user_id"],
                    documento_id=borrador_id,
                    campos={
                        "proveedor": "Metrogas",
                        "categoria": "servicios",
                        "periodo": "2026-03",
                        "monto": "4.00",
                        "moneda": "ARS",
                    },
                )
                is None
            )
            assert (
                await repositorio.anular_comprobante(
                    user_id=grace["user_id"],
                    documento_id=documento_id,
                )
                is None
            )
            assert (
                await repositorio.obtener_documento(
                    user_id="otro",
                    documento_id=documento_id,
                )
                is None
            )

        asyncio.run(lectura())


def test_el_alta_sigue_si_redis_no_publica(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente(_RedisRoto()) as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers = _bearer(ada["access_token"])
        hogar_id = _mi_hogar(_listar(cliente, headers))["id"]
        alta = cliente.post(
            f"/hogares/{hogar_id}/miembros",
            json={"email": "grace@example.com"},
            headers=headers,
        )
        assert alta.status_code == 201
        assert alta.json()["rol"] == "asociado"

        async def quedo() -> None:
            assert await repositorio.membresia(grace["user_id"], hogar_id) == "asociado"
            lista = await repositorio.listar_notificaciones(user_id=grace["user_id"])
            assert lista["no_leidas"] == 1

        asyncio.run(quedo())
