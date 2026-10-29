"""Archivar y eliminar conversaciones. No usa Redis ni el lifespan de main."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import auth, repositorio
from app.rutas_auth import router as router_auth
from app.rutas_hilos import router as router_hilos

_NO_EXISTE = "No existe ese hilo"


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-hilos-con-32-bytes")


def _cliente() -> TestClient:
    aplicacion = FastAPI()
    aplicacion.include_router(router_auth)
    aplicacion.include_router(router_hilos)
    return TestClient(aplicacion)


def _registrar(cliente: TestClient, email: str) -> dict[str, str]:
    respuesta = cliente.post(
        "/auth/registro",
        json={"email": email, "password": "una frase larga"},
    )
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    return {
        "Authorization": f"Bearer {cuerpo['access_token']}",
        "user_id": cuerpo["user_id"],
    }


def _ids(respuesta) -> set[str]:
    assert respuesta.status_code == 200
    return {item["thread_id"] for item in respuesta.json()["items"]}


def test_archivar_restaurar_y_eliminar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers = {"Authorization": ada["Authorization"]}
        ajenos = {"Authorization": grace["Authorization"]}

        async def sembrar() -> None:
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-luz",
                rol="persona",
                texto="cuánto pagué de luz",
            )
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-luz",
                rol="asistente",
                texto="10.10",
            )
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-gas",
                rol="persona",
                texto="y el gas",
            )
            await repositorio.anotar_mensaje(
                user_id=grace["user_id"],
                thread_id="hilo-grace",
                rol="persona",
                texto="mensaje privado de grace",
            )

        asyncio.run(sembrar())

        lista = cliente.get("/hilos", headers=headers)
        assert lista.status_code == 200
        assert _ids(lista) == {"hilo-luz", "hilo-gas"}
        assert set(lista.json()["items"][0]) == {"thread_id", "titulo", "actualizado_en"}
        assert cliente.get("/hilos", headers=ajenos).json()["items"][0]["titulo"] == "mensaje privado de grace"

        assert cliente.get("/hilos?archivados=true", headers=headers).json() == {"items": []}
        assert cliente.post("/hilos/hilo-luz/archivar").status_code == 401
        assert cliente.delete("/hilos/hilo-luz").status_code == 401

        faltante = cliente.post("/hilos/no-existe/archivar", headers=headers)
        assert faltante.status_code == 404
        assert faltante.json()["detail"] == _NO_EXISTE

        assert cliente.post("/hilos/hilo-luz/archivar", headers=ajenos).status_code == 404
        assert cliente.delete("/hilos/hilo-luz", headers=ajenos).status_code == 404
        assert cliente.get("/hilos/hilo-luz", headers=ajenos).status_code == 404

        archivo = cliente.post("/hilos/hilo-luz/archivar", headers=headers)
        assert archivo.status_code == 204
        assert archivo.content == b""
        assert cliente.post("/hilos/hilo-luz/archivar", headers=headers).status_code == 204
        assert _ids(cliente.get("/hilos", headers=headers)) == {"hilo-gas"}
        archivadas = cliente.get("/hilos?archivados=true", headers=headers).json()["items"]
        assert [item["thread_id"] for item in archivadas] == ["hilo-luz"]
        assert "luz" in archivadas[0]["titulo"]
        assert cliente.get("/hilos?archivados=true", headers=ajenos).json()["items"] == []
        detalle = cliente.get("/hilos/hilo-luz", headers=headers)
        assert detalle.status_code == 200
        assert [item["rol"] for item in detalle.json()["mensajes"]] == ["persona", "asistente"]

        assert cliente.post("/hilos/hilo-luz/desarchivar", headers=ajenos).status_code == 404
        assert cliente.post("/hilos/hilo-luz/desarchivar", headers=headers).status_code == 204
        assert cliente.post("/hilos/hilo-luz/desarchivar", headers=headers).status_code == 204
        assert _ids(cliente.get("/hilos", headers=headers)) == {"hilo-luz", "hilo-gas"}
        assert cliente.get("/hilos?archivados=true", headers=headers).json()["items"] == []

        assert cliente.delete("/hilos/hilo-gas", headers=headers).status_code == 204
        assert cliente.get("/hilos/hilo-gas", headers=headers).status_code == 404
        assert cliente.delete("/hilos/hilo-gas", headers=headers).status_code == 404
        assert cliente.post("/hilos/hilo-gas/archivar", headers=headers).status_code == 404
        assert _ids(cliente.get("/hilos", headers=headers)) == {"hilo-luz"}
        assert _ids(cliente.get("/hilos", headers=ajenos)) == {"hilo-grace"}

        async def no_revive() -> None:
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-gas",
                rol="persona",
                texto="de nuevo",
            )
            assert await repositorio.obtener_hilo(user_id=ada["user_id"], thread_id="hilo-gas") is None
            assert await repositorio.hilo_esta_eliminado(user_id=ada["user_id"], thread_id="hilo-gas") is True
            assert await repositorio.obtener_hilo(user_id=grace["user_id"], thread_id="hilo-grace") is not None

        asyncio.run(no_revive())
        assert cliente.get("/hilos/hilo-gas", headers=headers).status_code == 404


def test_un_mensaje_propio_desarchiva_y_la_baja_de_cuenta_tambien(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        ada = await repositorio.crear_usuario("ada@example.com", auth.hashear("clave-de-ada-larga"))
        await repositorio.anotar_mensaje(
            user_id=ada,
            thread_id="hilo-luz",
            rol="persona",
            texto="cuánto pagué de luz",
        )
        assert await repositorio.archivar_hilo(user_id=ada, thread_id="hilo-luz") is True
        await repositorio.anotar_mensaje(
            user_id=ada,
            thread_id="hilo-luz",
            rol="asistente",
            texto="sigo archivada",
        )
        assert await repositorio.listar_hilos(user_id=ada) == []
        assert [item["thread_id"] for item in await repositorio.listar_hilos(user_id=ada, archivados=True)] == [
            "hilo-luz"
        ]
        await repositorio.anotar_mensaje(
            user_id=ada,
            thread_id="hilo-luz",
            rol="persona",
            texto="otra pregunta",
        )
        assert await repositorio.listar_hilos(user_id=ada, archivados=True) == []
        assert [item["thread_id"] for item in await repositorio.listar_hilos(user_id=ada)] == ["hilo-luz"]
        await repositorio.eliminar_usuario(user_id=ada)
        assert await repositorio.buscar_usuario_por_id(ada) is None

    asyncio.run(caso())


def test_el_hilo_queda_en_su_hogar(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com")
        headers = {"Authorization": ada["Authorization"]}
        ajenos = {"Authorization": grace["Authorization"]}

        async def sembrar() -> tuple[str, str]:
            propio = await repositorio.hogar_por_defecto(ada["user_id"])
            assert propio
            otro = await repositorio.crear_hogar(
                user_id=ada["user_id"],
                nombre="Casa de verano",
                direccion=None,
            )
            await repositorio.agregar_miembro(
                user_id=ada["user_id"],
                hogar_id=propio,
                email="grace@example.com",
            )
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-propio",
                rol="persona",
                texto="pregunta del hogar",
                hogar_id=propio,
            )
            await repositorio.anotar_mensaje(
                user_id=ada["user_id"],
                thread_id="hilo-otro",
                rol="persona",
                texto="pregunta de la otra casa",
                hogar_id=otro["id"],
            )
            return propio, otro["id"]

        propio, otro = asyncio.run(sembrar())
        con_otro = {**headers, "X-Hogar-Id": otro}

        assert _ids(cliente.get("/hilos", headers=headers)) == {"hilo-propio"}
        assert _ids(cliente.get("/hilos", headers=con_otro)) == {"hilo-otro"}
        assert cliente.get("/hilos/hilo-otro", headers=headers).status_code == 404
        assert cliente.get("/hilos/hilo-otro", headers=con_otro).status_code == 200
        assert cliente.post("/hilos/hilo-otro/archivar", headers=headers).status_code == 404
        assert cliente.post("/hilos/hilo-otro/archivar", headers=con_otro).status_code == 204
        assert cliente.get("/hilos", headers=con_otro).json()["items"] == []
        assert _ids(cliente.get("/hilos?archivados=true", headers=con_otro)) == {"hilo-otro"}
        assert _ids(cliente.get("/hilos", headers=headers)) == {"hilo-propio"}

        asociado = {**ajenos, "X-Hogar-Id": propio}
        prohibido = cliente.get("/hilos", headers=asociado)
        assert prohibido.status_code == 403
        assert prohibido.json()["detail"] == "Solo el administrador puede usar el chat"
        assert cliente.get("/hilos/hilo-propio", headers=asociado).status_code == 403
        assert cliente.delete("/hilos/hilo-propio", headers=asociado).status_code == 403
        ajeno = cliente.get("/hilos", headers={**headers, "X-Hogar-Id": "hogar-ajeno"})
        assert ajeno.status_code == 404
        assert ajeno.json()["detail"] == "No existe ese hogar"
        assert cliente.get("/hilos", headers=ajenos).status_code == 200
