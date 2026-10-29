"""Caché de GET /resumen. No usa el Redis real ni el lifespan."""

from __future__ import annotations

import asyncio
import fnmatch
import json
import logging
import sys
from pathlib import Path

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import auth, repositorio
from app.cache_resumen import clave, invalidar, publicar_redis
from app.rutas_auth import router as router_auth
from app.rutas_documentos import router as router_documentos

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


class RedisCaja:
    def __init__(self) -> None:
        self.datos: dict[str, str] = {}
        self.ttl: dict[str, int | None] = {}

    async def get(self, nombre: str):
        return self.datos.get(nombre)

    async def set(self, nombre: str, valor: str, ex: int | None = None):
        self.datos[nombre] = valor
        self.ttl[nombre] = ex
        return True

    async def delete(self, *nombres: str) -> int:
        borradas = 0
        for nombre in nombres:
            if nombre in self.datos:
                del self.datos[nombre]
                self.ttl.pop(nombre, None)
                borradas += 1
        return borradas

    async def scan_iter(self, match: str | None = None):
        patron = match or "*"
        for nombre in list(self.datos):
            if fnmatch.fnmatch(nombre, patron):
                yield nombre


class RedisRoto:
    async def get(self, nombre: str):
        raise RuntimeError("caido")

    async def set(self, nombre: str, valor: str, ex: int | None = None):
        raise RuntimeError("caido")

    async def scan_iter(self, match: str | None = None):
        raise RuntimeError("caido")
        yield ""


class RedisBytes(RedisCaja):
    async def get(self, nombre: str):
        valor = self.datos.get(nombre)
        if isinstance(valor, str):
            return valor.encode()
        return valor


class RedisBasura(RedisCaja):
    async def get(self, nombre: str):
        return b"\xff\xfe{"


class RedisEspia(RedisCaja):
    def __init__(self) -> None:
        super().__init__()
        self.patrones: list[str | None] = []

    async def scan_iter(self, match: str | None = None):
        self.patrones.append(match)
        async for item in super().scan_iter(match):
            yield item


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-aislado-con-32-bytes")


def _cliente(redis) -> TestClient:
    aplicacion = FastAPI()
    aplicacion.state.redis = redis
    aplicacion.include_router(router_auth)
    aplicacion.include_router(router_documentos)
    return TestClient(aplicacion)


def _login(cliente: TestClient, email: str, password: str) -> tuple[str, str]:
    respuesta = cliente.post("/auth/login", json={"email": email, "password": password})
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    return cuerpo["access_token"], cuerpo["user_id"]


def _resumen(cliente: TestClient, token: str) -> dict:
    respuesta = cliente.get(
        "/resumen",
        params=RANGO,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert respuesta.status_code == 200
    return respuesta.json()


def test_la_segunda_lectura_no_consulta_y_anular_obliga_a_leer(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    ids: dict[str, str] = {}

    async def cargar() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        beto = await repositorio.crear_usuario("beto@example.com", auth.hashear("clave-de-beto-larga"))
        de_ana = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura de ana",
            campos={"proveedor": "Edenor", "monto": "10.10"},
            advertencias=[],
        )
        de_beto = await repositorio.guardar_borrador(
            user_id=beto,
            texto="factura de beto",
            campos={},
            advertencias=[],
        )
        await repositorio.confirmar_documento(user_id=ana, documento_id=de_ana, campos=FACTURA_A)
        await repositorio.confirmar_documento(user_id=beto, documento_id=de_beto, campos=FACTURA_B)
        ids["ana"] = ana
        ids["doc"] = de_ana

    asyncio.run(cargar())

    llamadas: list[str] = []
    real = repositorio.resumen

    async def contar(**kwargs):
        llamadas.append(kwargs["user_id"])
        return await real(**kwargs)

    monkeypatch.setattr(repositorio, "resumen", contar)
    redis = RedisCaja()

    with _cliente(redis) as cliente:
        token_ana, ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        token_beto, beto = _login(cliente, "beto@example.com", "clave-de-beto-larga")
        assert ana == ids["ana"]

        primero = _resumen(cliente, token_ana)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert llamadas == [ana]
        nombre = clave(ana, "2026-01", "2026-12")
        assert nombre is not None
        assert redis.ttl[nombre] == 60

        segundo = _resumen(cliente, token_ana)
        assert segundo == primero
        assert llamadas == [ana]

        de_beto = _resumen(cliente, token_beto)
        assert de_beto["por_mes"] == [{"periodo": "2026-03", "total": "0.20"}]
        assert "Edenor" not in str(de_beto)
        otra = _resumen(cliente, token_beto)
        assert otra == de_beto
        assert llamadas == [ana, beto]

        anulado = cliente.post(
            f"/documentos/{ids['doc']}/anular",
            headers={"Authorization": f"Bearer {token_ana}"},
        )
        assert anulado.status_code == 200
        assert nombre not in redis.datos
        assert clave(beto, "2026-01", "2026-12") in redis.datos

        fresco = _resumen(cliente, token_ana)
        assert fresco["por_mes"] == []
        assert fresco["comprobantes"] == []
        assert llamadas == [ana, beto, ana]
        assert _resumen(cliente, token_beto) == de_beto
        assert llamadas == [ana, beto, ana]


def test_si_redis_falla_el_resumen_sale_de_sql(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def cargar() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura",
            campos={},
            advertencias=[],
        )
        await repositorio.confirmar_documento(user_id=ana, documento_id=borrador, campos=FACTURA_A)

    asyncio.run(cargar())
    llamadas: list[str] = []
    real = repositorio.resumen

    async def contar(**kwargs):
        llamadas.append(kwargs["user_id"])
        return await real(**kwargs)

    monkeypatch.setattr(repositorio, "resumen", contar)

    with _cliente(RedisRoto()) as cliente:
        token, _ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        primero = _resumen(cliente, token)
        segundo = _resumen(cliente, token)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert segundo["por_mes"] == primero["por_mes"]
        assert len(llamadas) == 2


def test_asentar_pago_borra_la_cache_de_esa_persona(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    redis = RedisCaja()
    publicar_redis(redis)
    try:

        async def caso() -> None:
            ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
            nombre = clave(ana, "2026-01", "2026-12")
            ajena = "gastos:resumen:otra-persona:2026-01:2026-12"
            assert nombre is not None
            redis.datos[nombre] = "{}"
            redis.datos[ajena] = "{}"
            await repositorio.asentar_pago(
                user_id=ana,
                proveedor="Edenor",
                categoria="servicios",
                periodo="2026-03",
                monto="10.10",
                texto="pago",
            )
            assert nombre not in redis.datos
            assert ajena in redis.datos

        asyncio.run(caso())
    finally:
        publicar_redis(None)


def _logs_de_cache(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(
        registro.getMessage()
        for registro in caplog.records
        if registro.name.startswith("app.cache_resumen") or registro.name.startswith("app.rutas_auth")
    )


def test_payload_invalido_se_descarta_y_el_siguiente_sale_de_la_cache(
    tmp_path, monkeypatch, caplog: pytest.LogCaptureFixture
) -> None:
    _entorno(monkeypatch, tmp_path)

    async def cargar() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura",
            campos={},
            advertencias=[],
        )
        await repositorio.confirmar_documento(user_id=ana, documento_id=borrador, campos=FACTURA_A)

    asyncio.run(cargar())
    llamadas: list[str] = []
    real = repositorio.resumen

    async def contar(**kwargs):
        llamadas.append(kwargs["user_id"])
        return await real(**kwargs)

    monkeypatch.setattr(repositorio, "resumen", contar)
    redis = RedisCaja()
    malo = {
        "por_mes": [{"periodo": "2026-03", "total": "10.1"}],
        "por_categoria": [],
        "comprobantes": [{"id": "x", "estado": "borrador"}],
    }

    with _cliente(redis) as cliente:
        token, ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        nombre = clave(ana, "2026-01", "2026-12")
        assert nombre is not None
        redis.datos[nombre] = json.dumps(malo)
        caplog.clear()
        with caplog.at_level(logging.DEBUG):
            primero = _resumen(cliente, token)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert primero["por_categoria"] == [{"categoria": "servicios", "total": "10.10"}]
        assert primero["comprobantes"][0]["estado"] == "confirmado"
        assert "10.1" != primero["por_mes"][0]["total"]
        assert llamadas == [ana]
        guardado = json.loads(redis.datos[nombre])
        assert guardado["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        texto = _logs_de_cache(caplog)
        assert "10.1" not in texto
        assert "10.10" not in texto
        assert token not in texto
        assert "secreto-de-test-aislado-con-32-bytes" not in texto
        assert json.dumps(malo) not in texto

        segundo = _resumen(cliente, token)
        assert segundo == primero
        assert llamadas == [ana]


def test_bytes_validos_se_leen_y_los_ilegibles_caen_a_sql(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def cargar() -> None:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura",
            campos={},
            advertencias=[],
        )
        await repositorio.confirmar_documento(user_id=ana, documento_id=borrador, campos=FACTURA_A)

    asyncio.run(cargar())
    llamadas: list[str] = []
    real = repositorio.resumen

    async def contar(**kwargs):
        llamadas.append(kwargs["user_id"])
        return await real(**kwargs)

    monkeypatch.setattr(repositorio, "resumen", contar)

    with _cliente(RedisBytes()) as cliente:
        token, _ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        primero = _resumen(cliente, token)
        segundo = _resumen(cliente, token)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert segundo == primero
        assert len(llamadas) == 1

    with _cliente(RedisBasura()) as cliente:
        token, _ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        primero = _resumen(cliente, token)
        segundo = _resumen(cliente, token)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert segundo == primero
        assert len(llamadas) == 3


def test_user_id_con_comodines_no_borra_claves_ajenas() -> None:
    redis = RedisEspia()
    redis.datos["gastos:resumen:ana:2026-01:2026-12"] = "{}"
    redis.datos["gastos:resumen:ana2:2026-01:2026-12"] = "{}"
    redis.datos["gastos:resumen:otra-persona:2026-01:2026-12"] = "{}"

    async def probar() -> None:
        for user_id in ("*", "?", "[", "a*", "a?", "a[bc]", "*ana", ""):
            assert clave(user_id, "2026-01", "2026-12") is None
            await invalidar(redis, user_id)
        assert redis.patrones == []
        assert set(redis.datos) == {
            "gastos:resumen:ana:2026-01:2026-12",
            "gastos:resumen:ana2:2026-01:2026-12",
            "gastos:resumen:otra-persona:2026-01:2026-12",
        }
        await invalidar(redis, "ana")

    asyncio.run(probar())
    assert redis.patrones == ["gastos:resumen:ana:*"]
    assert "gastos:resumen:ana:2026-01:2026-12" not in redis.datos
    assert redis.datos["gastos:resumen:ana2:2026-01:2026-12"] == "{}"
    assert redis.datos["gastos:resumen:otra-persona:2026-01:2026-12"] == "{}"


def test_confirmar_y_corregir_borran_solo_la_cache_de_esa_persona(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def _sin_indice(**_kwargs: object) -> str:
        return "omitido"

    monkeypatch.setattr("app.ingesta._indexar", _sin_indice)

    async def cargar() -> str:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        borrador = await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura",
            campos={},
            advertencias=[],
        )
        return borrador

    borrador = asyncio.run(cargar())
    llamadas: list[str] = []
    real = repositorio.resumen

    async def contar(**kwargs):
        llamadas.append(kwargs["user_id"])
        return await real(**kwargs)

    monkeypatch.setattr(repositorio, "resumen", contar)
    redis = RedisCaja()
    ajena = "gastos:resumen:otra-persona:2026-01:2026-12"
    redis.datos[ajena] = "{}"

    with _cliente(redis) as cliente:
        token, ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        nombre = clave(ana, "2026-01", "2026-12")
        assert nombre is not None
        redis.datos[nombre] = '{"por_mes":[{"periodo":"2026-03","total":"99.99"}]}'
        confirmado = cliente.post(
            f"/documentos/{borrador}/confirmar",
            json=FACTURA_A,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert confirmado.status_code == 200, confirmado.text
        assert nombre not in redis.datos
        assert redis.datos[ajena] == "{}"

        primero = _resumen(cliente, token)
        assert primero["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
        assert nombre in redis.datos
        assert _resumen(cliente, token) == primero
        assert len(llamadas) == 1

        corregido = cliente.post(
            f"/documentos/{borrador}/corregir",
            json={**FACTURA_A, "monto": "4.00"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert corregido.status_code == 200, corregido.text
        assert nombre not in redis.datos
        assert redis.datos[ajena] == "{}"

        fresco = _resumen(cliente, token)
        assert fresco["por_mes"] == [{"periodo": "2026-03", "total": "4.00"}]
        assert "10.10" not in str(fresco["por_mes"])
        assert len(llamadas) == 2
        assert _resumen(cliente, token) == fresco
        assert len(llamadas) == 2


def test_si_falla_la_invalidacion_la_confirmacion_queda(
    tmp_path, monkeypatch, caplog: pytest.LogCaptureFixture
) -> None:
    _entorno(monkeypatch, tmp_path)

    async def _sin_indice(**_kwargs: object) -> str:
        return "omitido"

    monkeypatch.setattr("app.ingesta._indexar", _sin_indice)

    async def cargar() -> str:
        ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
        return await repositorio.guardar_borrador(
            user_id=ana,
            texto="factura",
            campos={},
            advertencias=[],
        )

    borrador = asyncio.run(cargar())

    with _cliente(RedisRoto()) as cliente:
        token, _ana = _login(cliente, "ana@example.com", "clave-de-ana-larga")
        caplog.clear()
        with caplog.at_level(logging.DEBUG):
            confirmado = cliente.post(
                f"/documentos/{borrador}/confirmar",
                json=FACTURA_A,
                headers={"Authorization": f"Bearer {token}"},
            )
        assert confirmado.status_code == 200, confirmado.text
        assert confirmado.json()["campos"]["monto"] == "10.10"
        texto = _logs_de_cache(caplog)
        assert "10.10" not in texto
        assert token not in texto
        assert "secreto-de-test-aislado-con-32-bytes" not in texto
        cuerpo = _resumen(cliente, token)
        assert cuerpo["por_mes"] == [{"periodo": "2026-03", "total": "10.10"}]
