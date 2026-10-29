"""Auth, resumen y aislamiento. No usa Redis ni el lifespan de main."""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import auth, repositorio
from app.rutas_auth import router

FACTURA_A = {
    "proveedor": "Edenor",
    "categoria": "servicios",
    "periodo": "2026-03",
    "monto": "10.10",
    "moneda": "ARS",
}
FACTURA_B = {
    "proveedor": "Consorcio",
    "categoria": "expensas",
    "periodo": "2026-03",
    "monto": "0.20",
    "moneda": "ARS",
}
RANGO = {"desde": "2026-01", "hasta": "2026-12"}


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-aislado-con-32-bytes")


def _cliente() -> TestClient:
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    return TestClient(aplicacion)


def _detalle_sin_campo(respuesta) -> str:
    assert respuesta.status_code == 401
    detalle = respuesta.json()["detail"]
    assert isinstance(detalle, str)
    bajo = detalle.lower()
    assert "email" not in bajo
    assert "password" not in bajo
    assert "contraseña" not in bajo
    assert "correo" not in bajo
    return detalle


def test_registro_duplicado_409(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        primero = cliente.post(
            "/auth/registro",
            json={"email": "ada@example.com", "password": "una frase larga"},
        )
        assert primero.status_code == 201
        cuerpo = primero.json()
        assert cuerpo["token_type"] == "bearer"
        assert cuerpo["user_id"]
        assert "password" not in cuerpo
        payload = jwt.decode(
            cuerpo["access_token"],
            os.environ["JWT_SECRET"],
            algorithms=["HS256"],
        )
        assert payload["sub"] == cuerpo["user_id"]
        assert "email" not in payload
        assert payload["exp"] - payload["iat"] == auth.VIDA_TOKEN_SEGUNDOS

        duplicado = cliente.post(
            "/auth/registro",
            json={"email": "Ada@Example.com", "password": "otra frase distinta"},
        )
        assert duplicado.status_code == 409


def test_login_invalido_401_sin_revelar_campo(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = cliente.post(
            "/auth/registro",
            json={"email": "ada@example.com", "password": "una frase larga"},
        )
        assert alta.status_code == 201

        clave_mal = cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": "no es esa frase"},
        )
        email_mal = cliente.post(
            "/auth/login",
            json={"email": "nadie@example.com", "password": "una frase larga"},
        )
        assert _detalle_sin_campo(clave_mal) == _detalle_sin_campo(email_mal)

        bien = cliente.post(
            "/auth/login",
            json={"email": "Ada@example.com", "password": "una frase larga"},
        )
        assert bien.status_code == 200
        assert bien.json()["user_id"] == alta.json()["user_id"]
        assert bien.json()["token_type"] == "bearer"

        yo = cliente.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {bien.json()['access_token']}"},
        )
        assert yo.status_code == 200
        assert yo.json() == {"user_id": alta.json()["user_id"], "email": "ada@example.com"}
        assert "password_hash" not in yo.json()

        sin_token = cliente.get("/auth/me")
        assert sin_token.status_code == 401
        basura = cliente.get("/auth/me", headers={"Authorization": "Bearer esto-no-es-jwt"})
        assert basura.status_code == 401
        assert basura.json()["detail"] == sin_token.json()["detail"]

        payload = jwt.decode(
            bien.json()["access_token"],
            os.environ["JWT_SECRET"],
            algorithms=["HS256"],
        )
        payload["exp"] = int(datetime.now(timezone.utc).timestamp()) - 10
        vencido = jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")
        caducado = cliente.get("/auth/me", headers={"Authorization": f"Bearer {vencido}"})
        assert caducado.status_code == 401
        assert caducado.json()["detail"] == sin_token.json()["detail"]


def test_usuario_a_no_lee_resumen_de_b(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def cargar() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        beto = await repositorio.crear_usuario("beto@example.com", auth.hashear("clave-de-beto-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura de ana",
            campos={"proveedor": "Edenor", "monto": "10.10"},
            advertencias=["revisar"],
        )
        antes = await repositorio.resumen(user_id=ana, desde="2026-01", hasta="2026-12")
        assert antes["comprobantes"] == []
        assert antes["por_mes"] == []
        assert antes["por_categoria"] == []
        await repositorio.confirmar_documento(user_id=ana, documento_id=borrador, campos=FACTURA_A)
        otro = await repositorio.guardar_borrador(
            user_id=beto,
            texto="factura de beto",
            campos={},
            advertencias=[],
        )
        await repositorio.confirmar_documento(user_id=beto, documento_id=otro, campos=FACTURA_B)

    asyncio.run(cargar())

    with _cliente() as cliente:
        ana = cliente.post(
            "/auth/login",
            json={"email": "ana@example.com", "password": "clave-de-ana-larga"},
        )
        beto = cliente.post(
            "/auth/login",
            json={"email": "beto@example.com", "password": "clave-de-beto-larga"},
        )
        assert ana.status_code == 200
        assert beto.status_code == 200
        sin_token = cliente.get("/resumen", params=RANGO)
        assert sin_token.status_code == 401

        de_ana = cliente.get(
            "/resumen",
            params=RANGO,
            headers={"Authorization": f"Bearer {ana.json()['access_token']}"},
        )
        de_beto = cliente.get(
            "/resumen",
            params=RANGO,
            headers={"Authorization": f"Bearer {beto.json()['access_token']}"},
        )
        assert de_ana.status_code == 200
        assert de_beto.status_code == 200
        assert de_ana.json()["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert de_ana.json()["por_categoria"] == [{"categoria": "servicios", "total": "10.10"}]
        assert de_beto.json()["por_mes"] == [{"periodo": "2026-03", "total": "0.20"}]
        assert "Edenor" not in str(de_beto.json())
        assert "Consorcio" not in str(de_ana.json())
        assert de_ana.json()["comprobantes"][0]["estado"] == "confirmado"
        assert de_beto.json()["comprobantes"][0]["id"] != de_ana.json()["comprobantes"][0]["id"]


def test_usuario_a_no_lee_documentos_de_b(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        beto = await repositorio.crear_usuario("beto@example.com", auth.hashear("clave-de-beto-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="texto privado de ana",
            campos={"monto": "10.10", "proveedor": "Edenor"},
            advertencias=["ojo"],
        )
        assert await repositorio.obtener_documento(user_id=beto, documento_id=borrador) is None
        assert await repositorio.listar_documentos(user_id=beto) == []
        assert (
            await repositorio.confirmar_documento(
                user_id=beto,
                documento_id=borrador,
                campos=FACTURA_A,
            )
            is None
        )
        sigue = await repositorio.obtener_documento(user_id=ana, documento_id=borrador)
        assert sigue is not None
        assert sigue["estado"] == "borrador"
        assert sigue["texto"] == "texto privado de ana"
        assert "10.10" not in str(
            await repositorio.resumen(user_id=ana, desde="2026-01", hasta="2026-12")
        )

        confirmado = await repositorio.confirmar_documento(
            user_id=ana,
            documento_id=borrador,
            campos=FACTURA_A,
        )
        assert confirmado is not None
        assert confirmado["estado"] == "confirmado"
        assert confirmado["texto"] == "texto privado de ana"
        assert confirmado["campos"]["monto"] == "10.10"
        assert await repositorio.obtener_documento(user_id=beto, documento_id=borrador) is None
        assert await repositorio.confirmar_documento(
            user_id=beto,
            documento_id=borrador,
            campos=FACTURA_A,
        ) is None
        propio = await repositorio.obtener_documento(user_id=ana, documento_id=borrador)
        assert propio is not None
        assert propio["estado"] == "confirmado"
        assert "texto" not in propio
        lista_ana = await repositorio.listar_documentos(user_id=ana)
        lista_beto = await repositorio.listar_documentos(user_id=beto)
        assert [item["id"] for item in lista_ana] == [borrador]
        assert lista_beto == []
        assert "texto" not in lista_ana[0]

        otra_vez = await repositorio.confirmar_documento(
            user_id=ana,
            documento_id=borrador,
            campos=FACTURA_B,
        )
        assert otra_vez is not None
        assert otra_vez["campos"]["proveedor"] == "Edenor"
        gastos = await repositorio.consultar_gastos(user_id=ana)
        assert gastos["cantidad"] == 1
        assert gastos["total"] == "10.10"
        ajenos = await repositorio.consultar_gastos(
            user_id=beto,
            proveedor="x' OR '1'='1",
        )
        assert ajenos["cantidad"] == 0
        assert ajenos["total"] == "0.00"
        assert ajenos["promedio"] == "0.00"

    asyncio.run(caso())


def test_sum_en_centavos_y_consulta_del_analista(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        primero = await repositorio.guardar_borrador(
            user_id=ana, texto="enero", campos={"monto": "999.99"}, advertencias=[]
        )
        segundo = await repositorio.guardar_borrador(
            user_id=ana, texto="febrero", campos={}, advertencias=[]
        )
        await repositorio.confirmar_documento(
            user_id=ana,
            documento_id=primero,
            campos={
                "proveedor": "Edenor",
                "categoria": "servicios",
                "periodo": "2026-01",
                "monto": "0.10",
            },
        )
        await repositorio.confirmar_documento(
            user_id=ana,
            documento_id=segundo,
            campos={
                "proveedor": "Edenor",
                "categoria": "servicios",
                "periodo": "2026-02",
                "monto": "0.20",
            },
        )
        total = await repositorio.resumen(user_id=ana, desde="2026-01", hasta="2026-02")
        assert total["por_categoria"] == [{"categoria": "servicios", "total": "0.30"}]
        ambos = await repositorio.consultar_gastos(user_id=ana, periodo_desde="2026-01", periodo_hasta="2026-02")
        assert ambos["total"] == "0.30"
        assert ambos["promedio"] == "0.15"
        assert ambos["cantidad"] == 2
        assert total["por_mes"] == [
            {"periodo": "2026-01", "total": "0.10"},
            {"periodo": "2026-02", "total": "0.20"},
        ]
        assert len(total["comprobantes"]) == 2
        marzo = await repositorio.resumen(user_id=ana, desde="2026-03", hasta="2026-03")
        assert marzo["comprobantes"] == []
        assert marzo["por_mes"] == []

        gastos = await repositorio.consultar_gastos(
            user_id=ana,
            categoria="servicios",
            periodo_desde="2026-02",
            periodo_hasta="2026-02",
            proveedor="edenor",
        )
        assert gastos["total"] == "0.20"
        assert gastos["cantidad"] == 1
        assert gastos["promedio"] == "0.20"
        assert gastos["por_proveedor"] == [
            {"proveedor": "Edenor", "total": "0.20", "promedio": "0.20", "cantidad": 1}
        ]
        assert await repositorio.consultar_gastos(user_id=ana, categoria="alquiler") == {
            "total": "0.00",
            "promedio": "0.00",
            "cantidad": 0,
            "por_mes": [],
            "por_categoria": [],
            "por_proveedor": [],
        }

    asyncio.run(caso())


def test_hilo_ajeno_no_se_lee(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        beto = await repositorio.crear_usuario("beto@example.com", auth.hashear("clave-de-beto-larga"))
        await repositorio.anotar_mensaje(
            user_id=ana,
            thread_id="hilo-ana",
            rol="persona",
            texto="cuánto pagué de luz",
        )
        await repositorio.anotar_mensaje(
            user_id=ana,
            thread_id="hilo-ana",
            rol="asistente",
            texto="10.10",
        )
        assert await repositorio.obtener_hilo(user_id=beto, thread_id="hilo-ana") is None
        assert await repositorio.listar_hilos(user_id=beto) == []
        propio = await repositorio.obtener_hilo(user_id=ana, thread_id="hilo-ana")
        assert propio is not None
        assert propio["thread_id"] == "hilo-ana"
        assert [item["rol"] for item in propio["mensajes"]] == ["persona", "asistente"]
        assert propio["mensajes"][0]["texto"] == "cuánto pagué de luz"
        lista = await repositorio.listar_hilos(user_id=ana)
        assert len(lista) == 1
        assert lista[0]["thread_id"] == "hilo-ana"
        assert "luz" in lista[0]["titulo"]
        assert await repositorio.obtener_hilo(user_id=ana, thread_id="no-existe") is None

    asyncio.run(caso())


def test_migracion_agrega_columnas_sin_romper_el_insert(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        import aiosqlite

        ruta = tmp_path / "gastos.db"
        conn = await aiosqlite.connect(ruta)
        await conn.executescript(
            """
            CREATE TABLE usuarios (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE borradores (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES usuarios(user_id),
                texto TEXT NOT NULL,
                campos_json TEXT NOT NULL,
                advertencias_json TEXT NOT NULL,
                creado_en TEXT NOT NULL
            );
            CREATE TABLE comprobantes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES usuarios(user_id),
                proveedor TEXT NOT NULL,
                categoria TEXT NOT NULL,
                periodo TEXT NOT NULL,
                monto_centavos INTEGER NOT NULL,
                moneda TEXT NOT NULL,
                vencimiento TEXT,
                numero_comprobante TEXT,
                texto TEXT NOT NULL,
                confirmado_en TEXT NOT NULL
            );
            """
        )
        await conn.commit()
        await conn.close()

        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura vieja",
            campos={"proveedor": "Edenor", "monto": "10.10"},
            advertencias=[],
        )
        confirmado = await repositorio.confirmar_documento(
            user_id=ana,
            documento_id=borrador,
            campos=FACTURA_A,
        )
        assert confirmado is not None
        assert confirmado["estado"] == "confirmado"
        otra = await repositorio.obtener_documento(user_id=ana, documento_id=borrador)
        assert otra is not None
        assert otra["anulado"] is False
        assert isinstance(otra["cambios"], list)
        revisada = await aiosqlite.connect(ruta)
        revisada.row_factory = aiosqlite.Row
        cursor = await revisada.execute("PRAGMA table_info(comprobantes)")
        nombres = {fila["name"] for fila in await cursor.fetchall()}
        await revisada.close()
        assert "vencimiento" not in nombres

    asyncio.run(caso())
